// Sanity checks for town.json, so a typo is caught before the site breaks.
const test = require("node:test");
const assert = require("node:assert/strict");
const town = require("../../town.json");

const str = (v, name) => assert.ok(typeof v === "string" && v.trim() !== "", `${name} must be a non-empty string`);

test("site and location fields are present and sensible", () => {
  for (const k of ["name", "short_name", "place", "kicker", "tagline", "description", "app_id", "public_url", "area_name"]) {
    str(town.site[k], `site.${k}`);
  }
  assert.match(town.site.app_id, /^[a-z0-9_]+$/);
  assert.ok(town.location.lat >= -90 && town.location.lat <= 90, "lat");
  assert.ok(town.location.lon >= -180 && town.location.lon <= 180, "lon");
  assert.doesNotThrow(() => new Intl.DateTimeFormat("en-US", { timeZone: town.location.timezone }), "timezone must be an IANA name");
});

test("NWS and NOAA identifiers have the right shape", () => {
  const n = town.nws;
  assert.match(n.office, /^[A-Z]{3}$/);
  assert.ok(Number.isInteger(n.grid_x) && Number.isInteger(n.grid_y));
  assert.match(n.alerts_zone, /^[A-Z]{2}[ZC]\d{3}$/);
  assert.match(n.marine_zone, /^[A-Z]{2}Z\d{3}$/);
  assert.match(n.radar_station, /^[A-Z]{4}$/);
  assert.match(town.tides.station, /^\d{7}$/);
});

test("outages block is complete, and keys are referenced by env var name only", () => {
  const o = town.outages;
  assert.ok(["none", "avangrid"].includes(o.provider), "outages.provider");
  for (const k of ["utility_name", "utility_short", "phone_display", "report_url", "map_url", "county_label", "timestamp_zone_label", "data_file"]) {
    str(o[k], `outages.${k}`);
  }
  assert.match(o.phone_dial, /^\d{10,11}$/);
  assert.match(o.api_key_env, /^[A-Z][A-Z0-9_]*$/, "api_key_env is the NAME of an env var, not a key");
  assert.equal("api_key" in o, false, "never put a key in town.json");
});

test("every regex in the config compiles, and local_meaning entries are well formed", () => {
  assert.doesNotThrow(() => new RegExp(town.alerts.storm_event_pattern, "i"));
  assert.ok(Array.isArray(town.alerts.storm_severities) && town.alerts.storm_severities.length > 0);
  assert.ok(town.local_meaning.length > 0);
  for (const e of town.local_meaning) {
    assert.doesNotThrow(() => new RegExp(e.pattern, "i"), e.pattern);
    str(e.text, `local_meaning text for ${e.pattern}`);
  }
});

test("thresholds are numbers and watch levels sit below caution levels", () => {
  const t = town.thresholds;
  for (const v of Object.values(t)) assert.equal(typeof v, "number");
  assert.ok(t.wind_watch_mph < t.wind_caution_mph && t.gust_watch_mph < t.gust_caution_mph && t.seas_watch_ft < t.seas_caution_ft);
});

test("resource lists and fridge card are well formed", () => {
  for (const list of Object.values(town.resources)) {
    assert.ok(list.length > 0);
    for (const r of list) {
      str(r.title, "resource title");
      str(r.description, "resource description");
      assert.match(r.url, /^https:\/\//);
    }
  }
  assert.ok(town.fridge_card.phones.length > 0 && town.fridge_card.write_ins.length > 0);
  for (const p of town.fridge_card.phones) { str(p.label, "phone label"); str(p.number, "phone number"); }
});
