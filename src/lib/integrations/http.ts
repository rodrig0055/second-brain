/**
 * The three things every call to a third-party HTTP API needs and none of ours
 * had: a deadline, a ceiling on how much we will read, and a guarantee that the
 * credential cannot come back out in an error.
 *
 * All three exist because of how Graph API calls actually fail rather than how
 * they are documented to:
 *
 *   deadlines    `fetch` has no default timeout. A Graph call that never
 *                answers holds a Vercel function open until maxDuration (300s)
 *                kills the whole request, so one slow ad account can take out
 *                a sync that would otherwise have finished.
 *
 *   ceilings     a response is read with `res.text()`, which buys whatever
 *                length the other end sends. An insights call with the wrong
 *                breakdown can return tens of megabytes, and the first sign of
 *                it is the function running out of memory rather than an error
 *                naming the call that did it.
 *
 *   redaction    we authenticate by putting the token in the query string,
 *                which is what Meta's API takes. That means the token is in
 *                every URL, Meta echoes request context back inside some error
 *                bodies, and `fetch`'s own network errors carry the URL in
 *                their message. Any of those reaching a log, a stored
 *                `ad_actions.error`, or a chat tool result puts a live
 *                ads_management token where a person can read it.
 *
 * Redaction is deliberately blunt: it removes the value after anything that
 * looks like a credential name, so a new secret-shaped parameter is covered
 * without anyone remembering to add it. Over-redacting an error message costs
 * nothing; under-redacting one leaks a token.
 */

/** Meta's own responses are well under this; anything larger is a mistake. */
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** A single read, including the body. Generous: insights can be slow. */
export const READ_TIMEOUT_MS = 30_000;

/**
 * A whole paged read. `graphGet` follows up to 25 cursors, so the per-request
 * deadline alone still permits 12 minutes of wall clock.
 */
export const TOTAL_READ_TIMEOUT_MS = 90_000;

/** A write. Shorter on purpose: see `mutationTimedOut` below. */
export const WRITE_TIMEOUT_MS = 30_000;

/** An upload, where the body is the payload rather than the answer. */
export const UPLOAD_TIMEOUT_MS = 5 * 60_000;

/** The response was larger than we are willing to hold in memory. */
export class ResponseTooLargeError extends Error {
  readonly limit: number;

  constructor(limit: number) {
    super(`The response exceeded the ${limit} byte limit and was not read.`);
    this.name = "ResponseTooLargeError";
    this.limit = limit;
  }
}

/** The request did not complete: timed out, DNS, connection reset. */
export class TransportError extends Error {
  readonly timedOut: boolean;

  constructor(message: string, timedOut: boolean) {
    super(message);
    this.name = "TransportError";
    this.timedOut = timedOut;
  }
}

const REDACTED = "[REDACTED]";

/**
 * Parameter names whose value is a credential.
 *
 * The optional `foo_` prefix is what makes this hold up without being kept up
 * to date: it turns `token` into `page_access_token` and `secret` into
 * `client_secret`, so an endpoint inventing a new one is covered already. The
 * trailing `_key` arm is deliberately loose and will redact an innocent
 * `sort_key` too. That is the right way round: a redacted debug value costs a
 * follow-up question, an unredacted token costs a rotation.
 */
const SECRET_NAME =
  "(?:(?:[a-z0-9]+_)*(?:access_token|token|secret|password|passwd|credential|cookie|authorization|appsecret_proof|api_key|apikey)|(?:[a-z0-9]+_)+key)";

/** `access_token=EAA...` in a URL or a form body. */
const QUERY_SECRET = new RegExp(`\\b${SECRET_NAME}=[^&\\s"'<>#\\\\]+`, "gi");

/** `"access_token": "EAA..."` inside a JSON body Meta echoed back. */
const JSON_SECRET = new RegExp(`"${SECRET_NAME}"\\s*:\\s*"[^"]*"`, "gi");

/** `Authorization: Bearer EAA...` */
const BEARER = /\bbearer\s+[\w.\-~+/=]+/gi;

