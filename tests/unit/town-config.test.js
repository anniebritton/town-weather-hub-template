// Sanity checks for town.json, so a typo is caught before the site breaks.
// Runs against the root config and every worked example under examples/.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { feature, isTodo, safeUrl, safeDataFile } = require("../../town-utils.js");

const root = path.join(__dirname, "..", "..");
const configs = [["town.json", path.join(root, "town.json")]];
const exDir = path.join(root, "examples");
if (fs.existsSync(exDir)) {
  for (const d of fs.readdirSync(exDir).sort()) {
    const f = path.join(exDir, d, "town.json");
    if (fs.existsSync(f)) configs.push([`examples/${d}/town.json`, f]);
  }
}

// A value you cannot verify is the text TODO; the page shows it as a visible TODO.
const todoOr = (re) => (v) => isTodo(v) || re.test(v);

function* urlFields(node, prefix = "") {
  if (typeof node === "string") { if (/(^|\.)(url|[a-z_]*_url)$/.test(prefix.replace(/\[\d+\]/g, ""))) yield [prefix, node]; return; }
  if (Array.isArray(node)) { for (const [i, v] of node.entries()) yield* urlFields(v, `${prefix}[${i}]`); return; }
  if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) if (k !== "_comment") yield* urlFields(v, prefix ? `${prefix}.${k}` : k);
}

for (const [label, file] of configs) {
  const town = JSON.parse(fs.readFileSync(file, "utf8"));
  const marine = feature(town, "marine");
  const tides = feature(town, "tides");
  const str = (v, name) => assert.ok(typeof v === "string" && v.trim() !== "", `${name} must be a non-empty string`);

  test(`${label}: features block only contains known on/off switches`, () => {
    const known = ["marine", "tides", "climate_coastal", "pests"];
    assert.equal(typeof town.features, "object");
    for (const [k, v] of Object.entries(town.features)) {
      assert.ok(known.includes(k), `unknown feature ${k}`);
      assert.equal(typeof v, "boolean", `features.${k}`);
    }
    if (!marine) assert.equal(tides, false, "tides cannot be on when marine is off");
  });

  test(`${label}: site and location fields are present and sensible`, () => {
    for (const k of ["name", "short_name", "place", "kicker", "tagline", "description", "app_id", "public_url", "area_name"]) {
      str(town.site[k], `site.${k}`);
    }
    assert.match(town.site.app_id, /^[a-z0-9_]+$/);
    assert.ok(town.location.lat >= -90 && town.location.lat <= 90, "lat");
    assert.ok(town.location.lon >= -180 && town.location.lon <= 180, "lon");
    assert.doesNotThrow(() => new Intl.DateTimeFormat("en-US", { timeZone: town.location.timezone }), "timezone must be an IANA name");
  });

  test(`${label}: NWS and NOAA identifiers have the right shape (marine and tides only when enabled)`, () => {
    const n = town.nws;
    assert.match(n.office, /^[A-Z]{3}$/);
    assert.ok(Number.isInteger(n.grid_x) && Number.isInteger(n.grid_y));
    assert.match(n.alerts_zone, /^[A-Z]{2}[ZC]\d{3}$/);
    assert.match(n.radar_station, /^[A-Z]{4}$/);
    if (marine) {
      assert.match(n.marine_zone, /^[A-Z]{2}Z\d{3}$/);
      str(n.marine_description, "nws.marine_description");
    }
    if (tides) {
      assert.match(town.tides.station, /^\d{7}$/);
      str(town.tides.name, "tides.name");
    }
  });

  test(`${label}: outages block is complete, and keys are referenced by env var name only`, () => {
    const o = town.outages;
    assert.ok(["none", "avangrid"].includes(o.provider), "outages.provider");
    for (const k of ["utility_name", "utility_short", "report_url", "map_url", "county_label", "timestamp_zone_label", "data_file"]) {
      str(o[k], `outages.${k}`);
    }
    str(o.phone_display, "outages.phone_display");
    assert.ok(todoOr(/^\d{10,11}$/)(o.phone_dial), "phone_dial is 10-11 digits, or TODO");
    assert.equal(isTodo(o.phone_dial), isTodo(o.phone_display), "phone_display and phone_dial should both be TODO or both be real");
    assert.ok(Number.isInteger(o.stale_after_minutes) && o.stale_after_minutes > 0, "stale_after_minutes");
    assert.equal(typeof o.match_verified, "boolean", "outages.match_verified must be true or false");
    assert.ok(Number.isInteger(o.max_source_age_minutes) && o.max_source_age_minutes > 0, "max_source_age_minutes");
    assert.ok(safeDataFile(o.data_file), `outages.data_file must be a file inside data/, got ${o.data_file}`);
    assert.match(o.api_key_env, /^[A-Z][A-Z0-9_]*$/, "api_key_env is the NAME of an env var, not a key");
    assert.equal("api_key" in o, false, "never put a key in town.json");
    if (o.provider !== "none") for (const k of ["api_url", "api_key_header", "match_town", "match_county"]) str(o[k], `outages.${k}`);
  });

  test(`${label}: every URL is https:// (or TODO). The page refuses to link to anything else`, () => {
    const seen = [...urlFields(town)];
    assert.ok(seen.length >= 8, "expected to find the URL fields");
    for (const [p, v] of seen) assert.ok(isTodo(v) || safeUrl(v), `${p} must be an https:// URL or TODO, got ${JSON.stringify(v)}`);
  });

  test(`${label}: every regex in the config compiles, and local_meaning entries are well formed`, () => {
    assert.doesNotThrow(() => new RegExp(town.alerts.storm_event_pattern, "i"));
    assert.ok(Array.isArray(town.alerts.storm_severities) && town.alerts.storm_severities.length > 0);
    str(town.alerts.demo_event, "alerts.demo_event");
    assert.ok(town.local_meaning.length > 0);
    for (const e of town.local_meaning) {
      assert.doesNotThrow(() => new RegExp(e.pattern, "i"), e.pattern);
      str(e.text, `local_meaning text for ${e.pattern}`);
    }
  });

  test(`${label}: the demo alert gets a local meaning`, () => {
    const hit = town.local_meaning.some((e) => new RegExp(e.pattern, "i").test(town.alerts.demo_event));
    assert.ok(hit, `no local_meaning entry matches the demo event ${town.alerts.demo_event}`);
  });

  test(`${label}: thresholds are numbers and watch levels sit below caution levels`, () => {
    const t = town.thresholds;
    for (const v of Object.values(t)) assert.equal(typeof v, "number");
    assert.ok(t.wind_watch_mph < t.wind_caution_mph && t.gust_watch_mph < t.gust_caution_mph);
    if (marine) assert.ok(t.seas_watch_ft < t.seas_caution_ft);
  });

  test(`${label}: resource lists and fridge card are well formed`, () => {
    for (const list of Object.values(town.resources)) {
      assert.ok(list.length > 0);
      for (const r of list) { str(r.title, "resource title"); str(r.description, "resource description"); }
    }
    assert.ok(town.fridge_card.phones.length > 0 && town.fridge_card.write_ins.length > 0);
    for (const p of town.fridge_card.phones) { str(p.label, "phone label"); str(p.number, "phone number"); }
    assert.equal(town.fridge_card.phones.find((p) => p.urgent)?.number, "911");
  });

  test(`${label}: fire config is well formed`, () => {
    assert.equal(typeof town.fire.embed, "boolean");
    for (const k of ["agency", "map_title", "season", "burn_note"]) str(town.fire[k], `fire.${k}`);
  });
}

