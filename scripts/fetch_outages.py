#!/usr/bin/env python3
"""Fetch current utility outage data and write the data file named in town.json.

Run by .github/workflows/outages.yml on a schedule, or manually for local dev:

    OUTAGE_API_KEY=... python3 scripts/fetch_outages.py

Everything utility-specific comes from the "outages" block of town.json
(api_url, api_key_header, api_key_env, match_town, match_county, data_file).
The API key is read from the environment variable NAMED by api_key_env and is
never stored in the repo. With provider "none", or with no key set, this
script does nothing and exits 0, so the workflow is safe to leave enabled.

The response shape handled here is the Avangrid-family one (two calls,
?filter=county and ?filter=town, each returning GeoJSON-like "features").
For another utility, adapt fetch_json() and build_result().
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def load_config(path=None):
    with open(path or os.path.join(ROOT, "town.json"), encoding="utf-8") as f:
        return json.load(f)


def fetch_json(api_url, header, key, filt):
    req = urllib.request.Request(f"{api_url}?filter={filt}", headers={header: key})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)


def build_result(county, town, outages_cfg):
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

    return {
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


def main():
    cfg = load_config()["outages"]
    if cfg.get("provider", "none") == "none":
        print('outages.provider is "none"; nothing to fetch.')
        return 0
    key = os.environ.get(cfg["api_key_env"], "")
    if not key:
        print(f"{cfg['api_key_env']} is not set; skipping outage fetch.")
        return 0

    county = fetch_json(cfg["api_url"], cfg["api_key_header"], key, "county")
    town = fetch_json(cfg["api_url"], cfg["api_key_header"], key, "town")
    result = build_result(county, town, cfg)

    out = os.path.join(ROOT, cfg["data_file"])
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1)
    print("wrote", out, "-", county.get("outages"), "customers out in total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
