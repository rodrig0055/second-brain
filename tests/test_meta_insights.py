import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).parents[1] / "api" / "meta-insights.py"
SPEC = importlib.util.spec_from_file_location("meta_insights_function", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
build_command = MODULE.build_command
validate_payload = MODULE.validate_payload


class MetaInsightsFunctionTests(unittest.TestCase):
    def test_builds_exact_read_only_command(self):
        payload = validate_payload(
            {
                "adId": "126685233825345159",
                "adAccountId": "act_2515313311013452",
                "accessToken": "x" * 30,
                "since": "2026-07-01",
                "until": "2026-07-07",
            }
        )
        command = build_command(payload)
        # The launcher prefix is one element where the `meta` script is installed and three
        # (python -c ...) where it is not, as on Vercel and in CI, so skip it rather than assume.
        prefix = len(MODULE.cli_argv())
        self.assertEqual(command[prefix : prefix + 3], ["--output", "json", "--no-input"])
        self.assertIn("insights", command)
        self.assertIn("--ad-id", command)
        self.assertNotIn("create", command)
        self.assertNotIn("update", command)
        self.assertNotIn("delete", command)

    def test_defaults_to_official_last_30_days_preset(self):
        payload = validate_payload(
            {
                "adId": "126685233825345159",
                "adAccountId": "2515313311013452",
                "accessToken": "x" * 30,
            }
        )
        self.assertEqual(payload["datePreset"], "last_30d")

    def test_rejects_non_numeric_ad_id(self):
        with self.assertRaisesRegex(ValueError, "digits only"):
            validate_payload(
                {
                    "adId": "1202; rm -rf /",
                    "adAccountId": "2515313311013452",
                    "accessToken": "x" * 30,
                }
            )

    def test_rejects_reversed_date_range(self):
        with self.assertRaisesRegex(ValueError, "since must not be after until"):
            validate_payload(
                {
                    "adId": "126685233825345159",
                    "adAccountId": "2515313311013452",
                    "accessToken": "x" * 30,
                    "since": "2026-07-08",
                    "until": "2026-07-01",
                }
            )


if __name__ == "__main__":
    unittest.main()
