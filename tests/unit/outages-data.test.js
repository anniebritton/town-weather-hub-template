// Contract between scripts/fetch_outages.py (writer) and loadOutages() in app.js (reader),
// checked against the committed data file.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const town = require("../../town.json");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", town.outages.data_file), "utf8"));

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
