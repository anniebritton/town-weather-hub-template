// Every config shipped in this repo (the template and each worked example) must load into a working page.
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { mockNetwork } = require("./helpers");

const root = path.join(__dirname, "..", "..");
const configs = [["town.json", require("../../town.json")]];
for (const d of fs.readdirSync(path.join(root, "examples")).sort()) {
  const f = path.join(root, "examples", d, "town.json");
  if (fs.existsSync(f)) configs.push([`examples/${d}`, JSON.parse(fs.readFileSync(f, "utf8"))]);
}

for (const [label, cfg] of configs) {
  test(`${label}: the hub loads with no errors and every tile resolves`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await mockNetwork(page, { townConfig: cfg });
    await page.goto("/");
    await expect(page.locator("h1")).toHaveText(cfg.site.name);
    for (const tile of await page.locator(".status-tile").all()) {
      await expect(tile.locator(".tile-value")).not.toHaveClass(/skeleton/);
    }
    await expect(page.locator("#forecast-summary .forecast-card")).toHaveCount(4);
    await expect(page.locator(".boot-error")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`${label}: the fridge card loads`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await mockNetwork(page, { townConfig: cfg });
    await page.goto("/fridge-card.html");
    await expect(page.locator("h1")).toHaveText(cfg.fridge_card.title);
    await expect(page.locator("#card-phones .phone-row")).toHaveCount(cfg.fridge_card.phones.length);
    expect(errors).toEqual([]);
  });
}