/** `https://user:password@host` */
const USERINFO = /\b(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi;

/**
 * Remove anything credential-shaped from text that is about to be shown,
 * stored or logged.
 *
 * Applied to error messages and to upstream response bodies before either is
 * put anywhere a person or a model can read it. Only the value is removed: the
 * parameter name stays, because "access_token=[REDACTED]" tells whoever is
 * debugging that a token was sent, which "[REDACTED]" alone does not.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(USERINFO, `$1${REDACTED}@`)
    .replace(JSON_SECRET, (match) => {
      const name = match.slice(0, match.indexOf('"', 1) + 1);
      return `${name}:"${REDACTED}"`;
    })
    .replace(QUERY_SECRET, (match) => `${match.slice(0, match.indexOf("="))}=${REDACTED}`)
    .replace(BEARER, `Bearer ${REDACTED}`);
}

/** Redact an unknown thrown value down to a safe message. */
export function redactError(err: unknown): string {
  if (err instanceof Error) return redactSecrets(err.message);
  return redactSecrets(String(err));
}

/**
 * Read a response body, stopping at `limit` bytes rather than at the end.
 *
 * The stream is cancelled the moment the limit is passed, so an oversized
 * response costs the bytes already in flight rather than all of them.
 */
export async function readBoundedBytes(
  res: Response,
  limit = MAX_RESPONSE_BYTES,
): Promise<Uint8Array> {
  const body = res.body;
  // A HEAD or 204 has no body; older polyfills expose none either.
  if (!body) return new Uint8Array(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflowed = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        overflowed = true;
        break;
      }
      chunks.push(value);
    }
  } catch (err) {
    throw asTransportError(err);
  } finally {
    // Cancelling a finished stream is a no-op; cancelling a live one is the
    // point, and neither should mask the error we are about to throw.
    await reader.cancel().catch(() => {});
  }

  if (overflowed) throw new ResponseTooLargeError(limit);

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** `readBoundedBytes`, decoded as text. What every JSON caller wants. */
export async function readBounded(
  res: Response,
  limit = MAX_RESPONSE_BYTES,
): Promise<string> {
  return new TextDecoder().decode(await readBoundedBytes(res, limit));
}

/**
 * `fetch` with a deadline and a ceiling, returning the body already read.
 *
 * The body is read here rather than by the caller so that no call site can
 * accidentally skip the ceiling, and so the timeout covers the body as well as
 * the headers. A signal passed in is used as-is, for callers that own their own
 * cancellation.
 */
export async function fetchBounded(
  url: string | URL,
  init: RequestInit = {},
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ res: Response; text: string }> {
  const timeoutMs = opts.timeoutMs ?? READ_TIMEOUT_MS;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw asTransportError(err);
  }
  const text = await readBounded(res, opts.maxBytes);
  return { res, text };
}

/**
 * Turn a thrown `fetch` failure into one that names what happened and carries
 * no URL.
 *
 * Node puts the request URL in the message of some network errors, and the URL
 * holds the token. The distinction that matters to callers is timed-out versus
 * anything else, because a write that timed out may still have been applied.
 */
export function asTransportError(err: unknown): TransportError {
  if (err instanceof TransportError) return err;

  const name = err instanceof Error ? err.name : "";
  const timedOut = name === "TimeoutError" || name === "AbortError";
  if (timedOut) {
    return new TransportError("The request timed out before a reply arrived.", true);
  }
  return new TransportError(
    `The request did not complete: ${redactError(err)}`,
    false,
  );
}

/**
 * Whether a failed write leaves the outcome genuinely unknown.
 *
 * A timeout, a dropped connection or a body we refused to read all mean the
 * same thing for a POST: the request may have reached Meta and been applied
 * before the answer failed to reach us. Re-sending it is how one pause becomes
 * two ads created. Callers use this to route to verification instead of retry.
 */
export function mutationOutcomeUnknown(err: unknown): boolean {
  return err instanceof TransportError || err instanceof ResponseTooLargeError;
}
