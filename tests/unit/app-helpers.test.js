// Text helpers from app.js (exported for Node the same way pests.js is).
// Town-specific values come from town.json, so these tests keep passing after you adapt it.
const test = require("node:test");
const assert = require("node:assert/strict");
// A frozen coastal config, so these tests do not depend on what you put in the root town.json
const town = require("../fixtures/town.generic.json");
const {
  setTown, nwsUrls, hazardLevel, localMeaning, isStormAlert, seasHeadline, extractZoneSection, parseMarinePeriods,
  parseMarineDetail, compressSeas, compressWind, compressWaves, windArrow, checkOutageData, findConfigProblem, hazardTag,
  tideStation, tideTableUrl,
} = require("../../app.js");

setTown(town);
const ZONE = town.nws.marine_zone;

test("hazardLevel grades forecast text by wind, seas, and wording", () => {
  const cases = {
    "Sunny, with a high near 62.": "",
    "Showers likely after 2pm.": "cond-watch",
    "Slight chance of showers.": "",
    "Heavy rain, mainly after midnight.": "cond-caution",
    "Breezy, with gusts up to 22 mph.": "cond-watch",
    "Windy, with gusts as high as 35 mph. Gusts to 35 mph.": "cond-caution",
    "NE winds 25 to 30 kt.": "cond-caution",
    "S winds 10 kt. Seas 5 ft.": "cond-watch",
    "Seas 8 to 10 ft.": "cond-caution",
    "Gale warning in effect.": "cond-severe",
    "Hurricane conditions possible.": "cond-severe",
  };
  for (const [text, level] of Object.entries(cases)) assert.equal(hazardLevel(text), level, text);
});

test("hazardLevel thresholds come from town.json", () => {
  setTown({ ...town, thresholds: { ...town.thresholds, seas_watch_ft: 2, seas_caution_ft: 3 } });
  assert.equal(hazardLevel("Seas 3 ft."), "cond-caution");
  assert.equal(hazardLevel("Seas 2 ft."), "cond-watch");
  setTown(town);
  assert.equal(hazardLevel("Seas 3 ft."), "");
});

test("NWS URLs are built from the configured office, grid, and zones", () => {
  const u = nwsUrls();
  const { office, grid_x, grid_y, alerts_zone } = town.nws;
  assert.equal(u.forecast, `https://api.weather.gov/gridpoints/${office}/${grid_x},${grid_y}/forecast`);
  assert.equal(u.hourly, `https://api.weather.gov/gridpoints/${office}/${grid_x},${grid_y}/forecast/hourly`);
  assert.equal(u.marineProducts, `https://api.weather.gov/products/types/CWF/locations/${office}`);
  assert.equal(u.alerts, `https://api.weather.gov/alerts/active?zone=${alerts_zone}`);
});

test("seasHeadline summarizes a period's seas for the hero tile", () => {
  assert.equal(seasHeadline("NW winds 10 kt. Seas 4 to 5 ft. Wave Detail: NW 4 ft at 4 seconds."), "4–5 ft seas");
  assert.equal(seasHeadline("S winds 5 kt. Seas around 2 ft."), "2 ft seas");
  assert.equal(seasHeadline("N winds 5 to 10 kt. Seas 1 foot or less."), "≤1 ft seas");
  assert.equal(seasHeadline("Seas around 2 ft in the evening, then 1 foot or less."), "2 ft seas");
  assert.equal(seasHeadline("Variable winds less than 5 kt."), null);
  assert.equal(seasHeadline(undefined), null);
});

test("marine compressors shorten NWS phrasing", () => {
  assert.equal(compressSeas("3 to 5 ft"), "3–5 ft");
  assert.equal(compressSeas("around 2 ft"), "~2 ft");
  assert.equal(compressSeas(""), "—");
  assert.match(compressWind("NE winds 10 to 15 kt with gusts up to 25 kt"), /^NE\s+10–15 kt with gusts 25 kt$/);
  assert.equal(compressWaves("SE 4 ft at 8 seconds and S 2 ft at 12 seconds"), "4 ft from the SE, every 8 s<br>2 ft from the S, every 12 s");
});

test("windArrow points downwind and skips variable winds", () => {
  assert.match(windArrow("NE winds 10 kt"), /rotate\(225deg\)/);
  assert.match(windArrow("N winds 5 kt"), /rotate\(180deg\)/);
  assert.equal(windArrow("Variable winds less than 5 kt"), "");
});

