// Scoring model for the Ticks & Mosquitoes meters (pests.js exports these for Node).
const test = require("node:test");
const assert = require("node:assert/strict");
const { mosquitoScore, tickScore, pestLevel, mosquitoSeason, tickSeason } = require("../../pests.js");

const JAN = 0, MAY = 4, JUL = 6;

// A day of hourly readings with the same conditions every hour
function day({ temp, rh, wind }) {
  return Array.from({ length: 24 }, (_, hour) => ({ hour, temp, rh, wind, day: hour >= 7 && hour <= 18 }));
}

test("pestLevel buckets scores at the 0.25 / 0.5 / 0.75 boundaries", () => {
  assert.equal(pestLevel(0).label, "Low");
  assert.equal(pestLevel(0.2499).label, "Low");
  assert.equal(pestLevel(0.25).label, "Moderate");
  assert.equal(pestLevel(0.5).label, "High");
  assert.equal(pestLevel(0.75).label, "Very High");
  assert.equal(pestLevel(1.4).label, "Very High");
});

test("seasonal multipliers peak in summer for mosquitoes and late spring for ticks", () => {
  assert.equal(mosquitoSeason(JUL), 1);
  assert.equal(mosquitoSeason(JAN), 0.05);
  assert.equal(tickSeason(MAY), 1);
  assert.equal(tickSeason(JAN), 0.25);
});

test("warm, humid, still July evening reads Very High for mosquitoes", () => {
  const score = mosquitoScore(day({ temp: 75, rh: 85, wind: 3 }), JUL);
  assert.equal(pestLevel(score).label, "Very High");
});

test("hot but dry, windy July day stays Low/Moderate for mosquitoes", () => {
  // The case that sank the original additive model (see comment in pests.js)
  const score = mosquitoScore(day({ temp: 88, rh: 30, wind: 18 }), JUL);
  assert.ok(score < 0.5, `expected Low/Moderate, got ${score.toFixed(2)}`);
});

test("mosquito score uses dusk hours when at least three are available", () => {
  const hours = day({ temp: 45, rh: 40, wind: 15 }).map((h) =>
    h.hour >= 17 && h.hour <= 22 ? { ...h, temp: 75, rh: 85, wind: 3 } : h);
  assert.equal(pestLevel(mosquitoScore(hours, JUL)).label, "Very High");
});

test("January is too cold for mosquitoes", () => {
  assert.equal(pestLevel(mosquitoScore(day({ temp: 30, rh: 80, wind: 5 }), JAN)).label, "Low");
});

test("ticks are inactive when the daytime high stays below 40°F", () => {
  assert.equal(tickScore(day({ temp: 38, rh: 90, wind: 2 }), MAY), 0.05);
});

test("mild, humid May day reads Very High for ticks", () => {
  assert.equal(pestLevel(tickScore(day({ temp: 65, rh: 80, wind: 5 }), MAY)).label, "Very High");
});

test("hot, dry weather suppresses tick questing", () => {
  const mild = tickScore(day({ temp: 70, rh: 30, wind: 5 }), MAY);
  const hotDry = tickScore(day({ temp: 82, rh: 30, wind: 5 }), MAY);
  assert.ok(hotDry < mild, `hot+dry ${hotDry.toFixed(2)} should be below mild ${mild.toFixed(2)}`);
});
