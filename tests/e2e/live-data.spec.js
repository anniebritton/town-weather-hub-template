// The page as served, against mocked NWS, NOAA tides, and a fixture outage file.
// (Nothing live: these tests need no internet and no keys.)
const { test, expect } = require("@playwright/test");
const { mockNetwork, town } = require("./helpers");

const o = town.outages;
const OUTAGES = {
  lastUpdated: "2000-01-01 12:00:00",
  totals: { customers: 100000, outages: 12, incidents: 4 },
  town: { level: "town", town: o.match_town, Outages: 5 },
  county: { county: o.match_county, Outages: 9 },
  towns: [],
};

test.beforeEach(async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  testInfo.pageErrors = errors;
});

test.afterEach(async ({}, testInfo) => {
  expect(testInfo.pageErrors, "uncaught page errors").toEqual([]);
});

test("page text comes from town.json", async ({ page }) => {
  await mockNetwork(page, { outages: OUTAGES });
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText(town.site.name);
  await expect(page.locator(".hero-kicker")).toHaveText(town.site.kicker);
  await expect(page).toHaveTitle(new RegExp(town.site.name));
  await expect(page.locator("#radar-img")).toHaveAttribute("src", new RegExp(`${town.nws.radar_station}_loop\\.gif`));
  await expect(page.locator(".btn-storm").first()).toHaveAttribute("href", `tel:${o.phone_dial}`);
  await expect(page.locator("#resources-pests li")).toHaveCount(town.resources.pests.length);
});

test("all three status tiles load values", async ({ page }) => {
  await mockNetwork(page, { outages: OUTAGES });
  await page.goto("/");
  for (const id of ["tile-weather", "tile-power", "tile-seas"]) {
    const value = page.locator(`#${id} .tile-value`);
    await expect(value).not.toHaveClass(/skeleton/);
    await expect(value, `${id} fell back to Unavailable`).not.toHaveText("Unavailable");
  }
});

test("no alerts shows All clear; an alert shows its event and local meaning", async ({ page }) => {
  await mockNetwork(page, { outages: OUTAGES });
  await page.goto("/");
  await expect(page.locator("#tile-weather .tile-value")).toHaveText("All clear");
  await expect(page.locator("#alerts-list")).toContainText(`No active weather alerts for ${town.site.place}`);

  const alert = { properties: { severity: "Moderate", event: "Small Craft Advisory", headline: "SCA", description: "Rough seas.", effective: new Date().toISOString(), expires: new Date().toISOString() } };
  const page2 = await page.context().newPage();
  await mockNetwork(page2, { outages: OUTAGES, alerts: [alert] });
  await page2.goto("/");
  await expect(page2.locator("#tile-weather .tile-value")).toHaveText("Small Craft Advisory");
  await expect(page2.locator("#alerts-list .alert-card")).toHaveCount(1);
  await expect(page2.locator("#alerts-list summary")).toHaveText(`What this means for ${town.site.place}`);
});

test("forecast shows the next four NWS periods with temperatures", async ({ page }) => {
  await mockNetwork(page, { outages: OUTAGES });
  await page.goto("/");
  const cards = page.locator("#forecast-summary .forecast-card");
  await expect(cards).toHaveCount(4);
  for (const temp of await cards.locator(".temp").allTextContents()) {
    expect(temp).toMatch(/^-?\d+°F$/);
  }
});

test("power section matches the outage data file", async ({ page }) => {
  await mockNetwork(page, { outages: OUTAGES });
  await page.goto("/#outages");
  const stats = page.locator("#outage-stats .stat-card");
  await expect(stats).toHaveCount(3);
  await expect(stats.nth(0)).toContainText(`5 customers out in ${town.site.place}`);
  await expect(stats.nth(1)).toContainText(`9 customers out in ${o.county_label}`);
  await expect(stats.nth(2)).toContainText(`12 customers out across all of ${o.utility_short}`);
  await expect(page.locator("#outage-updated")).toContainText(`data as of ${OUTAGES.lastUpdated}`);
  await expect(page.locator("#tile-power .tile-value")).toHaveText("5 out");
});

test("marine forecast parses the configured marine zone", async ({ page }) => {
  await mockNetwork(page, { outages: OUTAGES });
  await page.goto("/#marine");
  const periods = page.locator("#marine-forecast .marine-period");
  await expect(periods.first()).toBeVisible();
  await expect(page.locator("#marine-status")).toHaveText("");
  await expect(periods).toHaveCount(4);
  await expect(page.locator("#tile-seas .tile-value")).toHaveText("3–5 ft seas");
});

test("tides show the next four highs and lows and a 24-hour chart", async ({ page }) => {
  await mockNetwork(page, { outages: OUTAGES });
  await page.goto("/#marine");
  const chips = page.locator("#tides-strip .tide-chip");
  await expect(chips).toHaveCount(4);
  await expect(chips.first()).toContainText("(next)");
  await expect(page.locator("#tide-chart svg.tide-chart-svg")).toBeVisible();
});

test("pest meters score today from the hourly forecast", async ({ page }) => {
  await mockNetwork(page, { outages: OUTAGES });
  await page.goto("/#pests");
  for (const id of ["meter-mosquito", "meter-tick"]) {
    const level = page.locator(`#${id} .meter-level`);
    await expect(level).toHaveText(/^(Low|Moderate|High|Very High)$/);
    const label = await level.textContent();
    await expect(page.locator(`#${id}`)).toHaveAttribute("data-level", label.toLowerCase().replace(" ", "-"));
    await expect(page.locator(`#${id} .meter-day`)).toHaveCount(3);
    await expect(page.locator(`#${id} .meter-why`)).not.toBeEmpty();
  }
});
