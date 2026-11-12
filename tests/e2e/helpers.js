// Network mocks shared by the e2e specs. Nothing here touches the internet or needs an API key:
// NWS, NOAA tides, and every third-party embed are intercepted.
const baseTown = require("../../town.json");
const town = baseTown;

/** Deep-merge `patch` into a copy of `base` (arrays and scalars are replaced). */
function merge(base, patch) {
  if (patch === undefined) return base;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(patch)) out[k] = v === null ? undefined : merge(out[k], v);
  return out;
}

const hourStr = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function tidePredictions() {
  const start = new Date();
  start.setHours(start.getHours() - 8, 0, 0, 0);
  return Array.from({ length: 12 }, (_, i) => ({
    t: hourStr(new Date(start.getTime() + i * 6 * 3600 * 1000)),
    v: i % 2 === 0 ? "1.0" : "9.0",
    type: i % 2 === 0 ? "L" : "H",
  }));
}

const marineText = (zone) => [
  `${zone}-142300-`,
  "Coastal waters of the example region-",
  ".TONIGHT...SW winds 10 to 15 kt. Seas 3 to 5 ft. Wave Detail: S 4 ft at 8 seconds.",
  ".THU...W winds 5 to 10 kt. Seas 2 to 3 ft.",
  ".THU NIGHT...W winds 5 kt. Seas 1 foot or less.",
  ".FRI...Variable winds less than 5 kt. Seas 1 foot or less.",
  "$$",
].join("\n");

const forecastPeriods = ["Today", "Tonight", "Thursday", "Thursday Night"].map((name) => ({
  name, temperature: 62, temperatureUnit: "F", detailedForecast: "Sunny, with a high near 62.",
}));

function hourlyPeriods() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  return Array.from({ length: 72 }, (_, i) => {
    const d = new Date(start.getTime() + i * 3600 * 1000);
    return {
      startTime: d.toISOString(), temperature: 70, relativeHumidity: { value: 70 },
      windSpeed: "5 mph", isDaytime: d.getHours() >= 7 && d.getHours() <= 18,
    };
  });
}

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

/**
 * Mock every external request. Pass { down: true } to make NWS/NOAA/outage data fail,
 * or { alerts: [...] } to supply NWS alert features.
 */
async function mockNetwork(page, {
  down = false, alerts = [], outages, townPatch, townConfig, forecast, outagesStatus, zoneStatus = 200,
} = {}) {
  const DOWN = { status: 503, body: "Service Unavailable" };
  const otherHosts = (url) => !/^(http:\/\/127\.0\.0\.1|data:)/.test(url.href);
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  const served = townConfig || merge(baseTown, townPatch);
  const MARINE_TEXT = marineText(served.nws.marine_zone || "XXZ001");

  // town.json: serve a replacement config (whole file or a patch on the default) when asked
  if (townConfig || townPatch) {
    await page.route("**/town.json", (route) => route.fulfill(json(served)));
  }

  // Block everything external by default (fonts, radar, embeds), then add specific mocks.
  await page.route(otherHosts, (route) => route.fulfill({ status: 204, body: "" }));

  await page.route("https://api.weather.gov/**", (route) => {
    if (down) return route.fulfill(DOWN);
    const url = route.request().url();
    if (url.includes("/zones/")) return route.fulfill(zoneStatus === 200 ? json({ id: "zone" }) : { status: zoneStatus, body: "" });
    if (url.includes("/alerts/active")) return route.fulfill(json({ features: alerts }));
    if (url.includes("/forecast/hourly")) return route.fulfill(json({ properties: { periods: hourlyPeriods() } }));
    if (url.includes("/forecast")) return route.fulfill(json({ properties: { periods: forecast || forecastPeriods } }));
    if (url.includes("/products/types/CWF/")) return route.fulfill(json({ "@graph": [{ "@id": "https://api.weather.gov/products/mock" }] }));
    if (url.endsWith("/products/mock")) return route.fulfill(json({ productText: MARINE_TEXT }));
    return route.fulfill(DOWN);
  });
  await page.route("https://api.tidesandcurrents.noaa.gov/**", (route) =>
    down ? route.fulfill(DOWN) : route.fulfill(json({ predictions: tidePredictions() })));
  if (down) {
    await page.route("**/data/outages.json", (route) => route.fulfill({ status: 404, body: "" }));
  } else if (outagesStatus) {
    await page.route("**/data/outages.json", (route) => route.fulfill({ status: outagesStatus, body: "" }));
  } else if (outages) {
    await page.route("**/data/outages.json", (route) => route.fulfill(json(outages)));
  }
  return { requests };
}

/** An outage file that looks freshly written by scripts/fetch_outages.py. */
function freshOutages(over = {}) {
  const o = baseTown.outages;
  return {
    status: "ok",
    fetchedAt: new Date().toISOString(),
    lastUpdated: "2000-01-01 12:00:00",
    totals: { customers: 100000, outages: 12, incidents: 4 },
    town: { level: "town", town: o.match_town, Outages: 5 },
    county: { county: o.match_county, Outages: 9 },
    towns: [],
    ...over,
  };
}

/** Config where live outages are switched on, for specs that exercise the outage UI. */
const OUTAGES_ON = { outages: { provider: "avangrid" } };

module.exports = { mockNetwork, town, merge, freshOutages, OUTAGES_ON };
