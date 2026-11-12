#!/usr/bin/env node
// Reports what is still unfinished or unsafe in town.json.
//   node scripts/check-config.js [--online] [path/to/town.json]     (or: npm run check-config)
//
// It lists: template placeholders (XXX, example.com, ...), values marked TODO, URLs that are not
// https:// (the page refuses to link to those), and coastal wording left in an inland config.
// With --online it also asks NWS and NOAA whether your zone, grid, radar, marine zone and tide
// station really exist and agree with your coordinates (needs internet; no keys).
//
// Exit code: 0 nothing to fix, 1 something to fix, 2 the file is unusable.
const fs = require("node:fs");
const path = require("node:path");
const { isTodo, safeUrl, feature } = require("../town-utils.js");

const COASTAL_WORDS = /\b(boat|boats|boating|hurricane|tropical storm|surf|tide|tides|seas|mooring|moorings|dock|docks|coastal|shore|shoreline|storm surge|rip current|small craft|gale)\b/i;
const PLACEHOLDER_TEXT = /example\.com|exampleton|dryfork|anystate|example county|example electric|555-?01\d\d|5550100/i;

// [dotted path, test(value, town), hint, applies(town)]
const RULES = [
  ["nws.office", (v) => v === "XXX", "NWS forecast office, e.g. GYX"],
  ["nws.grid_x", (v, t) => v === 0 && t.nws.office === "XXX", "gridX from api.weather.gov/points/{lat},{lon}"],
  ["nws.grid_y", (v, t) => v === 0 && t.nws.office === "XXX", "gridY from api.weather.gov/points/{lat},{lon}"],
  ["nws.alerts_zone", (v) => /^[A-Z]{2}Z000$/.test(v), "forecast zone, e.g. MEZ026"],
  ["nws.marine_zone", (v) => /^XX/.test(v), "coastal waters zone, or set features.marine to false", (t) => feature(t, "marine")],
  ["nws.radar_station", (v) => v === "KXXX", "nearest radar, e.g. KGYX"],
  ["tides.station", (v) => /^0+$/.test(v), "NOAA tide station ID, or set features.tides to false", (t) => feature(t, "tides")],
  ["location.lat", (v, t) => v === 39.8283 && t.location.lon === -98.5795, "your town's coordinates"],
  ["location.lon", (v, t) => v === -98.5795 && t.location.lat === 39.8283, "your town's coordinates"],
  ["outages.match_town", (v) => /^(EXAMPLETON|DRYFORK)$/i.test(v), "town name exactly as your utility's data spells it (see 'python3 scripts/fetch_outages.py --towns')"],
  ["outages.match_county", (v) => /^EXAMPLE/i.test(v), "county name as your utility's data spells it"],
  ["alerts.demo_event", (v, t) => !feature(t, "marine") && /hurricane|tropical|gale|surge|tsunami/i.test(v),
    "the ?storm=demo preview alert; pick one your area gets, e.g. Red Flag Warning"],
];

