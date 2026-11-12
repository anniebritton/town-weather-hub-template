const test = require("node:test");
const assert = require("node:assert/strict");
const { safeUrl, telHref, isTodo, num, ident, SHAPES, feature, escapeHtml, applyBindings, applyFeatures, parseLocalTime, safeDataFile } = require("../../town-utils.js");

test("safeUrl accepts only https and normalises it", () => {
  assert.equal(safeUrl("https://example.org/a b"), "https://example.org/a%20b");
  assert.equal(safeUrl("HTTPS://Example.org/"), "https://example.org/");
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>1</script>", "http://example.org/",
    "ftp://example.org/", "//example.org/", "example.org", "", "TODO", "TODO: add a link", " ", null, undefined, 5, {}, ["https://a.b/"]]) {
    assert.equal(safeUrl(bad), null, String(bad));
  }
});

test("telHref makes a link only for a plausible number, never for TODO", () => {
  assert.equal(telHref("1-800-555-0100"), "tel:18005550100");
  assert.equal(telHref("+1 (207) 555-0100"), "tel:12075550100");
  for (const bad of ["TODO", "todo: add number", "911x", "12", "javascript:1", "", null, 18005550100,
    "911 or 555-0100", "(555) 123-0100 ext. 12", "555-0100", "1800696100012", "12075550123 12075550124",
    "call 207-555-0123", "207-555-0123 or 207-555-0124"]) assert.equal(telHref(bad), null, String(bad));
  assert.equal(telHref("(207) 555-0123"), "tel:2075550123");
  assert.equal(telHref("+1 207 555 0123"), "tel:12075550123");
});

test("isTodo recognises the placeholder convention", () => {
  for (const yes of ["TODO", "todo", "  TODO: fill in", "TODO add"]) assert.equal(isTodo(yes), true, yes);
  for (const no of ["TODOS", "Mastodon", "", null, undefined, 0]) assert.equal(isTodo(no), false, String(no));
});

test("num accepts only finite numbers, not numeric strings or markup", () => {
  assert.equal(num(5), 5);
  assert.equal(num(0), 0);
  for (const bad of ["5", "<img src=x>", NaN, Infinity, null, undefined, {}, []]) assert.equal(num(bad), null, String(bad));
});

test("ident enforces the documented identifier shapes", () => {
  assert.equal(ident("GYX", SHAPES.office), "GYX");
  assert.equal(ident('"><img src=x>', SHAPES.office), null);
  assert.equal(ident("MEZ026", SHAPES.alertsZone), "MEZ026");
  assert.equal(ident("MEC015", SHAPES.alertsZone), "MEC015");
  assert.equal(ident("8416908", SHAPES.tideStation), "8416908");
  assert.equal(ident("84/../x", SHAPES.tideStation), null);
  assert.equal(ident(8416908, SHAPES.tideStation), null);
});

test("feature values like 'false', 0, 'no' and 'off' count as off, not on", () => {
  for (const off of ["false", "FALSE", " no ", "off", "0", 0, false]) assert.equal(feature({ features: { pests: off } }, "pests"), false, String(off));
  for (const on of [true, "true", 1, undefined]) assert.equal(feature({ features: { pests: on } }, "pests"), true, String(on));
  assert.equal(feature({ features: { marine: "false" } }, "tides"), false);
});

test("features default to on, and turning marine off turns tides off", () => {
  assert.equal(feature({}, "marine"), true);
  assert.equal(feature(undefined, "pests"), true);
  assert.equal(feature({ features: { marine: false } }, "tides"), false);
  assert.equal(feature({ features: { marine: true, tides: false } }, "tides"), false);
  assert.equal(feature({ features: { pests: false } }, "pests"), false);
});

