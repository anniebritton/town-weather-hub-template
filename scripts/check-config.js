#!/usr/bin/env node
// Reports which town.json values are still template placeholders.
//   node scripts/check-config.js [path/to/town.json]     (or: npm run check-config)
// Exit code 0 when no placeholders remain, 1 when some do, 2 when the file is unusable.
const fs = require("node:fs");
const path = require("node:path");

// [dotted path, test(value), hint]
const RULES = [
  ["nws.office", (v) => v === "XXX", "NWS forecast office, e.g. GYX"],
  ["nws.grid_x", (v, t) => v === 0 && t.nws.grid_y === 0, "gridX from api.weather.gov/points/{lat},{lon}"],
  ["nws.grid_y", (v, t) => v === 0 && t.nws.grid_x === 0, "gridY from api.weather.gov/points/{lat},{lon}"],
  ["nws.alerts_zone", (v) => /^[A-Z]{2}Z000$/.test(v), "forecast zone, e.g. MEZ026"],
  ["nws.marine_zone", (v) => /^XX/.test(v), "coastal waters zone (or delete the Seas tab if inland)"],
  ["nws.radar_station", (v) => v === "KXXX", "nearest radar, e.g. KGYX"],
  ["tides.station", (v) => /^0+$/.test(v), "NOAA tide station ID (or delete the tide section if inland)"],
  ["location.lat", (v, t) => v === 39.8283 && t.location.lon === -98.5795, "your town's coordinates"],
  ["location.lon", (v, t) => v === -98.5795 && t.location.lat === 39.8283, "your town's coordinates"],
];

const PLACEHOLDER_TEXT = /example\.com|exampleton|anystate|example county|example electric|555-01\d\d|\b5550100\b/i;

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

function findPlaceholders(town) {
  const found = [];
  for (const [p, test, hint] of RULES) {
    const v = get(town, p);
    if (v !== undefined && test(v, town)) found.push({ path: p, value: String(v), hint });
  }
  const strings = [];
  walk(town, "", strings);
  const seen = new Set(found.map((f) => f.path));
  for (const [p, v] of strings) {
    if (!seen.has(p) && PLACEHOLDER_TEXT.test(v)) found.push({ path: p, value: v.length > 60 ? v.slice(0, 57) + "..." : v, hint: "still contains example text" });
  }
  return found;
}

function main(argv) {
  const file = path.resolve(argv[2] || path.join(__dirname, "..", "town.json"));
  let town;
  try {
    town = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`Cannot read ${file}: ${e.message}`);
    return 2;
  }
  for (const block of ["site", "location", "nws", "tides", "outages"]) {
    if (!town[block]) { console.error(`Missing "${block}" block in ${file}`); return 2; }
  }
  const found = findPlaceholders(town);
  if (!found.length) {
    console.log(`${file}: no placeholder values found.`);
    return 0;
  }
  console.log(`${file}: ${found.length} value(s) still look like placeholders:\n`);
  for (const f of found) console.log(`  ${f.path} = ${JSON.stringify(f.value)}\n      ${f.hint}`);
  console.log("\nPlaceholders are fine while you work, but fill in the NWS and NOAA values first or the live data will fail.");
  return 1;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { findPlaceholders };
