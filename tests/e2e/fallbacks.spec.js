// Forces upstream outages to check every section's fallback message.
const { test, expect } = require("@playwright/test");
const { mockNetwork, town } = require("./helpers");

test("every section falls back to a plain message when its source is down", async ({ page }) => {
  await mockNetwork(page, { down: true });
  await page.goto("/");

  for (const id of ["tile-weather", "tile-power", "tile-seas"]) {
    await expect(page.locator(`#${id} .tile-value`)).toHaveText("Unavailable");
  }
  await expect(page.locator("#alerts-status")).toHaveText("Couldn't load live alerts right now — use the weather.gov link below.");
  await expect(page.locator("#forecast-summary")).toContainText("Forecast unavailable");
  await expect(page.locator("#outage-stats")).toContainText("Live outage numbers unavailable");
  await expect(page.locator("#marine-status")).toHaveText("Couldn't load live marine conditions — use the links below.");
  await expect(page.locator("#tides-strip a")).toHaveAttribute("href", new RegExp(`noaatidepredictions\\.html\\?id=${town.tides.station}`));
  for (const id of ["meter-mosquito", "meter-tick"]) {
    await expect(page.locator(`#${id} .meter-level`)).toHaveText("Unavailable");
  }
});