test("escapeHtml escapes the five dangerous characters", () => {
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&`), "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;");
  assert.equal(escapeHtml(null), "");
});

// A tiny stand-in for the DOM, just enough for applyBindings / applyFeatures
function fakeDoc(nodes) {
  const make = (n) => ({
    ...n, attrs: {}, classes: new Set(), hidden: false, removed: false,
    get dataset() { return n.dataset; },
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    classList: { add: (c) => made.find((m) => m.i === n.i).classes.add(c) }, remove() { this.removed = true; },
  });
  const made = nodes.map((n, i) => Object.assign(make({ ...n, i }), { i }));
  return { made, querySelectorAll: (sel) => made.filter((n) => sel.includes(Object.keys(n.dataset)[0]?.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()))) };
}

test("applyBindings: unsafe links are hidden, TODO phones are never dialable", () => {
  const town = { outages: { map_url: "javascript:alert(1)", report_url: "https://ok.example/", phone_dial: "TODO", phone_display: "TODO" } };
  const doc = {
    nodes: [
      { dataset: { townHref: "outages.map_url" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, hidden: false },
      { dataset: { townHref: "outages.report_url" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, hidden: false },
      { dataset: { townTel: "outages.phone_dial" }, attrs: { href: "tel:" }, classes: new Set(), classList: { add() {} }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } },
      { dataset: { town: "outages.phone_display" }, textContent: "" },
    ],
    querySelectorAll(sel) {
      const key = sel.match(/data-([a-z-]+)/)[1].replace(/-(\w)/g, (_, c) => c.toUpperCase());
      return this.nodes.filter((n) => key in n.dataset);
    },
  };
  applyBindings(town, doc);
  assert.equal(doc.nodes[0].hidden, true);
  assert.equal(doc.nodes[0].attrs.href, undefined);
  assert.equal(doc.nodes[1].attrs.href, "https://ok.example/");
  assert.equal(doc.nodes[2].attrs.href, undefined, "no tel: link for TODO");
  assert.equal(doc.nodes[3].textContent, "TODO: add number");
});

test("applyFeatures removes elements for switched-off features", () => {
  const nodes = [{ dataset: { feature: "marine" } }, { dataset: { feature: "pests" } }, { dataset: { feature: "tides" } }]
    .map((n) => ({ ...n, removed: false, remove() { this.removed = true; } }));
  applyFeatures({ features: { marine: false } }, { querySelectorAll: () => nodes });
  assert.deepEqual(nodes.map((n) => n.removed), [true, false, true]);
});

test("parseLocalTime reads local time in the given IANA zone, across daylight saving", () => {
  const iso = (ms) => new Date(ms).toISOString();
  assert.equal(iso(parseLocalTime("2030-06-01 07:25:00", "America/Chicago")), "2030-06-01T12:25:00.000Z");
  assert.equal(iso(parseLocalTime("2030-01-15 07:25:00", "America/Chicago")), "2030-01-15T13:25:00.000Z");
  assert.equal(iso(parseLocalTime("2030-03-10 03:30:00", "America/New_York")), "2030-03-10T07:30:00.000Z", "just after spring forward");
  assert.equal(iso(parseLocalTime("2030-06-01T07:25", "UTC")), "2030-06-01T07:25:00.000Z");
  assert.equal(iso(parseLocalTime("2030-06-01T07:25:00+02:00", undefined)), "2030-06-01T05:25:00.000Z");
  assert.equal(iso(parseLocalTime("2030-06-01T07:25:00Z", undefined)), "2030-06-01T07:25:00.000Z");
});

test("parseLocalTime returns null when it cannot be sure", () => {
  for (const [v, tz] of [["2030-06-01 07:25:00", undefined], ["2030-06-01 07:25:00", ""], ["2030-06-01 07:25:00", "Nowhere/Land"],
    ["2030-13-01 07:25:00", "UTC"], ["2030-02-31 07:25:00", "UTC"], ["2030-06-01 25:00:00", "UTC"], ["06/01/2030 7:25 AM", "UTC"],
    [null, "UTC"], [20300601, "UTC"], ["", "UTC"]]) assert.equal(parseLocalTime(v, tz), null, `${v} / ${tz}`);
});

test("safeDataFile accepts only a plain file path inside data/", () => {
  for (const ok of ["data/outages.json", "data/a/b.json", "data/outages-2.json"]) assert.equal(safeDataFile(ok), ok);
  for (const bad of ["../app.js", "data/../app.js", "data/./x.json", "data/", "data", "/data/outages.json", "/etc/passwd",
    "https://evil.example/data/outages.json", "//evil.example/x.json", "data\\outages.json", "app.js", "town.json", "", null, undefined, 5, "data/a b.json", "data/x.json?x=1"]) {
    assert.equal(safeDataFile(bad), null, String(bad));
  }
});

// The same case files are run through scripts/fetch_outages.py (tests/python), so the page and the script cannot drift apart.
const fs = require("node:fs");
const path = require("node:path");
const fixtures = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8"));

test("parseLocalTime agrees with every case in tests/fixtures/time-cases.json", () => {
  const cases = fixtures("time-cases.json");
  assert.ok(cases.length > 40);
  for (const { value, tz, utc, note } of cases) {
    const ms = parseLocalTime(value, tz === null ? undefined : tz);
    const got = ms === null ? null : new Date(ms).toISOString().replace(".000Z", "Z");
    assert.equal(got, utc, `${JSON.stringify(value)} in ${JSON.stringify(tz)} (${note})`);
  }
});

test("safeDataFile agrees with every case in tests/fixtures/data-file-cases.json", () => {
  const cases = fixtures("data-file-cases.json");
  assert.ok(cases.length > 25);
  for (const { path: p, ok, note } of cases) assert.equal(safeDataFile(p) !== null, ok, `${JSON.stringify(p)} (${note})`);
});

test("parseLocalTime rejects minute 60, second 61, and a spring-forward gap; it takes the first of an ambiguous time", () => {
  assert.equal(parseLocalTime("2030-06-01 07:60:00", "UTC"), null);
  assert.equal(parseLocalTime("2030-06-01 07:25:61", "UTC"), null);
  assert.equal(parseLocalTime("2026-03-08 02:30:00", "America/New_York"), null);
  assert.equal(new Date(parseLocalTime("2026-11-01 01:30:00", "America/New_York")).toISOString(), "2026-11-01T05:30:00.000Z");
  assert.equal(parseLocalTime("2030-06-01T07:25:00+99:99"), null);
  assert.equal(parseLocalTime("2030-06-01T07:25:00+15:00"), null);
});