test("zone extraction and period parsing handle a coastal waters forecast", () => {
  const product = [
    `${ZONE}-142300-`,
    "Coastal waters of the example region out 25 NM-",
    ".TONIGHT...SW winds 10 to 15 kt. Seas 3 to 5 ft. Wave Detail: S 4 ft at 8 seconds.",
    ".THU...W winds 5 to 10 kt. Seas 2 to 3 ft. Patchy fog in the morning.",
    "$$",
    "ZZZ999-142300-",
    ".TONIGHT...Other zone.",
  ].join("\n");
  assert.equal(extractZoneSection(product, "QQQ999"), null);
  const section = extractZoneSection(product, ZONE);
  assert.ok(!section.includes("Other zone"));
  const periods = parseMarinePeriods(section);
  assert.deepEqual(periods.map((p) => p.name), ["TONIGHT", "THU"]);
  assert.deepEqual(parseMarineDetail(periods[0].body), { wind: "SW winds 10 to 15 kt", seas: "3 to 5 ft", waves: "S 4 ft at 8 seconds", note: "" });
});

test("a zone section also ends at the next zone header when there is no $$", () => {
  const product = [`${ZONE}-142300-`, ".TONIGHT...S winds 5 kt. Seas 1 ft.", "ZZZ999-142300-", ".TONIGHT...Other zone."].join("\n");
  assert.ok(!extractZoneSection(product, ZONE).includes("Other zone"));
});

test("advisory headlines are not treated as forecast periods", () => {
  const section = [
    `${ZONE}-151345-`,
    "Coastal Waters of the example region out 25 NM-",
    "743 PM EDT Wed Oct 14 2026",
    "",
    "...SMALL CRAFT ADVISORY IN EFFECT THROUGH THURSDAY MORNING...",
    "",
    ".TONIGHT...NW winds 10 to 15 kt. Seas 4 to 5 ft.",
    ".THU...NW winds 15 to 20 kt. Seas 3 to 5 ft.",
  ].join("\n");
  const periods = parseMarinePeriods(section);
  assert.deepEqual(periods.map((p) => p.name), ["TONIGHT", "THU"]);
  assert.equal(seasHeadline(periods[0].body), "4–5 ft seas");
});

test("storm mode triggers on severe alerts and configured storm event names only", () => {
  assert.equal(isStormAlert({ severity: "Severe", event: "Flood Warning" }), true);
  assert.equal(isStormAlert({ severity: "Moderate", event: "Gale Warning" }), true);
  assert.equal(isStormAlert({ severity: "Moderate", event: "Storm Warning" }), true);
  assert.equal(isStormAlert({ severity: "Moderate", event: "Ice Storm Warning" }), true);
  assert.equal(isStormAlert({ severity: "Moderate", event: "Severe Thunderstorm Watch" }), false);
  assert.equal(isStormAlert({ severity: "Minor", event: "Small Craft Advisory" }), false);
  assert.equal(isStormAlert(undefined), false);
});

test("each alert type gets guidance from the matching local_meaning entry, in order", () => {
  // event -> a keyword that must appear in the pattern of the entry that wins
  const expectedEntry = {
    "Hurricane Warning": "hurricane|tropical",
    "Tropical Storm Warning": "hurricane|tropical",
    "Hurricane Force Wind Warning": "hurricane force",
    "Coastal Flood Warning": "coastal flood",
    "Storm Surge Warning": "storm surge",
    "Gale Warning": "gale",
    "Storm Warning": "gale",
    "High Wind Warning": "high wind",
    "Severe Thunderstorm Warning": "severe thunderstorm",
    "Winter Storm Warning": "winter storm",
    "Ice Storm Warning": "ice storm",
    "Flash Flood Warning": "flood",
    "Small Craft Advisory": "small craft",
    "Dense Fog Advisory": "dense fog",
  };
  for (const [event, keyword] of Object.entries(expectedEntry)) {
    const winner = town.local_meaning.find((e) => new RegExp(e.pattern, "i").test(event));
    assert.ok(winner, `${event} matched no local_meaning entry`);
    assert.ok(winner.pattern.includes(keyword.split("|")[0]), `${event} matched "${winner.pattern}"`);
    assert.equal(localMeaning(event), winner.text);
  }
  assert.equal(localMeaning("Frost Advisory"), null);
});


/* ---------- safety and robustness (added with the review fixes) ---------- */

