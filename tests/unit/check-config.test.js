const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { findPlaceholders, checkOnline } = require("../../scripts/check-config.js");

const root = path.join(__dirname, "..", "..");
// A frozen copy of the unfinished template, so these tests keep passing after you adapt town.json
const placeholder = require("../fixtures/placeholder-town.json");
const clone = (o) => JSON.parse(JSON.stringify(o));
const paths = (town) => findPlaceholders(town).map((f) => f.path);

test("the unfinished template reports its placeholders, TODOs and example text", () => {
  const p = paths(placeholder);
  for (const want of ["nws.office", "nws.alerts_zone", "nws.radar_station", "tides.station", "outages.report_url",
    "outages.match_county", "outages.match_town", "outages.phone_dial", "outages.phone_display", "site.public_url",
    "outages.api_url", "fridge_card.phones[1].number"]) {
    assert.ok(p.includes(want), `${want} should be flagged`);
  }
});

test("a grid of 0,0 is only a placeholder while the office is still XXX", () => {
  const t = clone(placeholder);
  assert.ok(paths(t).includes("nws.grid_x"));
  t.nws.office = "GYX";
  assert.ok(!paths(t).includes("nws.grid_x") && !paths(t).includes("nws.grid_y"));
});

test("every TODO is reported, wherever it is", () => {
  const t = clone(placeholder);
  t.fire.season = "TODO: ask the county";
  t.resources.pests[0].title = "TODO";
  assert.ok(paths(t).includes("fire.season") && paths(t).includes("resources.pests[0].title"));
});

test("URLs that are not https are reported", () => {
  const t = clone(placeholder);
  t.fire.map_url = "javascript:alert(1)";
  t.resources.flood[0].url = "http://insecure.org/";
  const found = findPlaceholders(t);
  for (const p of ["fire.map_url", "resources.flood[0].url"]) {
    assert.match(found.find((f) => f.path === p).hint, /https/);
  }
});

test("coastal wording is only reported when marine is switched off", () => {
  const t = clone(placeholder);
  assert.ok(!paths(t).some((p) => p.startsWith("local_meaning")), "fine for a coastal town");
  t.features.marine = false;
  t.features.tides = false;
  assert.ok(paths(t).some((p) => p.startsWith("local_meaning")), "boats/hurricanes in an inland config");
  assert.ok(paths(t).includes("alerts.demo_event"), "hurricane demo event");
  assert.ok(!paths(t).includes("nws.marine_zone") && !paths(t).includes("tides.station"), "disabled sections need no ids");
});

test("the Southport example and a finished inland config have nothing to fix", () => {
  assert.deepEqual(findPlaceholders(require("../../examples/southport/town.json")), []);
});

test("CLI exit codes: 1 for unfinished, 0 for finished, 2 for a missing file", () => {
  const run = (...a) => spawnSync(process.execPath, [path.join(root, "scripts", "check-config.js"), ...a], { encoding: "utf8" });
  assert.equal(run(path.join(root, "tests", "fixtures", "placeholder-town.json")).status, 1);
  assert.equal(run(path.join(root, "examples", "southport", "town.json")).status, 0);
  assert.equal(run(path.join(root, "nope.json")).status, 2);
});

function fakeFetch(routes) {
  return async (url) => {
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    const r = hit ? hit[1] : { status: 404 };
    return { ok: r.status === 200, status: r.status, json: async () => r.body };
  };
}
const GOOD_POINTS = { status: 200, body: { properties: { gridId: "GYX", gridX: 90, gridY: 70, forecastZone: "https://api.weather.gov/zones/forecast/MEZ026", radarStation: "KGYX" } } };
const sp = require("../../examples/southport/town.json");

test("--online passes when NWS and NOAA agree with the config", async () => {
  const t = clone(sp);
  const f = fakeFetch({ "/points/": { status: 200, body: { properties: { gridId: t.nws.office, gridX: t.nws.grid_x, gridY: t.nws.grid_y, forecastZone: `x/${t.nws.alerts_zone}`, radarStation: t.nws.radar_station } } },
    "/zones/": { status: 200, body: {} }, "/stations/": { status: 200, body: { stations: [{ id: "1" }] } } });
  assert.deepEqual(await checkOnline(t, f), []);
});

test("--online catches a wrong grid, an unknown zone, and an unknown tide station", async () => {
  const t = clone(sp);
  t.nws.alerts_zone = "MEZ999";
  const f = fakeFetch({ "/points/": GOOD_POINTS, "/zones/forecast/MEZ999": { status: 404 }, "/zones/forecast/": { status: 200, body: {} },
    "/stations/": { status: 200, body: { stations: [] } } });
  const bad = (await checkOnline({ ...t, nws: { ...t.nws, grid_x: 1 } }, f)).map((p) => p.path);
  assert.ok(bad.includes("nws.grid_x") && bad.includes("nws.alerts_zone") && bad.includes("tides.station"), bad.join());
});

test("--online skips marine and tide checks for an inland config and survives network errors", async () => {
  const t = clone(require("../../examples/inland-desert/town.json"));
  const calls = [];
  const f = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ properties: {} }) }; };
  await checkOnline(t, f);
  assert.ok(!calls.some((u) => u.includes("tidesandcurrents")), "no tide lookup");
  const boom = async () => { throw new Error("offline"); };
  assert.match((await checkOnline(t, boom))[0].hint, /offline/);
});