// Keys that may be left out of an example because a feature is off
const OPTIONAL = { marine: ["nws.marine_zone", "nws.marine_description", "thresholds.seas_watch_ft", "thresholds.seas_caution_ft"], tides: ["tides"] };

function flatKeys(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && !["features"].includes(p)) out.push(p, ...flatKeys(v, p));
    else out.push(p);
  }
  return out;
}

test("every example uses only keys the generic config has, and has every key it needs", () => {
  // The schema reference is the frozen generic config, not the root town.json you edit
  const base = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "town.generic.json"), "utf8"));
  const baseKeys = new Set(flatKeys(base));
  for (const [label, file] of configs.slice(1)) {
    const ex = JSON.parse(fs.readFileSync(file, "utf8"));
    const exKeys = new Set(flatKeys(ex));
    for (const k of exKeys) assert.ok(baseKeys.has(k), `${label}: unknown key ${k} (add it to town.json first)`);
    const optional = new Set(Object.entries(OPTIONAL).filter(([f]) => !feature(ex, f)).flatMap(([, keys]) => keys));
    for (const k of baseKeys) {
      if ([...optional].some((o) => k === o || k.startsWith(`${o}.`))) continue;
      assert.ok(exKeys.has(k), `${label}: missing key ${k}`);
    }
  }
});

test("the inland example really has the coastal features off", () => {
  const f = path.join(exDir, "inland-desert", "town.json");
  const t = JSON.parse(fs.readFileSync(f, "utf8"));
  assert.deepEqual([feature(t, "marine"), feature(t, "tides"), feature(t, "climate_coastal")], [false, false, false]);
});
