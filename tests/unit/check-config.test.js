const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { findPlaceholders } = require("../../scripts/check-config.js");

const root = path.join(__dirname, "..", "..");

test("the generic template reports its placeholders", () => {
  const paths = findPlaceholders(require("../../town.json")).map((f) => f.path);
  for (const p of ["nws.office", "nws.alerts_zone", "nws.radar_station", "tides.station", "outages.report_url"]) {
    assert.ok(paths.includes(p), `${p} should be flagged`);
  }
});

test("the Southport example has no placeholders", () => {
  assert.deepEqual(findPlaceholders(require("../../examples/southport/town.json")), []);
});

test("CLI exit codes: 1 for placeholders, 0 for a finished config, 2 for a missing file", () => {
  const { spawnSync } = require("node:child_process");
  const run = (...a) => spawnSync(process.execPath, [path.join(root, "scripts", "check-config.js"), ...a], { encoding: "utf8" });
  assert.equal(run().status, 1);
  assert.equal(run(path.join(root, "examples", "southport", "town.json")).status, 0);
  assert.equal(run(path.join(root, "nope.json")).status, 2);
});
