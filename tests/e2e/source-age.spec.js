// The utility's own timestamp: a frozen feed, the town's time zone, data_file confinement, and an empty town list.
const { test, expect } = require("@playwright/test");
const { mockNetwork, freshOutages, utilityStamp, OUTAGES_ON } = require("./helpers");

const HOUR = 3600 * 1000;
const unavailable = async (page) => {
  await expect(page.locator("#tile-power .tile-value")).toHaveText("Unavailable");
  await expect(page.locator("#tile-power")).not.toHaveClass(/is-ok/);
  await expect(page.locator("#outage-stats")).not.toContainText(/No outages in|None/);
};
const load = async (page, opts) => {
  const net = await mockNetwork(page, opts);
  await page.goto("/#outages");
  await expect(page.locator("#tile-power .tile-value")).not.toHaveClass(/skeleton/);
  return net;
};

test.describe("a frozen utility feed behind a fresh heartbeat", () => {
  // fetchedAt is a minute ago (our script ran), but the utility's own lastUpdated is 11 hours old
  const frozen = () => freshOutages({ town: null, county: null, totals: { customers: 100, outages: 0, incidents: 0 }, lastUpdated: utilityStamp(Date.now() - 11 * HOUR) });

  test("is not shown as 'No outages' or 'On'", async ({ page }) => {
    await load(page, { townPatch: OUTAGES_ON, outages: frozen() });
    await unavailable(page);
    await expect(page.locator("#outage-stats")).toContainText("has not updated recently");
  });

  test("a feed a few hours old is still fine under the 6 hour default", async ({ page }) => {
    await load(page, { townPatch: OUTAGES_ON, outages: freshOutages({ lastUpdated: utilityStamp(Date.now() - 3 * HOUR) }) });
    await expect(page.locator("#tile-power .tile-value")).toHaveText("5 out");
  });

  test("the limit is configurable with outages.max_source_age_minutes", async ({ page }) => {
    await load(page, { townPatch: { outages: { provider: "avangrid", max_source_age_minutes: 20 * 60 } }, outages: frozen() });
    await expect(page.locator("#tile-power .tile-value")).toHaveText("On");
    const p2 = await page.context().newPage();
    await load(p2, { townPatch: { outages: { provider: "avangrid", max_source_age_minutes: 30 } }, outages: freshOutages({ lastUpdated: utilityStamp(Date.now() - HOUR) }) });
    await unavailable(p2);
  });
});

test.describe("the utility's local time is read in location.timezone", () => {
  test("a wall-clock time 25 minutes ahead in the town's zone is in the future, so Unavailable", async ({ page }) => {
    // Written as the utility writes it (Chicago wall clock). Read as UTC it would look 5-6 hours OLD and pass.
    await load(page, { townPatch: OUTAGES_ON, outages: freshOutages({ lastUpdated: utilityStamp(Date.now() + 25 * 60000) }) });
    await unavailable(page);
  });

  test("the same Chicago wall-clock time is judged by the zone it is read in", async ({ page }) => {
    const p2 = await page.context().newPage();
    await load(p2, { townPatch: { location: { timezone: "America/Los_Angeles" }, outages: { provider: "avangrid" } }, outages: freshOutages({ lastUpdated: utilityStamp(Date.now()) }) });
    await unavailable(p2); // two hours ahead of real time when read as Pacific
  });

  test("the same wall-clock time is accepted when the town's zone says it is already past", async ({ page }) => {
    // Eastern is one hour ahead of Chicago, so Chicago's wall-clock "now" reads as one hour ago there: fine under 6 hours
    // (read in Pacific, two hours behind, the same text would land in the future)
    await load(page, { townPatch: { location: { timezone: "America/New_York" }, outages: { provider: "avangrid" } }, outages: freshOutages({ lastUpdated: utilityStamp(Date.now()) }) });
    await expect(page.locator("#tile-power .tile-value")).toHaveText("5 out");
  });

  for (const [label, timezone] of [["an unknown zone", "Nowhere/Land"], ["an empty zone", ""], ["a missing zone", null]]) {
    test(`${label} means the timestamp is unverifiable: Unavailable, with a hint`, async ({ page }) => {
      await load(page, { townPatch: { location: { timezone }, outages: { provider: "avangrid" } }, outages: freshOutages() });
      await unavailable(page);
      await expect(page.locator("#outage-stats")).toContainText("location.timezone");
    });
  }

  test("an unreadable timestamp format is unverifiable too", async ({ page }) => {
    await load(page, { townPatch: OUTAGES_ON, outages: freshOutages({ lastUpdated: "06/01/2030 6:50 AM" }) });
    await unavailable(page);
  });
});

test.describe("outages.data_file must be inside data/", () => {
  for (const bad of ["../package.json", "data/../package.json", "package.json", "https://evil.example/outages.json", "//evil.example/o.json", "/etc/passwd", "data/", ""]) {
    test(`'${bad}' is refused and never requested`, async ({ page }) => {
      const { requests } = await load(page, { townPatch: { outages: { provider: "avangrid", data_file: bad } }, outages: freshOutages() });
      await unavailable(page);
      await expect(page.locator("#outage-stats")).toContainText("data/");
      expect(requests.filter((u) => /evil\.example|package\.json|etc\/passwd/.test(u)), "requests").toEqual([]);
    });
  }

  test("a file inside data/ is read", async ({ page }) => {
    const { requests } = await load(page, { townPatch: { outages: { provider: "avangrid", data_file: "data/custom.json" } } });
    await page.route("**/data/custom.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(freshOutages()) }));
    await page.reload();
    await expect(page.locator("#tile-power .tile-value")).toHaveText("5 out");
    expect(requests.some((u) => u.endsWith("/data/custom.json"))).toBe(true);
  });
});

test.describe("no town row and no town list", () => {
  const empty = (over) => freshOutages({ town: null, county: null, towns: [], ...over });

  for (const verified of [false, true]) {
    test(`outages overall but no towns listed: 'No data', never 'None'/'On' (match_verified=${verified})`, async ({ page }) => {
      await load(page, { townPatch: OUTAGES_ON, outages: empty({ matchVerified: verified, totals: { customers: 100, outages: 40, incidents: 3 } }) });
      await expect(page.locator("#tile-power .tile-value")).toHaveText("No data");
      await expect(page.locator("#outage-stats")).toContainText("No data for");
      await expect(page.locator("#outage-stats")).toContainText("check match_town");
      await expect(page.locator("#outage-stats")).not.toContainText(/None|No outages in/);
      await expect(page.locator("#tile-power")).not.toHaveClass(/is-ok/);
    });
  }

  test("nothing out anywhere and no towns: there is nothing to contradict, so 'On'", async ({ page }) => {
    await load(page, { townPatch: OUTAGES_ON, outages: empty({ totals: { customers: 100, outages: 0, incidents: 0 } }) });
    await expect(page.locator("#tile-power .tile-value")).toHaveText("On");
  });
});
