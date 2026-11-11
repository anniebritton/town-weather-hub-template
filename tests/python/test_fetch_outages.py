"""Offline tests for scripts/fetch_outages.py (no network, no API key)."""
import io
import os
import sys
import unittest
from contextlib import redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import fetch_outages  # noqa: E402

CFG = {"match_town": "Exampleton", "match_county": "Example"}

COUNTY = {
    "lastUpdated": "2000-01-01 12:00:00", "customers": 1000, "outages": 7, "incidents": 3,
    "features": [
        {"properties": {"county": "OTHER", "Outages": 4}},
        {"properties": {"county": "EXAMPLE", "Outages": 3}},
    ],
}
TOWN = {
    "features": [
        {"properties": {"level": "street", "town": "EXAMPLETON", "street": "MAIN ST", "Outages": 1}},
        {"properties": {"level": "town", "town": "EXAMPLETON", "Outages": 3}},
        {"properties": {"level": "town", "town": "ELSEWHERE", "Outages": 4}},
    ],
}


class BuildResultTests(unittest.TestCase):
    def test_matches_town_row_not_street_row_case_insensitively(self):
        r = fetch_outages.build_result(COUNTY, TOWN, CFG)
        self.assertEqual(r["town"]["level"], "town")
        self.assertEqual(r["town"]["Outages"], 3)
        self.assertEqual(r["county"]["Outages"], 3)
        self.assertEqual(r["totals"], {"customers": 1000, "outages": 7, "incidents": 3})
        self.assertEqual(len(r["towns"]), 3)

    def test_no_outages_in_town_or_county_gives_null(self):
        empty = {"features": []}
        r = fetch_outages.build_result({"lastUpdated": "x", "features": []}, empty, CFG)
        self.assertIsNone(r["town"])
        self.assertIsNone(r["county"])


class MainTests(unittest.TestCase):
    def run_main(self, outages_cfg, env):
        cfg = {"outages": outages_cfg}
        with mock.patch.object(fetch_outages, "load_config", return_value=cfg), \
             mock.patch.dict(os.environ, env, clear=True), \
             mock.patch.object(fetch_outages, "fetch_json", side_effect=AssertionError("network used")), \
             redirect_stdout(io.StringIO()) as out:
            code = fetch_outages.main()
        return code, out.getvalue()

    def test_provider_none_is_a_noop(self):
        code, out = self.run_main({"provider": "none", "api_key_env": "K"}, {"K": "secret"})
        self.assertEqual(code, 0)
        self.assertIn("nothing to fetch", out)

    def test_missing_key_is_a_noop(self):
        code, out = self.run_main({"provider": "avangrid", "api_key_env": "K"}, {})
        self.assertEqual(code, 0)
        self.assertIn("K is not set", out)


if __name__ == "__main__":
    unittest.main()