function walk(node, prefix, out) {
  if (typeof node === "string") out.push([prefix, node]);
  else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${prefix}[${i}]`, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) if (k !== "_comment") walk(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

function get(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

const short = (v) => (v.length > 60 ? v.slice(0, 57) + "..." : v);
const isUrlField = (p) => /(^|\.)(url|[a-z_]*_url)$/.test(p);

function findPlaceholders(town) {
  const found = [];
  const seen = new Set();
  const add = (p, value, hint) => { if (!seen.has(p)) { seen.add(p); found.push({ path: p, value: short(String(value)), hint }); } };

  for (const [p, test, hint, applies] of RULES) {
    const v = get(town, p);
    if (v !== undefined && (!applies || applies(town)) && test(v, town)) add(p, v, hint);
  }

  const strings = [];
  walk(town, "", strings);
  const inland = !feature(town, "marine");
  for (const [p, v] of strings) {
    if (isTodo(v) || /\bTODO\b/.test(v)) { add(p, v, "marked TODO: fill in or remove"); continue; }
    if (isUrlField(p) && !safeUrl(v)) { add(p, v, "must be an https:// URL (the page will not link to anything else)"); continue; }
    if (PLACEHOLDER_TEXT.test(v)) { add(p, v, "still contains example text"); continue; }
    if (inland && /^(local_meaning|fridge_card|alerts\.storm_event_pattern|site)/.test(p) && COASTAL_WORDS.test(v)) {
      add(p, v, "coastal wording in a town with features.marine set to false");
    }
  }
  return found;
}

const UA = "town-weather-hub-template config check (https://github.com/anniebritton/town-weather-hub-template)";

/* Ask NWS/NOAA whether the identifiers are real and consistent. Returns a list of problems. */
async function checkOnline(town, fetchFn = fetch) {
  const problems = [];
  const getJson = async (url) => {
    const res = await fetchFn(url, { headers: { "User-Agent": UA, Accept: "application/geo+json" } });
    return { status: res.status, body: res.ok ? await res.json() : null };
  };
  const bad = (p, msg) => problems.push({ path: p, value: "", hint: msg });

  const { lat, lon } = town.location || {};
  const nws = town.nws || {};
  try {
    const pts = await getJson(`https://api.weather.gov/points/${lat},${lon}`);
    if (pts.status === 404) bad("location", "NWS has no forecast for these coordinates (are they inside the U.S.?)");
    else if (!pts.body) bad("location", `NWS points lookup failed (HTTP ${pts.status})`);
    else {
      const p = pts.body.properties || {};
      const zone = String(p.forecastZone || "").split("/").pop();
      const diffs = [
        ["nws.office", nws.office, p.gridId], ["nws.grid_x", nws.grid_x, p.gridX], ["nws.grid_y", nws.grid_y, p.gridY],
        ["nws.alerts_zone", nws.alerts_zone, zone], ["nws.radar_station", nws.radar_station, p.radarStation],
      ];
      for (const [path_, have, want] of diffs) {
        if (want !== undefined && have !== want) bad(path_, `is ${JSON.stringify(have)} but NWS says ${JSON.stringify(want)} for ${lat},${lon}`);
      }
    }
    const kind = /C\d{3}$/.test(nws.alerts_zone || "") ? "county" : "forecast";
    if ((await getJson(`https://api.weather.gov/zones/${kind}/${nws.alerts_zone}`)).status === 404) {
      bad("nws.alerts_zone", `NWS does not recognise zone ${nws.alerts_zone}; the page would show a false ALL CLEAR`);
    }
    if (feature(town, "marine") && nws.marine_zone &&
        (await getJson(`https://api.weather.gov/zones/forecast/${nws.marine_zone}`)).status === 404) {
      bad("nws.marine_zone", `NWS does not recognise marine zone ${nws.marine_zone}`);
    }
    if (feature(town, "tides") && town.tides && town.tides.station) {
      const t = await fetchFn(`https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${encodeURIComponent(town.tides.station)}.json`, { headers: { "User-Agent": UA } });
      const body = t.ok ? await t.json().catch(() => null) : null;
      if (!body || !Array.isArray(body.stations) || !body.stations.length) bad("tides.station", `NOAA does not recognise tide station ${town.tides.station}`);
    }
  } catch (e) {
    bad("(network)", `online check could not finish: ${e.message}`);
  }
  return problems;
}

function usable(town) {
  for (const block of ["site", "location", "nws", "outages"]) if (!town[block]) return `Missing "${block}" block`;
  if (feature(town, "tides") && !town.tides) return 'Missing "tides" block (or set features.tides to false)';
  return null;
}

async function main(argv) {
  const args = argv.slice(2);
  const online = args.includes("--online");
  const file = path.resolve(args.find((a) => !a.startsWith("--")) || path.join(__dirname, "..", "town.json"));
  let town;
  try {
    town = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`Cannot read ${file}: ${e.message}`);
    return 2;
  }
  const unusable = usable(town);
  if (unusable) { console.error(`${unusable} in ${file}`); return 2; }

  const found = findPlaceholders(town);
  if (online) found.push(...(await checkOnline(town)));

  if (!found.length) {
    console.log(`${file}: nothing to fix${online ? " (online checks passed)" : ""}.`);
    return 0;
  }
  console.log(`${file}: ${found.length} thing(s) to fix:\n`);
  for (const f of found) console.log(`  ${f.path}${f.value ? ` = ${JSON.stringify(f.value)}` : ""}\n      ${f.hint}`);
  console.log("\nPlaceholders are fine while you work, but fill in the NWS and NOAA values first or the live data will fail.");
  return 1;
}

if (require.main === module) main(process.argv).then((code) => process.exit(code));
module.exports = { findPlaceholders, checkOnline };
