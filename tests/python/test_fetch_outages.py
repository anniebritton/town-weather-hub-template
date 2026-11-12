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


class ValidateTests(unittest.TestCase):
    def test_good_response_passes(self):
        fetch_outages.validate_response(COUNTY, TOWN)

    def test_junk_is_rejected(self):
        for county, town in [
            ({}, {}),                                   # HTTP 200 with an empty object
            ([], []),                                   # wrong container type
            ({**COUNTY, "lastUpdated": None}, TOWN),   # no timestamp
            ({**COUNTY, "outages": None}, TOWN),        # no totals
            ({**COUNTY, "outages": "7"}, TOWN),         # numbers as strings
            ({**COUNTY, "features": None}, TOWN),
            (COUNTY, {"features": [{"nope": 1}]}),      # feature without properties
            (COUNTY, {}),
        ]:
            with self.assertRaises(fetch_outages.ResponseError, msg=repr((county, town))):
                fetch_outages.validate_response(county, town)


class WriteDecisionTests(unittest.TestCase):
    NOW = fetch_outages.datetime.datetime(2030, 1, 1, 12, 0, tzinfo=fetch_outages.datetime.timezone.utc)

    def result(self, fetched, outages=7, last="2000-01-01 12:00:00"):
        r = fetch_outages.build_result({**COUNTY, "outages": outages, "lastUpdated": last}, TOWN, CFG)
        r["fetchedAt"] = fetched
        return r

    def test_build_result_records_fetch_time_and_status(self):
        r = fetch_outages.build_result(COUNTY, TOWN, CFG, now=self.NOW)
        self.assertEqual(r["fetchedAt"], "2030-01-01T12:00:00Z")
        self.assertEqual(r["status"], "ok")

    def test_only_lastupdated_changed_and_recent_means_no_write(self):
        old = self.result("2030-01-01T11:50:00Z", last="a")
        new = self.result("2030-01-01T12:00:00Z", last="b")
        self.assertFalse(fetch_outages.should_write(old, new, now=self.NOW))

    def test_numbers_changed_means_write(self):
        old = self.result("2030-01-01T11:59:00Z", outages=7)
        new = self.result("2030-01-01T12:00:00Z", outages=8)
        self.assertTrue(fetch_outages.should_write(old, new, now=self.NOW))

    def test_old_file_gets_a_heartbeat_write(self):
        old = self.result("2030-01-01T10:00:00Z")
        new = self.result("2030-01-01T12:00:00Z")
        self.assertTrue(fetch_outages.should_write(old, new, now=self.NOW))

    def test_sample_missing_or_unreadable_old_file_means_write(self):
        new = self.result("2030-01-01T12:00:00Z")
        for old in (None, {}, {**new, "sample": True}, "junk"):
            self.assertTrue(fetch_outages.should_write(old, new, now=self.NOW), repr(old))

    def test_unmatched_town_warns_only_when_other_towns_exist(self):
        r = fetch_outages.build_result(COUNTY, TOWN, {"match_town": "NOWHERE", "match_county": "EXAMPLE"})
        self.assertEqual(len(fetch_outages.unmatched_warnings(r, {"match_town": "NOWHERE"})), 1)
        r = fetch_outages.build_result(COUNTY, TOWN, CFG)
        self.assertEqual(fetch_outages.unmatched_warnings(r, CFG), [])
        empty = fetch_outages.build_result({**COUNTY}, {"features": []}, CFG)
        self.assertEqual(fetch_outages.unmatched_warnings(empty, CFG), [])


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

    def test_enabled_flag_reflects_provider_and_key(self):
        for cfg, env, want in [
            ({"provider": "none", "api_key_env": "K"}, {"K": "x"}, "false"),
            ({"provider": "avangrid", "api_key_env": "K"}, {}, "false"),
            ({"provider": "avangrid", "api_key_env": "K"}, {"K": "x"}, "true"),
        ]:
            with mock.patch.object(fetch_outages, "load_config", return_value={"outages": cfg}), \
                 mock.patch.dict(os.environ, env, clear=True), redirect_stdout(io.StringIO()) as out:
                self.assertEqual(fetch_outages.main(["--enabled"]), 0)
            self.assertEqual(out.getvalue().strip(), want)

    def test_junk_response_keeps_last_good_file_and_fails(self):
        cfg = {"provider": "avangrid", "api_key_env": "K", "api_url": "u", "api_key_header": "h",
               "match_town": "EXAMPLETON", "match_county": "EXAMPLE", "data_file": "data/test-out.json"}
        with mock.patch.object(fetch_outages, "load_config", return_value={"outages": cfg}), \
             mock.patch.dict(os.environ, {"K": "secret"}, clear=True), \
             mock.patch.object(fetch_outages, "fetch_json", return_value={}), \
             mock.patch("builtins.open", side_effect=AssertionError("must not touch files")), \
             redirect_stdout(io.StringIO()), mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            code = fetch_outages.main([])
        self.assertEqual(code, 1)
        self.assertIn("Keeping the last good file", err.getvalue())

    def test_missing_key_is_a_noop(self):
        code, out = self.run_main({"provider": "avangrid", "api_key_env": "K"}, {})
        self.assertEqual(code, 0)
        self.assertIn("K is not set", out)


if __name__ == "__main__":
    unittest.main()
