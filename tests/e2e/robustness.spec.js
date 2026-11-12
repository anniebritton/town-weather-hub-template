// Bad config or bad data must produce a clear message, and never hide a real alert.
const { test, expect } = require("@playwright/test");
const { mockNetwork, town, merge } = require("./helpers");

test("invalid town.json shows a visible error instead of a blank 'Checking…' page", async ({ page }) => {
  await mockNetwork(page);
  await page.route("**/town.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{not json" }));
  await page.goto("/");
  await expect(page.locator('[role="alert"]')).toContainText(/town\.json/i);
});

test("a missing town.json shows a visible error", async ({ page }) => {
  await mockNetwork(page);
  await page.route("**/town.json", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  await expect(page.locator('[role="alert"]')).toContainText(/town\.json/i);
});

test("a town.json missing required blocks names the missing block", async ({ page }) => {
  await mockNetwork(page);
  const cfg = { ...town }; delete cfg.nws;
  await page.route("**/town.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cfg) }));
  await page.goto("/");
  await expect(page.locator('[role="alert"]')).toContainText("nws");
});

for (const block of ["resources", "fire", "alerts", "drought", "local_meaning", "thresholds", "fridge_card"]) {
  test(`the page still works without the optional "${block}" block`, async ({ page }) => {
    await mockNetwork(page);
    const cfg = { ...town }; delete cfg[block];
    await page.route("**/town.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cfg) }));
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.locator("#tile-weather .tile-value")).not.toHaveClass(/skeleton/);
    await expect(page.locator("#forecast-summary .forecast-card")).toHaveCount(4);
    expect(errors).toEqual([]);
  });
}

test("a broken regex in local_meaning or alerts never hides real alerts", async ({ page }) => {
  const alert = { properties: { severity: "Moderate", event: "Red Flag Warning", headline: "RFW", description: "Dry and windy.", effective: new Date().toISOString(), expires: new Date().toISOString() } };
  await mockNetwork(page, { alerts: [alert], townPatch: {
    local_meaning: [{ pattern: "(", text: "never shown" }, { pattern: "red flag", text: "Fire danger is high." }],
    alerts: { storm_event_pattern: "(" },
  } });
  await page.goto("/");
  await expect(page.locator("#alerts-list .alert-card")).toHaveCount(1);
  await expect(page.locator("#tile-weather .tile-value")).toHaveText("Red Flag Warning");
  await expect(page.locator("#alerts-status")).not.toContainText("Couldn't load");
});

test("an alert zone NWS doesn't recognise is flagged instead of showing a green ALL CLEAR", async ({ page }) => {
  await mockNetwork(page, { zoneStatus: 404 });
  await page.goto("/");
  await expect(page.locator("#tile-weather .tile-value")).not.toHaveText("All clear");
  await expect(page.locator("#alerts-list")).not.toContainText("All clear");
  await expect(page.locator("#alerts-list")).toContainText(town.nws.alerts_zone);
});

test("a recognised zone with no alerts still shows All clear", async ({ page }) => {
  await mockNetwork(page, { zoneStatus: 200 });
  await page.goto("/");
  await expect(page.locator("#tile-weather .tile-value")).toHaveText("All clear");
});
