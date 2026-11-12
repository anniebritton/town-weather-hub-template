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
const { isTodo, isOff, safeUrl, feature, getPath, safeDataFile } = require("../town-utils.js");

const COASTAL_WORDS = /\b(boat|boats|boating|hurricane|tropical storm|surf|tide|tides|seas|mooring|moorings|dock|docks|coastal|shore|shoreline|storm surge|rip current|small craft|gale)\b/i;
const PLACEHOLDER_TEXT = /example\.com|exampleton|dryfork|anystate|example county|example electric|555[-. ]?01\d\d|5550100|\b0{3}[-. ]?0{3}[-. ]?0{4}\b|\bTBD\b|\bX{3,}\b|your (town|utility)/i;
const ROOT = path.join(__dirname, "..");

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

/*
 * Keys that index.html / fridge-card.html read (data-town="a.b" and friends). If one is missing from
 * town.json the visitor sees the page's generic fallback text ("your town", "phone"), so report it.
 */
function findMissingBindings(town, htmlFiles = ["index.html", "fridge-card.html"]) {
  const found = [];
  const seen = new Set();
  for (const file of htmlFiles) {
    let html;
    try { html = fs.readFileSync(path.join(ROOT, file), "utf8"); } catch { continue; }
    for (const m of html.matchAll(/data-town(?:-href|-tel)?="([^"]+)"/g)) {
      const p = m[1];
      if (seen.has(p)) continue;
      seen.add(p);
      if (/^tides\./.test(p) && !feature(town, "tides")) continue;
      if (/^nws\.marine_/.test(p) && !feature(town, "marine")) continue;
      const v = getPath(town, p);
      if (v === undefined || v === null || String(v).trim() === "") {
        found.push({ path: p, value: "", hint: `missing: ${file} would show its generic fallback text ("your town", "phone", ...) here` });
      }
    }
  }
  return found;
}

/* The QR code file records the URL it encodes in its <title>; compare it with site.public_url. */
function findQrProblem(town, qrFile) {
  if (!qrFile || !fs.existsSync(qrFile)) return null;
  const svg = fs.readFileSync(qrFile, "utf8");
  const encoded = (svg.match(/<title>([^<]*)<\/title>/) || [])[1];
  const want = town.site && town.site.public_url;
  const regen = "regenerate it with the command in docs/adapting.md (step 6)";
  if (!encoded) return { path: "assets/site-qr.svg", value: "", hint: `does not record its URL, so it cannot be checked: ${regen}` };
  if (/example\.com/i.test(encoded)) return { path: "assets/site-qr.svg", value: encoded, hint: `encodes a placeholder URL: ${regen}` };
  if (want && encoded !== want) return { path: "assets/site-qr.svg", value: encoded, hint: `encodes a different URL than site.public_url (${want}): ${regen}` };
  return null;
}

const short = (v) => (v.length > 60 ? v.slice(0, 57) + "..." : v);
const isUrlField = (p) => /(^|\.)(url|[a-z_]*_url)$/.test(p);

function findPlaceholders(town, { qrFile, checkBindings = true } = {}) {
  const found = [];
  const seen = new Set();
  const add = (p, value, hint) => { if (!seen.has(p)) { seen.add(p); found.push({ path: p, value: short(String(value)), hint }); } };

  for (const [p, test, hint, applies] of RULES) {
    const v = get(town, p);
    if (v !== undefined && (!applies || applies(town)) && test(v, town)) add(p, v, hint);
  }

  const dataFile = town.outages && town.outages.data_file;
  if (dataFile !== undefined && !safeDataFile(dataFile)) {
    add("outages.data_file", dataFile, "must be a file inside data/ (for example data/outages.json); the page and the fetch script refuse anything else");
  }
  for (const [key, fallback] of [["max_source_age_minutes", 360], ["stale_after_minutes", 90]]) {
    const v = town.outages && town.outages[key];
    if (v !== undefined && !(Number.isInteger(v) && v > 0)) {
      add(`outages.${key}`, v, `must be a whole number of minutes above zero (a value of zero or less is ignored and ${fallback} is used)`);
    }
  }
  for (const [k, v] of Object.entries(town.features || {})) {
    if (typeof v !== "boolean") add(`features.${k}`, v, `must be true or false (not ${JSON.stringify(v)}); ${isOff(v) ? "it is being treated as OFF" : "it is being treated as on"}`);
  }
  (town.fridge_card && town.fridge_card.phones || []).forEach((p, i) => {
    if (!p || typeof p.number !== "string" || !p.number.trim()) add(`fridge_card.phones[${i}].number`, "", "missing: the card will show a TODO marker; add the number or remove the entry");
  });
  if (checkBindings) for (const f of findMissingBindings(town)) add(f.path, f.value, f.hint);
  const qr = findQrProblem(town, qrFile);
  if (qr) add(qr.path, qr.value, qr.hint);

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

  // The QR file is checked when the config sits next to its assets/ folder (the repo root), not for examples
  const qrFile = path.join(path.dirname(file), "assets", "site-qr.svg");
  const found = findPlaceholders(town, { qrFile });
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
module.exports = { findPlaceholders, checkOnline, findMissingBindings, findQrProblem };