test("a broken regex in local_meaning is skipped; later entries still match", () => {
  setTown({ ...town, local_meaning: [{ pattern: "(", text: "never" }, { pattern: "red flag", text: "fire danger" }] });
  assert.equal(localMeaning("Red Flag Warning"), "fire danger");
  assert.equal(localMeaning(undefined), null);
  assert.equal(localMeaning({ not: "a string" }), null);
  setTown(town);
});

test("a broken storm_event_pattern never throws, and severity still triggers storm mode", () => {
  setTown({ ...town, alerts: { ...town.alerts, storm_event_pattern: "(" } });
  assert.equal(isStormAlert({ event: "Anything", severity: "Severe" }), true);
  assert.equal(isStormAlert({ event: "Anything", severity: "Minor" }), false);
  setTown({ ...town, alerts: undefined });
  assert.equal(isStormAlert({ severity: "Extreme" }), true);
  setTown(town);
});

test("nwsUrls refuses identifiers that are not the right shape", () => {
  for (const nws of [{ office: '"><x>' }, { alerts_zone: "../x" }, { grid_x: "1" }, { grid_y: 1.5 }]) {
    setTown({ ...town, nws: { ...town.nws, ...nws } });
    assert.throws(() => nwsUrls(), /town\.json/);
  }
  setTown(town);
});

test("tide station and table link are validated", () => {
  setTown({ ...town, tides: { station: '1"><x>' } });
  assert.equal(tideStation(), null);
  assert.equal(tideTableUrl(), "https://tidesandcurrents.noaa.gov/");
  setTown(town);
  assert.match(tideTableUrl(), /id=0000000$/);
});

test("findConfigProblem names what is wrong with town.json", () => {
  assert.equal(findConfigProblem(town), null);
  assert.match(findConfigProblem(null), /JSON object/);
  assert.match(findConfigProblem([]), /JSON object/);
  const noNws = { ...town }; delete noNws.nws;
  assert.match(findConfigProblem(noNws), /"nws"/);
  const none = {};
  assert.match(findConfigProblem(none), /"site", "location", "nws"/);
  assert.match(findConfigProblem({ ...town, site: { ...town.site, place: " " } }), /site\.place/);
});

test("hazardTag always explains a tint in words", () => {
  assert.equal(hazardTag(""), "");
  for (const level of ["cond-watch", "cond-caution", "cond-severe"]) assert.match(hazardTag(level), /cond-tag">[^<]{10,}</);
});

/* ---------- outage data: when is it safe to show as current? ---------- */

const NOW = Date.parse("2030-06-01T12:00:00Z");
const good = (over = {}) => ({
  status: "ok", fetchedAt: "2030-06-01T11:30:00Z", lastUpdated: "2030-06-01 07:25:00",
  totals: { customers: 100, outages: 3, incidents: 1 }, town: null, county: { county: "X", Outages: 3 }, towns: [], ...over,
});

test("checkOutageData accepts fresh, well-formed data", () => {
  assert.deepEqual(checkOutageData(good(), 90, NOW), { ok: true });
  assert.deepEqual(checkOutageData(good({ town: { level: "town", town: "X", Outages: 4 } }), 90, NOW), { ok: true });
});

test("checkOutageData rejects anything that could mislead", () => {
  const cases = {
    "not an object": null, "array": [], "empty": {}, "sample": good({ sample: true }),
    "status error": good({ status: "error" }), "no lastUpdated": good({ lastUpdated: "" }),
    "null totals": good({ totals: { outages: null } }), "string total": good({ totals: { outages: "3" } }),
    "string town count": good({ town: { Outages: "<img>" } }), "no town key": (() => { const g = good(); delete g.town; return g; })(),
    "no fetchedAt": good({ fetchedAt: undefined }), "bad fetchedAt": good({ fetchedAt: "yesterday" }),
    "stale": good({ fetchedAt: "2030-06-01T09:00:00Z" }),
  };
  for (const [name, data] of Object.entries(cases)) assert.equal(checkOutageData(data, 90, NOW).ok, false, name);
});

test("the stale threshold is configurable and falls back to a default", () => {
  const threeHours = good({ fetchedAt: "2030-06-01T09:00:00Z" });
  assert.equal(checkOutageData(threeHours, 240, NOW).ok, true);
  assert.equal(checkOutageData(threeHours, 60, NOW).ok, false);
  assert.equal(checkOutageData(threeHours, undefined, NOW).ok, false, "default is 90 minutes");
});
