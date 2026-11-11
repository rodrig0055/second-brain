"""Protected read-only bridge to Meta's official Ads CLI.

The public HTTP surface is intentionally tiny: callers can request one ad's
Insights row for an explicit range or an official date preset. Credentials are
provided by the authenticated Next.js backend and are passed to the CLI only
through the child process environment.
"""

from __future__ import annotations

import copy
import datetime as dt
import hmac
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler
from typing import Any


MAX_BODY_BYTES = 32 * 1024
ID_RE = re.compile(r"^\d{5,30}$")
ACCOUNT_RE = re.compile(r"^(?:act_)?\d{5,30}$")
DATE_PRESETS = {
    "today",
    "yesterday",
    "last_3d",
    "last_7d",
    "last_14d",
    "last_30d",
    "last_90d",
    "this_month",
    "last_month",
}
INSIGHT_FIELDS = ",".join(
    [
        "account_id",
        "account_name",
        "account_currency",
        "spend",
        "impressions",
        "clicks",
        "inline_link_clicks",
        "ctr",
        "actions",
        "action_values",
        "campaign_id",
        "campaign_name",
        "adset_id",
        "adset_name",
        "ad_id",
        "ad_name",
    ]
)

_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_cache_lock = threading.Lock()


class RequestError(ValueError):
    pass


class CliError(RuntimeError):
    pass


def _iso_date(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise RequestError(f"{field} must be an ISO date")
    try:
        parsed = dt.date.fromisoformat(value)
    except ValueError as exc:
        raise RequestError(f"{field} must be YYYY-MM-DD") from exc
    return parsed.isoformat()


def validate_payload(payload: Any) -> dict[str, str]:
    if not isinstance(payload, dict):
        raise RequestError("JSON body must be an object")

    ad_id = str(payload.get("adId", "")).strip()
    account_id = str(payload.get("adAccountId", "")).strip()
    access_token = str(payload.get("accessToken", "")).strip()
    if not ID_RE.fullmatch(ad_id):
        raise RequestError("adId must contain digits only")
    if not ACCOUNT_RE.fullmatch(account_id):
        raise RequestError("adAccountId is invalid")
    if len(access_token) < 20:
        raise RequestError("accessToken is invalid")

    result = {
        "adId": ad_id,
        "adAccountId": account_id,
        "accessToken": access_token,
    }
    preset = payload.get("datePreset")
    since = payload.get("since")
    until = payload.get("until")
    if preset is not None:
        preset = str(preset)
        if preset not in DATE_PRESETS:
            raise RequestError("datePreset is not supported")
        if since is not None or until is not None:
            raise RequestError("datePreset cannot be combined with since/until")
        result["datePreset"] = preset
    elif since is not None or until is not None:
        start = _iso_date(since, "since")
        end = _iso_date(until, "until")
        if start > end:
            raise RequestError("since must not be after until")
        result["since"] = start
        result["until"] = end
    else:
        result["datePreset"] = "last_30d"
    return result


# Runs the Meta Ads CLI through the current interpreter. Vercel's Python
# runtime installs the meta-ads package but does not expose its `meta` console
# script on PATH, so we import the entry point directly. Click reads its args
# from sys.argv[1:], so the CLI args appended after this bootstrap parse fine.
CLI_BOOTSTRAP = "import sys; from meta.cli import cli; sys.exit(cli())"


def cli_argv() -> list[str]:
    """Command prefix that launches the Meta Ads CLI.

    A bare "meta" fails with OSError in Vercel's runtime (console script not on
    PATH). Resolve in order: an explicit META_CLI_PATH override, the console
    script next to the interpreter, the script on PATH (local dev / pipx), then
    — the robust fallback — the installed module run via the current
    interpreter, which always has the package importable.
    """
    override = os.environ.get("META_CLI_PATH")
    if override:
        return [override]
    venv_bin = os.path.join(os.path.dirname(sys.executable), "meta")
    if os.path.exists(venv_bin):
        return [venv_bin]
    on_path = shutil.which("meta")
    if on_path:
        return [on_path]
    return [sys.executable, "-c", CLI_BOOTSTRAP]


def build_command(payload: dict[str, str]) -> list[str]:
    command = [
        *cli_argv(),
        "--output",
        "json",
        "--no-input",
        "ads",
        "insights",
        "get",
        "--ad-id",
        payload["adId"],
        "--time-increment",
        "all_days",
        "--limit",
        "1",
        "--fields",
        INSIGHT_FIELDS,
    ]
    if "datePreset" in payload:
        command.extend(["--date-preset", payload["datePreset"]])
    else:
        command.extend(["--since", payload["since"], "--until", payload["until"]])
    return command


def _cache_key(payload: dict[str, str]) -> str:
    date_key = payload.get("datePreset") or f'{payload["since"]}:{payload["until"]}'
    return f'{payload["adAccountId"]}:{payload["adId"]}:{date_key}'


def run_meta_cli(payload: dict[str, str]) -> tuple[dict[str, Any], bool, int]:
    key = _cache_key(payload)
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(key)
        if cached and cached[0] > now:
            return copy.deepcopy(cached[1]), True, 0

    env = os.environ.copy()
    env["ACCESS_TOKEN"] = payload["accessToken"]
    env["AD_ACCOUNT_ID"] = payload["adAccountId"]
    env["NO_COLOR"] = "1"
    timeout = float(os.environ.get("META_CLI_TIMEOUT_SECONDS", "20"))
    started = time.monotonic()
    try:
        completed = subprocess.run(
            build_command(payload),
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise CliError("Meta Ads CLI timed out") from exc
    except OSError as exc:
        raise CliError("Meta Ads CLI could not start") from exc
    duration_ms = round((time.monotonic() - started) * 1000)

    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "Meta Ads CLI failed").strip()
        detail = detail.replace(payload["accessToken"], "[redacted]")[:500]
        raise CliError(detail)
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise CliError("Meta Ads CLI returned invalid JSON") from exc
    if not isinstance(result, dict) or not isinstance(result.get("data"), list):
        raise CliError("Meta Ads CLI returned an unexpected response")

    ttl = max(0, int(os.environ.get("META_CLI_CACHE_TTL_SECONDS", "120")))
    if ttl:
        with _cache_lock:
            _cache[key] = (time.monotonic() + ttl, copy.deepcopy(result))
    return result, False, duration_ms


class handler(BaseHTTPRequestHandler):
    def log_message(self, _format: str, *args: Any) -> None:
        # Do not allow the default handler to log request contents or headers.
        return

    def _send(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        secret = os.environ.get("META_CLI_INTERNAL_SECRET") or os.environ.get(
            "CRON_SECRET"
        )
        supplied = self.headers.get("Authorization", "")
        expected = f"Bearer {secret}" if secret else ""
        if not expected or not hmac.compare_digest(supplied, expected):
            self._send(401, {"ok": False, "error": "Unauthorized"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send(400, {"ok": False, "error": "Invalid request size"})
            return
        try:
            payload = validate_payload(json.loads(self.rfile.read(length)))
            result, cache_hit, duration_ms = run_meta_cli(payload)
        except RequestError as exc:
            self._send(400, {"ok": False, "error": str(exc)})
            return
        except CliError as exc:
            self._send(502, {"ok": False, "error": str(exc)})
            return
        except Exception:
            self._send(500, {"ok": False, "error": "Meta lookup failed"})
            return

        self._send(
            200,
            {
                "ok": True,
                "result": result,
                "meta": {"cacheHit": cache_hit, "durationMs": duration_ms},
            },
        )

