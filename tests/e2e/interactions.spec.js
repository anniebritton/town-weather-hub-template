// Navigation, storm mode preview, and controls (network mocked; no internet needed).
const { test, expect } = require("@playwright/test");
const { mockNetwork, town } = require("./helpers");

test.beforeEach(async ({ page }) => {
  await mockNetwork(page);
});

const PANELS = ["alerts", "outages", "marine", "wildfire", "pests", "climate"];

async function expectOnlyPanel(page, id) {
  for (const p of PANELS) {
    if (p === id) await expect(page.locator(`#${p}`)).toBeVisible();
    else await expect(page.locator(`#${p}`)).toBeHidden();
  }
  await expect(page.locator(`#tab-${id}`)).toHaveAttribute("aria-selected", "true");
}

test.describe("section tabs", () => {
  test("Alerts & Forecast is open by default", async ({ page }) => {
    await page.goto("/");
    await expectOnlyPanel(page, "alerts");
  });

  test("clicking a tab opens its panel and updates the URL", async ({ page }) => {
    await page.goto("/");
    await page.locator("#tab-outages").click();
    await expectOnlyPanel(page, "outages");
    await expect(page).toHaveURL(/#outages$/);
  });

  test("arrow keys, Home, and End move between tabs and wrap", async ({ page }) => {
    await page.goto("/");
    await page.locator("#tab-alerts").focus();
    await page.keyboard.press("ArrowRight");
    await expectOnlyPanel(page, "outages");
    await expect(page.locator("#tab-outages")).toBeFocused();
    await page.keyboard.press("Home");
    await expectOnlyPanel(page, "alerts");
    await page.keyboard.press("ArrowLeft");
    await expectOnlyPanel(page, "climate");
    await page.keyboard.press("ArrowRight");
    await expectOnlyPanel(page, "alerts");
    await page.keyboard.press("End");
    await expectOnlyPanel(page, "climate");
    await expect(page.locator("#tab-climate")).toBeFocused();
  });

  test("only the selected tab is in the tab order", async ({ page }) => {
    await page.goto("/#pests");
    for (const p of PANELS) {
      await expect(page.locator(`#tab-${p}`)).toHaveAttribute("tabindex", p === "pests" ? "0" : "-1");
    }
  });

  test("deep links open the matching tab", async ({ page }) => {
    await page.goto("/#marine");
    await expectOnlyPanel(page, "marine");
  });

  test("changing the hash after load switches tabs", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { location.hash = "#wildfire"; });
    await expectOnlyPanel(page, "wildfire");
  });
});

test.describe("storm mode", () => {
  test("is off when there is no storm alert", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#tile-weather .tile-value")).not.toHaveClass(/skeleton/);
    await expect(page.locator("#storm-banner")).toBeHidden();
  });

  test("?storm=demo previews the full storm layout with live tide timing", async ({ page }) => {
    await page.goto("/?storm=demo");
    await expect(page.locator("body")).toHaveClass(/storm-mode/);
    await expect(page.locator("#storm-banner")).toBeVisible();
    await expect(page.locator("#storm-headline")).toHaveText(/is in effect for our area$/);
    await expect(page.locator("#storm-tide")).toHaveText(/^Next high tide: .+ \(-?\d+\.\d ft\) — flooding risk is greatest around this time\.$/);

    const demo = page.locator("#alerts-list .alert-card").first();
    await expect(demo).toContainText("DEMO");
    await expect(demo).toHaveClass(/severity-severe/);
    await expect(demo.locator("details.alert-local summary")).toHaveText(`What this means for ${town.site.place}`);

    await expect(page.locator("#tile-weather")).toHaveClass(/is-bad/);
    await expect(page.locator("#tile-weather .tile-value")).toHaveText(town.alerts.demo_event);
  });
});

test.describe("climate water-level slider", () => {
  async function setLevel(page, value) {
    await page.locator("#water-level").evaluate((input, v) => {
      input.value = v;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, String(value));
  }

  test("updates the label and reloads the map at the chosen level", async ({ page }) => {
    await page.goto("/#climate");
    await setLevel(page, 6);
    await expect(page.locator("#water-level-value")).toHaveText("6 feet");
    expect(new URL(await page.locator("#climate-map").getAttribute("src")).searchParams.get("water_level")).toBe("6.0");
  });

  test("uses the singular for one foot", async ({ page }) => {
    await page.goto("/#climate");
    await setLevel(page, 1);
    await expect(page.locator("#water-level-value")).toHaveText("1 foot");
  });
});

test("fridge card page loads", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  const res = await page.goto("/fridge-card.html");
  expect(res.ok()).toBeTruthy();
  await expect(page.locator("h1")).toHaveText(town.fridge_card.title);
  await expect(page.locator(".phone-row.urgent strong")).toHaveText("911");
  await expect(page.locator("#card-write-ins .phone-row")).toHaveCount(town.fridge_card.write_ins.length);
  expect(errors).toEqual([]);
});
