// The Power section must never show reassurance it cannot back up.
const { test, expect } = require("@playwright/test");
const { mockNetwork, town, freshOutages, OUTAGES_ON } = require("./helpers");

const expectUnavailable = async (page) => {
  await expect(page.locator("#tile-power .tile-value")).toHaveText("Unavailable");
  await expect(page.locator("#tile-power")).not.toHaveClass(/is-ok/);
  await expect(page.locator("#outage-stats")).not.toContainText(/No outages in/);
};

test("provider 'none' never shows 'On' or 'None', even if a data file exists", async ({ page }) => {
  await mockNetwork(page, { outages: freshOutages() }); // root config has provider "none"
  await page.goto("/#outages");
  await expectUnavailable(page);
  await expect(page.locator("#outage-stats")).toContainText(town.outages.utility_short);
});

test("the bundled sample data file is never presented as real", async ({ page }) => {
  await mockNetwork(page, { townPatch: OUTAGES_ON }); // no route: serves data/outages.json from the repo
  await page.goto("/#outages");
  await expectUnavailable(page);
});

test("a missing data file shows Unavailable", async ({ page }) => {
  await mockNetwork(page, { townPatch: OUTAGES_ON, outagesStatus: 404 });
  await page.goto("/#outages");
  await expectUnavailable(page);
});

test("junk data ({}), wrong shapes, and stale data show Unavailable, not a green tile", async ({ page }) => {
  for (const data of [
    {},
    { lastUpdated: null, totals: { outages: null } },
    freshOutages({ totals: undefined }),
    freshOutages({ fetchedAt: new Date(Date.now() - 6 * 3600 * 1000).toISOString() }), // stale
    freshOutages({ fetchedAt: "not a date" }),
    freshOutages({ sample: true }),
  ]) {
    const p = await page.context().newPage();
    await mockNetwork(p, { townPatch: OUTAGES_ON, outages: data });
    await p.goto("/#outages");
    await expectUnavailable(p);
    await p.close();
  }
});

test("fresh data with no outages in town or county shows the green state", async ({ page }) => {
  // nothing out anywhere, so a missing town row really does mean "no outages"
  await mockNetwork(page, { townPatch: OUTAGES_ON, outages: freshOutages({ town: null, county: null, totals: { customers: 100000, outages: 0, incidents: 0 } }) });
  await page.goto("/#outages");
  await expect(page.locator("#tile-power .tile-value")).toHaveText("On");
});

test("fresh data with outages in town shows the counts", async ({ page }) => {
  await mockNetwork(page, { townPatch: OUTAGES_ON, outages: freshOutages() });
  await page.goto("/#outages");
  await expect(page.locator("#tile-power .tile-value")).toHaveText("5 out");
});

test("the stale threshold is configurable", async ({ page }) => {
  const twoHoursOld = freshOutages({ fetchedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString() });
  await mockNetwork(page, { townPatch: { outages: { provider: "avangrid", stale_after_minutes: 600 } }, outages: twoHoursOld });
  await page.goto("/#outages");
  await expect(page.locator("#tile-power .tile-value")).toHaveText("5 out");
});
