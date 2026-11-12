#!/usr/bin/env python3
"""Fetch current utility outage data and write the data file named in town.json.

Run by .github/workflows/outages.yml on a schedule, or manually for local dev:

    OUTAGE_API_KEY=... python3 scripts/fetch_outages.py

Everything utility-specific comes from the "outages" block of town.json
(api_url, api_key_header, api_key_env, match_town, match_county, data_file).
The API key is read from the environment variable NAMED by api_key_env and is
never stored in the repo. With provider "none", or with no key set, this
script does nothing and exits 0, so the workflow is safe to leave enabled.

Safety rules (the page relies on these):
  * A response that does not have the expected shape is rejected: the script
    exits 1 and leaves the last good data file untouched.
  * The file records when WE fetched it ("fetchedAt"); the page treats old data
    as unavailable instead of showing stale numbers as current.
  * The file is rewritten only when the numbers change, or when the previous
    file is older than HEARTBEAT_MINUTES, to keep the commit history small.

Other modes:
    --enabled   print "true"/"false" (used by the workflow to skip work)
    --towns     list the town and county names the API currently returns, to help
                you spell outages.match_town / match_county correctly

The response shape handled here is the Avangrid-family one (two calls,
?filter=county and ?filter=town, each returning GeoJSON-like "features").
For another utility, adapt fetch_json(), validate_response() and build_result().
"""
import datetime
import json
import os
import sys
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
HEARTBEAT_MINUTES = 45


class ResponseError(ValueError):
    """The utility returned something that is not the expected outage data."""


def load_config(path=None):
    with open(path or os.path.join(ROOT, "town.json"), encoding="utf-8") as f:
        return json.load(f)


def is_enabled(cfg, env=None):
    """True when the outage fetch should run (a real provider, and its key is set)."""
    env = os.environ if env is None else env
    if cfg.get("provider", "none") == "none":
        return False
    return bool(env.get(cfg.get("api_key_env", ""), ""))


def fetch_json(api_url, header, key, filt):
    req = urllib.request.Request(f"{api_url}?filter={filt}", headers={header: key})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)


def _is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def validate_response(county, town):
    """Raise ResponseError unless both responses look like real outage data."""
    for name, data in (("county", county), ("town", town)):
        if not isinstance(data, dict):
            raise ResponseError(f"{name} response is not a JSON object")
        feats = data.get("features")
        if not isinstance(feats, list):
            raise ResponseError(f"{name} response has no 'features' list")
        for f in feats:
            if not isinstance(f, dict) or not isinstance(f.get("properties"), dict):
                raise ResponseError(f"{name} response has a feature without 'properties'")
    if not isinstance(county.get("lastUpdated"), str) or not county["lastUpdated"].strip():
        raise ResponseError("county response is missing 'lastUpdated'")
    for key in ("customers", "outages", "incidents"):
        if not _is_number(county.get(key)):
            raise ResponseError(f"county response is missing a numeric '{key}'")


def build_result(county, town, outages_cfg, now=None):
    """Pure function: raw county/town API responses -> the JSON the page reads."""
    def props(features):
        return [f["properties"] for f in features]

    towns = props(town.get("features", []))
    counties = props(county.get("features", []))
    want_town = outages_cfg["match_town"].upper()
    want_county = outages_cfg["match_county"].upper()

    # "towns" mixes level "town" and "street" rows; only the town row has the town total
    local_town = next(
        (t for t in towns if t.get("level") == "town" and t.get("town", "").upper() == want_town), None)
    local_county = next((c for c in counties if c.get("county", "").upper() == want_county), None)
    now = now or datetime.datetime.now(datetime.timezone.utc)

    return {
        "status": "ok",
        "fetchedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "lastUpdated": county.get("lastUpdated"),
        "totals": {
            "customers": county.get("customers"),
            "outages": county.get("outages"),
            "incidents": county.get("incidents"),
        },
        "town": local_town,      # null = no outages reported in your town
        "county": local_county,  # null = no outages reported in your county
        "towns": towns,
    }


def _comparable(result):
    """The part of a result that matters for deciding whether to rewrite the file."""
    r = dict(result or {})
    r.pop("fetchedAt", None)
    r.pop("lastUpdated", None)
    return r


def _parse_fetched(value):
    try:
        return datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
    except (TypeError, ValueError):
        return None


def should_write(old, new, now=None):
    """Rewrite when the numbers changed, there is no usable old file, or it is getting old."""
    if not isinstance(old, dict) or old.get("sample") or _comparable(old) != _comparable(new):
        return True
    fetched = _parse_fetched(old.get("fetchedAt"))
    now = now or datetime.datetime.now(datetime.timezone.utc)
    return fetched is None or (now - fetched) >= datetime.timedelta(minutes=HEARTBEAT_MINUTES)


def unmatched_warnings(result, outages_cfg):
    """Human-readable hints when the configured names match nothing in the response."""
    notes = []
    names = {t.get("town", "").upper() for t in result["towns"]}
    if result["town"] is None and names:
        notes.append(
            f"no town row matched match_town={outages_cfg['match_town']!r}. This is normal when "
            "your town has no outages. If it never matches, check the spelling: the API is "
            f"currently reporting {len(names)} other town(s). Run with --towns to list them.")
    return notes


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    cfg = load_config()["outages"]

    if "--enabled" in argv:
        print("true" if is_enabled(cfg) else "false")
        return 0

    if cfg.get("provider", "none") == "none":
        print('outages.provider is "none"; nothing to fetch.')
        return 0
    key = os.environ.get(cfg["api_key_env"], "")
    if not key:
        print(f"{cfg['api_key_env']} is not set; skipping outage fetch.")
        return 0

    county = fetch_json(cfg["api_url"], cfg["api_key_header"], key, "county")
    town = fetch_json(cfg["api_url"], cfg["api_key_header"], key, "town")

    if "--towns" in argv:
        validate_response(county, town)
        for t in sorted({t["properties"].get("town", "") for t in town["features"]}):
            print("town  ", t)
        for c in sorted({c["properties"].get("county", "") for c in county["features"]}):
            print("county", c)
        return 0

    try:
        validate_response(county, town)
    except ResponseError as e:
        print(f"::error::Outage API returned unexpected data ({e}). Keeping the last good file.", file=sys.stderr)
        return 1

    result = build_result(county, town, cfg)
    for note in unmatched_warnings(result, cfg):
        print(f"::warning::{note}")

    out = os.path.join(ROOT, cfg["data_file"])
    try:
        with open(out, encoding="utf-8") as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = None
    if not should_write(old, result):
        print("outage numbers unchanged and file is recent; not rewriting", out)
        return 0
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1)
    print("wrote", out, "-", county.get("outages"), "customers out in total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
