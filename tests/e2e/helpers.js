// Network mocks shared by the e2e specs. Nothing here touches the internet or needs an API key:
// NWS, NOAA tides, and every third-party embed are intercepted.
const town = require("../../town.json");

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

const MARINE_TEXT = [
  `${town.nws.marine_zone}-142300-`,
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
async function mockNetwork(page, { down = false, alerts = [], outages } = {}) {
  const DOWN = { status: 503, body: "Service Unavailable" };
  const otherHosts = (url) => !/^(http:\/\/127\.0\.0\.1|data:)/.test(url.href);

  // Block everything external by default (fonts, radar, embeds), then add specific mocks.
  await page.route(otherHosts, (route) => route.fulfill({ status: 204, body: "" }));

  await page.route("https://api.weather.gov/**", (route) => {
    if (down) return route.fulfill(DOWN);
    const url = route.request().url();
    if (url.includes("/alerts/active")) return route.fulfill(json({ features: alerts }));
    if (url.includes("/forecast/hourly")) return route.fulfill(json({ properties: { periods: hourlyPeriods() } }));
    if (url.includes("/forecast")) return route.fulfill(json({ properties: { periods: forecastPeriods } }));
    if (url.includes("/products/types/CWF/")) return route.fulfill(json({ "@graph": [{ "@id": "https://api.weather.gov/products/mock" }] }));
    if (url.endsWith("/products/mock")) return route.fulfill(json({ productText: MARINE_TEXT }));
    return route.fulfill(DOWN);
  });
  await page.route("https://api.tidesandcurrents.noaa.gov/**", (route) =>
    down ? route.fulfill(DOWN) : route.fulfill(json({ predictions: tidePredictions() })));
  if (down) {
    await page.route("**/data/outages.json", (route) => route.fulfill({ status: 404, body: "" }));
  } else if (outages) {
    await page.route("**/data/outages.json", (route) => route.fulfill(json(outages)));
  }
}

module.exports = { mockNetwork, town };
