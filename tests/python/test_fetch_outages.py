"""Offline tests for scripts/fetch_outages.py (no network, no API key)."""
import datetime
import io
import json
import math
import os
import sys
import unittest
from contextlib import redirect_stdout
from unittest import mock
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import fetch_outages  # noqa: E402

CFG = {"match_town": "Exampleton", "match_county": "Example"}
TZ = "America/Chicago"  # location.timezone: the utility's lastUpdated is local time in this zone


def stamp(minutes_ago=10, tz=TZ):
    """A utility-style timestamp ('2030-06-01 07:25:00': local time, no zone) for `minutes_ago` minutes ago."""
    t = datetime.datetime.now(ZoneInfo(tz)) - datetime.timedelta(minutes=minutes_ago)
    return t.strftime("%Y-%m-%d %H:%M:%S")


COUNTY = {
    "lastUpdated": stamp(10), "customers": 1000, "outages": 7, "incidents": 3,
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
        fetch_outages.validate_response(COUNTY, TOWN, TZ)

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


class HostileValueTests(unittest.TestCase):
    """Numbers that would make the page lie or break: negative, fractional, absurd, wrong type, future."""

    def reject(self, county=None, town=None):
        with self.assertRaises(fetch_outages.ResponseError):
            fetch_outages.validate_response(county or COUNTY, town or TOWN, TZ)

    def test_bad_totals_are_rejected(self):
        for bad in (-1, 1.5, 1e308, 10 ** 12, True, "7", None, [7]):
            self.reject(county={**COUNTY, "outages": bad})
            self.reject(county={**COUNTY, "customers": bad})

    def test_whole_number_floats_are_accepted(self):
        fetch_outages.validate_response({**COUNTY, "outages": 7.0}, TOWN, TZ)

    def test_bad_per_row_counts_are_rejected(self):
        for bad in (-4, 0.5, 1e308, "5"):
            self.reject(town={"features": [{"properties": {"level": "town", "town": "EXAMPLETON", "Outages": bad}}]})
            self.reject(county={**COUNTY, "features": [{"properties": {"county": "EXAMPLE", "Outages": bad}}]})

    def test_future_timestamps_are_rejected(self):
        self.reject(county={**COUNTY, "lastUpdated": "2999-01-01 00:00:00"})
        self.reject(county={**COUNTY, "lastUpdated": stamp(-120)})  # two hours ahead
        fetch_outages.validate_response({**COUNTY, "lastUpdated": stamp(-2)}, TOWN, TZ)  # a couple of minutes of clock skew is fine

    def test_data_file_must_be_inside_data_dir(self):
        good = fetch_outages.resolve_data_file({"data_file": "data/outages.json"})
        self.assertTrue(good.endswith(os.path.join("data", "outages.json")))
        for bad in ("../town.json", "town.json", "data/../app.js", "/etc/passwd", "data", "", None, "data/../../x"):
            with self.assertRaises(fetch_outages.ConfigError, msg=repr(bad)):
                fetch_outages.resolve_data_file({"data_file": bad})


class MatchTests(unittest.TestCase):
    def result(self, cfg, town=TOWN):
        return fetch_outages.build_result(COUNTY, town, cfg)

    def test_unmatched_town_with_other_towns_fails_until_verified(self):
        cfg = {"match_town": "TYPOVILLE", "match_county": "EXAMPLE"}
        self.assertIn("TYPOVILLE", fetch_outages.match_problem(self.result(cfg), cfg))
        verified = {**cfg, "match_verified": True}
        self.assertIsNone(fetch_outages.match_problem(self.result(verified), verified))
        self.assertTrue(self.result(verified)["matchVerified"])
        self.assertFalse(self.result(cfg)["matchVerified"])

    def test_matched_town_or_empty_list_is_fine(self):
        self.assertIsNone(fetch_outages.match_problem(self.result(CFG), CFG))
        cfg = {"match_town": "ANYWHERE", "match_county": "EXAMPLE"}
        quiet = fetch_outages.build_result({**COUNTY, "outages": 0}, {"features": []}, cfg)
        self.assertIsNone(fetch_outages.match_problem(quiet, cfg), "nothing out anywhere, nothing to confirm")

    def test_no_town_rows_but_outages_overall_cannot_confirm_the_match(self):
        for verified in (False, True):
            cfg = {"match_town": "ANYWHERE", "match_county": "EXAMPLE", "match_verified": verified}
            r = fetch_outages.build_result(COUNTY, {"features": []}, cfg)   # COUNTY reports 7 customers out
            msg = fetch_outages.match_problem(r, cfg)
            self.assertIn("lists no towns", msg, f"verified={verified}")


class TimeTests(unittest.TestCase):
    NOW = datetime.datetime(2030, 6, 1, 12, 0, tzinfo=datetime.timezone.utc)   # 07:00 in Chicago (CDT)

    def parse(self, value, tz=TZ):
        return fetch_outages._parse_utility_time(value, tz)

    def test_local_time_is_read_in_the_towns_zone_across_dst(self):
        self.assertEqual(self.parse("2030-06-01 07:25:00"), datetime.datetime(2030, 6, 1, 12, 25, tzinfo=datetime.timezone.utc))
        self.assertEqual(self.parse("2030-01-15 07:25:00"), datetime.datetime(2030, 1, 15, 13, 25, tzinfo=datetime.timezone.utc))
        self.assertEqual(self.parse("2030-03-10 03:30:00", "America/New_York"), datetime.datetime(2030, 3, 10, 7, 30, tzinfo=datetime.timezone.utc))
        self.assertEqual(self.parse("2030-06-01T07:25:00+02:00", None), datetime.datetime(2030, 6, 1, 5, 25, tzinfo=datetime.timezone.utc))

    def test_unreadable_means_none_never_a_guess(self):
        for value, tz in [("2030-06-01 07:25:00", None), ("2030-06-01 07:25:00", ""), ("2030-06-01 07:25:00", "Nowhere/Land"),
                          ("2030-13-01 07:25:00", TZ), ("2030-02-31 07:25:00", TZ), ("06/01/2030 7:25 AM", TZ), (None, TZ), (5, TZ)]:
            self.assertIsNone(self.parse(value, tz), f"{value!r} / {tz!r}")

    def check(self, last_updated, tz=TZ, limit=360):
        fetch_outages.validate_response({**COUNTY, "lastUpdated": last_updated}, TOWN, tz, limit, now=self.NOW)

    def test_frozen_feed_is_rejected_even_though_we_just_fetched_it(self):
        self.check("2030-06-01 06:50:00")                                    # 10 minutes old: fine
        self.check("2030-06-01 02:00:00")                                    # 5 hours old: under the 6 hour default
        with self.assertRaises(fetch_outages.ResponseError) as cm:
            self.check("2030-05-31 20:00:00")                                # 11 hours old
        self.assertIn("frozen", str(cm.exception))
        self.check("2030-05-31 20:00:00", limit=24 * 60)                     # configurable
        with self.assertRaises(fetch_outages.ResponseError):
            self.check("2030-06-01 04:00:00", limit=60)

    def test_future_is_judged_in_the_towns_zone(self):
        with self.assertRaises(fetch_outages.ResponseError) as cm:
            self.check("2030-06-01 07:25:00")                                # 12:25Z, 25 minutes ahead
        self.assertIn("future", str(cm.exception))
        self.check("2030-06-01 07:25:00", tz="America/New_York")             # 11:25Z: in the past there

    def test_missing_or_invalid_zone_is_unverifiable_and_rejected(self):
        for tz in (None, "", "Nowhere/Land"):
            with self.assertRaises(fetch_outages.ResponseError) as cm:
                self.check("2030-06-01 06:50:00", tz=tz)
            self.assertIn("timezone", str(cm.exception))

    def test_main_rejects_a_frozen_feed_and_keeps_the_last_good_file(self):
        cfg = {"provider": "avangrid", "api_key_env": "K", "api_url": "u", "api_key_header": "h", "match_town": "EXAMPLETON",
               "match_county": "EXAMPLE", "data_file": "data/test-out.json", "max_source_age_minutes": 60}
        frozen = {**COUNTY, "lastUpdated": stamp(600)}
        with mock.patch.object(fetch_outages, "load_config", return_value={"location": {"timezone": TZ}, "outages": cfg}), \
             mock.patch.dict(os.environ, {"K": "secret"}, clear=True), \
             mock.patch.object(fetch_outages, "fetch_json", side_effect=lambda u, h, k, f: frozen if f == "county" else TOWN), \
             mock.patch("builtins.open", side_effect=AssertionError("must not touch files")), \
             redirect_stdout(io.StringIO()), mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            self.assertEqual(fetch_outages.main([]), 1)
        self.assertIn("frozen", err.getvalue())


def _fixture(name):
    with open(os.path.join(os.path.dirname(__file__), "..", "fixtures", name), encoding="utf-8") as f:
        return json.load(f)


class SharedCaseTests(unittest.TestCase):
    """The same case files are run through parseLocalTime()/safeDataFile() in town-utils.js (tests/unit),
    so the page and this script cannot drift apart."""

    def test_time_cases_match_the_page(self):
        cases = _fixture("time-cases.json")
        self.assertGreater(len(cases), 40)
        for case in cases:
            got = fetch_outages._parse_utility_time(case["value"], case["tz"])
            got = None if got is None else got.strftime("%Y-%m-%dT%H:%M:%SZ")
            self.assertEqual(got, case["utc"], f"{case['value']!r} in {case['tz']!r} ({case['note']})")

    def test_data_file_cases_match_the_page(self):
        cases = _fixture("data-file-cases.json")
        self.assertGreater(len(cases), 25)
        for case in cases:
            if case["ok"]:
                path = fetch_outages.resolve_data_file({"data_file": case["path"]})
                self.assertTrue(path.endswith(case["path"].replace("/", os.sep)), case["path"])
            else:
                with self.assertRaises(fetch_outages.ConfigError, msg=f"{case['path']!r} ({case['note']})"):
                    fetch_outages.resolve_data_file({"data_file": case["path"]})

    def test_non_string_data_files_are_refused(self):
        for bad in (None, 5, [], {}, True):
            with self.assertRaises(fetch_outages.ConfigError):
                fetch_outages.resolve_data_file({"data_file": bad})


class LimitTests(unittest.TestCase):
    NOW = datetime.datetime(2030, 6, 1, 12, 0, tzinfo=datetime.timezone.utc)

    def test_limits_that_are_not_positive_finite_numbers_use_the_default(self):
        for bad in (0, -1, -360, math.nan, math.inf, -math.inf, "60", None, True, False, [], {}):
            self.assertEqual(fetch_outages._limit_minutes(bad), fetch_outages.DEFAULT_SOURCE_AGE_MINUTES, repr(bad))
        self.assertEqual(fetch_outages._limit_minutes(45), 45)
        self.assertEqual(fetch_outages._limit_minutes(2.5), 2.5)

    def test_an_enormous_limit_is_clamped_instead_of_overflowing(self):
        self.assertEqual(fetch_outages._limit_minutes(10 ** 30), fetch_outages.MAX_LIMIT_MINUTES)
        county = {**COUNTY, "lastUpdated": "2030-06-01 06:50:00"}
        fetch_outages.validate_response(county, TOWN, TZ, 10 ** 30, now=self.NOW)   # must not raise OverflowError

    def test_zero_or_negative_limit_does_not_reject_everything(self):
        county = {**COUNTY, "lastUpdated": "2030-06-01 05:00:00"}   # two hours old: under the 360 minute default
        for bad in (0, -5, math.nan):
            fetch_outages.validate_response(county, TOWN, TZ, bad, now=self.NOW)
        frozen = {**COUNTY, "lastUpdated": "2030-05-31 20:00:00"}
        with self.assertRaises(fetch_outages.ResponseError):
            fetch_outages.validate_response(frozen, TOWN, TZ, 0, now=self.NOW)   # 0 means default, which still rejects 11 hours

    def test_check_age_false_skips_only_the_age_check(self):
        frozen = {**COUNTY, "lastUpdated": "2030-05-31 20:00:00"}
        fetch_outages.validate_response(frozen, TOWN, TZ, now=self.NOW, check_age=False)
        with self.assertRaises(fetch_outages.ResponseError):   # an unreadable timestamp is still rejected
            fetch_outages.validate_response({**COUNTY, "lastUpdated": "garbage"}, TOWN, TZ, now=self.NOW, check_age=False)
        with self.assertRaises(fetch_outages.ResponseError):   # and so is a timestamp in the future
            fetch_outages.validate_response({**COUNTY, "lastUpdated": "2030-06-01 08:30:00"}, TOWN, TZ, now=self.NOW, check_age=False)


class TownsModeTests(unittest.TestCase):
    """--towns lists the names the utility uses. It must work even when the feed is stale."""

    def run_towns(self, county, town, cfg_extra=None):
        cfg = {"provider": "avangrid", "api_key_env": "K", "api_url": "u", "api_key_header": "h",
               "match_town": "EXAMPLETON", "match_county": "EXAMPLE", "data_file": "data/outages.json", **(cfg_extra or {})}
        with mock.patch.object(fetch_outages, "load_config", return_value={"location": {"timezone": TZ}, "outages": cfg}), \
             mock.patch.dict(os.environ, {"K": "secret"}, clear=True), \
             mock.patch.object(fetch_outages, "fetch_json", side_effect=lambda u, h, k, f: county if f == "county" else town), \
             mock.patch("builtins.open", side_effect=AssertionError("--towns must not write files")), \
             redirect_stdout(io.StringIO()) as out, mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            code = fetch_outages.main(["--towns"])
        return code, out.getvalue(), err.getvalue()

    def test_towns_lists_names_and_does_not_crash(self):
        code, out, err = self.run_towns(COUNTY, TOWN)
        self.assertEqual(code, 0, err)
        for name in ("EXAMPLETON", "ELSEWHERE", "EXAMPLE", "OTHER"):
            self.assertIn(name, out)
        self.assertIn("match_town 'EXAMPLETON': found", out)

    def test_towns_works_when_the_feed_is_hours_old(self):
        stale = {**COUNTY, "lastUpdated": stamp(60 * 30)}   # 30 hours old
        code, out, err = self.run_towns(stale, TOWN)
        self.assertEqual(code, 0, err)
        self.assertIn("ELSEWHERE", out)

    def test_towns_says_when_the_configured_name_is_not_listed(self):
        code, out, _ = self.run_towns(COUNTY, TOWN, {"match_town": "TYPOVILLE"})
        self.assertEqual(code, 0)
        self.assertIn("not in this list", out)

    def test_towns_still_survives_an_absurd_max_source_age(self):
        code, _, err = self.run_towns(COUNTY, TOWN, {"max_source_age_minutes": 1e308})
        self.assertEqual(code, 0, err)


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

    def test_unmatched_county_only_warns(self):
        cfg = {"match_town": "EXAMPLETON", "match_county": "NOWHERE"}
        r = fetch_outages.build_result(COUNTY, TOWN, cfg)
        r["counties_seen"] = len(COUNTY["features"])
        self.assertEqual(len(fetch_outages.unmatched_warnings(r, cfg)), 1)
        self.assertEqual(fetch_outages.unmatched_warnings(r, {**cfg, "match_verified": True}), [])
        self.assertIsNone(fetch_outages.match_problem(r, cfg), "a county typo does not stop the run")


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

    def run_with(self, cfg, county, town):
        base = {"provider": "avangrid", "api_key_env": "K", "api_url": "u", "api_key_header": "h",
                "match_town": "EXAMPLETON", "match_county": "EXAMPLE", "data_file": "data/test-out.json"}
        responses = {"county": county, "town": town}
        with mock.patch.object(fetch_outages, "load_config", return_value={"location": {"timezone": TZ}, "outages": {**base, **cfg}}), \
             mock.patch.dict(os.environ, {"K": "secret"}, clear=True), \
             mock.patch.object(fetch_outages, "fetch_json", side_effect=lambda u, h, k, f: responses[f]), \
             mock.patch.object(fetch_outages, "resolve_data_file", return_value="/nonexistent-dir/never-written.json"), \
             redirect_stdout(io.StringIO()), mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            code = fetch_outages.main([])
        return code, err.getvalue()

    def test_typod_town_fails_loudly_instead_of_writing(self):
        code, err = self.run_with({"match_town": "TYPOVILLE"}, COUNTY, TOWN)
        self.assertEqual(code, 1)
        self.assertIn("::error::", err)
        self.assertIn("match_verified", err)

    def test_bad_data_file_path_fails_loudly(self):
        with mock.patch.object(fetch_outages, "load_config", return_value={"location": {"timezone": TZ}, "outages": {
                "provider": "avangrid", "api_key_env": "K", "api_url": "u", "api_key_header": "h",
                "match_town": "EXAMPLETON", "match_county": "EXAMPLE", "data_file": "../app.js"}}), \
             mock.patch.dict(os.environ, {"K": "secret"}, clear=True), \
             mock.patch.object(fetch_outages, "fetch_json", side_effect=lambda u, h, k, f: COUNTY if f == "county" else TOWN), \
             redirect_stdout(io.StringIO()), mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            self.assertEqual(fetch_outages.main([]), 1)
        self.assertIn("data/", err.getvalue())

    def test_junk_response_keeps_last_good_file_and_fails(self):
        cfg = {"provider": "avangrid", "api_key_env": "K", "api_url": "u", "api_key_header": "h",
               "match_town": "EXAMPLETON", "match_county": "EXAMPLE", "data_file": "data/test-out.json"}
        with mock.patch.object(fetch_outages, "load_config", return_value={"location": {"timezone": TZ}, "outages": cfg}), \
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
