// Hostile remote data and hostile config must never run script or forge links.
const { test, expect } = require("@playwright/test");
const { mockNetwork, freshOutages, OUTAGES_ON } = require("./helpers");

const PAYLOAD = '<img src=x onerror="window.__x=1">';
const SCRIPT_PAYLOAD = '"><script>window.__x=1</script>';

async function pwned(page) {
  await page.waitForTimeout(300);
  return page.evaluate(() => window.__x);
}

test("hostile NWS forecast fields are shown as text, never executed", async ({ page }) => {
  const evil = ["Today", "Tonight", "Thu", "Fri"].map((name) => ({
    name: PAYLOAD, temperature: PAYLOAD, temperatureUnit: PAYLOAD, detailedForecast: PAYLOAD,
  }));
  await mockNetwork(page, { forecast: evil });
  await page.goto("/");
  await expect(page.locator("#forecast-summary .forecast-card")).toHaveCount(4);
  expect(await pwned(page)).toBeUndefined();
  await expect(page.locator("#forecast-summary img")).toHaveCount(0);
});

test("hostile NWS alert fields are escaped", async ({ page }) => {
  const alert = { properties: {
    severity: PAYLOAD, event: PAYLOAD, headline: PAYLOAD, description: PAYLOAD, instruction: PAYLOAD,
    effective: PAYLOAD, expires: PAYLOAD,
  } };
  await mockNetwork(page, { alerts: [alert] });
  await page.goto("/");
  await expect(page.locator("#alerts-list .alert-card")).toHaveCount(1);
  expect(await pwned(page)).toBeUndefined();
  await expect(page.locator("#alerts-list img")).toHaveCount(0);
});

test("hostile outage data (strings where numbers belong) cannot inject markup", async ({ page }) => {
  const evil = freshOutages({
    totals: { customers: 1, outages: PAYLOAD, incidents: 1 },
    town: { level: "town", town: "X", Outages: PAYLOAD },
    county: { county: "X", Outages: PAYLOAD },
  });
  await mockNetwork(page, { outages: evil, townPatch: OUTAGES_ON });
  await page.goto("/#outages");
  await expect(page.locator("#tile-power .tile-value")).not.toHaveClass(/skeleton/);
  expect(await pwned(page)).toBeUndefined();
  await expect(page.locator("#outage-stats img")).toHaveCount(0);
  await expect(page.locator("#tile-power .tile-value")).toHaveText("Unavailable");
});

test("hostile NOAA tide data cannot inject markup", async ({ page }) => {
  await mockNetwork(page);
  await page.route("https://api.tidesandcurrents.noaa.gov/**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ predictions: [
      { t: PAYLOAD, v: PAYLOAD, type: PAYLOAD },
      { t: "2999-01-01 10:00", v: "1.0", type: PAYLOAD },
      { t: "2999-01-01 16:00", v: "9.0", type: "H" },
    ] }),
  }));
  await page.goto("/#marine");
  await expect(page.locator("#tides-strip")).not.toContainText("Checking");
  expect(await pwned(page)).toBeUndefined();
  await expect(page.locator("#tides-strip img, #tide-chart img")).toHaveCount(0);
});

test("a hostile NWS marine product cannot inject markup", async ({ page }) => {
  await mockNetwork(page);
  const { town } = require("./helpers");
  await page.route("https://api.weather.gov/products/mock", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ productText: `${town.nws.marine_zone}-142300-\n.TONIGHT...${PAYLOAD} winds 10 kt. Seas ${PAYLOAD} ft. Wave Detail: ${PAYLOAD}.\n$$` }),
  }));
  await page.goto("/#marine");
  await page.waitForTimeout(300);
  expect(await pwned(page)).toBeUndefined();
  await expect(page.locator("#marine-forecast img")).toHaveCount(0);
});

test("javascript:, data: and http: URLs in town.json never reach href, src, or iframe src", async ({ page }) => {
  const bad = "javascript:window.parent.__x=1";
  const dataUrl = "data:text/html,<script>window.parent.__x=1</script>";
  await mockNetwork(page, { townPatch: {
    fire: { map_url: bad },
    drought: { image_url: dataUrl },
    outages: { report_url: bad, map_url: "http://insecure.example/map" },
    resources: {
      flood: [{ title: "x", url: bad, description: "d" }],
      drought: [{ title: "x", url: dataUrl, description: "d" }],
      pests: [{ title: "x", url: "HTTPS://ok.example/", description: "d" }],
    },
  } });
  await page.goto("/");
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
  const attrs = await page.evaluate(() => [...document.querySelectorAll("[href],[src]")]
    .map((n) => n.getAttribute("href") ?? n.getAttribute("src")).filter(Boolean));
  for (const a of attrs) expect(a, `unsafe URL in markup: ${a}`).not.toMatch(/^(javascript|data:text\/html|http:)/i);
  // an unsafe map URL means no frame at all (only the safe full-screen link, if any)
  await expect(page.locator("#fire-map")).toHaveCount(0);
});

test("config values that end up in URLs and HTML are validated, not interpolated blindly", async ({ page }) => {
  const evil = '"><img src=x onerror="window.__x=1">';
  // NOAA down, so the tide fallback links (which embed the station) are rendered
  await mockNetwork(page, { down: true, townPatch: { tides: { station: evil }, nws: { marine_zone: evil, radar_station: evil } } });
  await page.goto("/#marine");
  await expect(page.locator("#tides-strip")).not.toContainText("Checking");
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
  await expect(page.locator("#tides-strip img, #tide-chart img, img[src='x']")).toHaveCount(0);
  const hrefs = await page.evaluate(() => [...document.querySelectorAll("a[href],img[src]")].map((n) => n.getAttribute("href") || n.getAttribute("src")));
  for (const h of hrefs) expect(h, h).not.toContain("onerror");
});

test("third-party iframes are sandboxed and do not send a referrer", async ({ page }) => {
  await mockNetwork(page);
  await page.goto("/");
  for (const id of ["windy-map", "climate-map", "fire-map"]) {
    const f = page.locator(`#${id}`);
    await expect(f).toHaveAttribute("sandbox", /allow-scripts/);
    await expect(f).toHaveAttribute("referrerpolicy", "no-referrer");
  }
});
