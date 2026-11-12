// Contract between scripts/fetch_outages.py (writer) and loadOutages() in app.js (reader),
// checked against the committed data file.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const town = require("../fixtures/town.generic.json"); // frozen, so editing the root town.json cannot break these

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "data", "outages.json"), "utf8"));

test("outages data has a parseable lastUpdated timestamp", () => {
  assert.match(data.lastUpdated, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("outages data has numeric totals", () => {
  for (const key of ["customers", "outages", "incidents"]) {
    assert.equal(typeof data.totals[key], "number", `totals.${key}`);
  }
});

test("town and county are null or carry an Outages count", () => {
  for (const key of ["town", "county"]) {
    assert.ok(key in data, `${key} key missing`);
    if (data[key] !== null) assert.equal(typeof data[key].Outages, "number", `${key}.Outages`);
  }
});

test("towns lists towns with outage counts", () => {
  assert.ok(Array.isArray(data.towns));
  for (const t of data.towns) {
    assert.equal(typeof t.town, "string");
    assert.equal(typeof t.Outages, "number");
  }
});

test("data.town is the town-level row for the configured town, not a street row", () => {
  const want = town.outages.match_town.toUpperCase();
  if (data.town !== null) {
    assert.equal(data.town.level, "town");
    assert.equal(data.town.town.toUpperCase(), want);
  }
  const row = data.towns.find((t) => t.level === "town" && t.town.toUpperCase() === want) ?? null;
  assert.deepEqual(data.town, row);
});


// ---- the file as the page will actually receive it ----
const { execFileSync } = require("node:child_process");
const { checkOutageData } = require("../../app.js");

test("the bundled sample is marked as a sample, so the page never shows it as real data", () => {
  assert.equal(data.sample, true);
  assert.equal(checkOutageData(data).ok, false);
});

test("what scripts/fetch_outages.py writes is accepted by the page (writer/reader contract)", () => {
  const code = `
import json, sys
sys.path.insert(0, "scripts")
import fetch_outages as f
county = {"lastUpdated": "2020-06-01 07:25:00", "customers": 10, "outages": 3, "incidents": 1,
          "features": [{"properties": {"county": "EXAMPLE", "Outages": 3}}]}
town = {"features": [{"properties": {"level": "town", "town": "EXAMPLETON", "Outages": 3}}]}
f.validate_response(county, town)
print(json.dumps(f.build_result(county, town, {"match_town": "EXAMPLETON", "match_county": "EXAMPLE"})))`;
  let out;
  try {
    out = execFileSync("python3", ["-c", code], { cwd: path.join(__dirname, "..", ".."), encoding: "utf8" });
  } catch (e) {
    if (e.code === "ENOENT") return; // no python on this machine; the python suite covers the writer
    throw e;
  }
  const written = JSON.parse(out);
  const verdict = checkOutageData(written, 90, Date.parse(written.fetchedAt) + 60_000);
  assert.deepEqual(verdict, { ok: true });
  assert.equal(written.town.Outages, 3);
});
