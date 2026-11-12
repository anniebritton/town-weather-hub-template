// Regression tests for the independent review: hidden elements, outage-data hardening,
// inland wording, phone dialing, embeds, canonical URL.
const { test, expect } = require("@playwright/test");
const { mockNetwork, town, freshOutages, OUTAGES_ON } = require("./helpers");
const inland = require("../../examples/inland-desert/town.json");

test("elements with the hidden attribute are not rendered, even when a class sets display (.btn)", async ({ page }) => {
  await mockNetwork(page, { townPatch: { outages: { report_url: "TODO", map_url: "http://insecure.example/map" } } });
  await page.goto("/#outages");
  await expect(page.locator("#tile-power .tile-value")).not.toHaveClass(/skeleton/);
  for (const key of ["outages.report_url", "outages.map_url"]) {
    const links = page.locator(`a[data-town-href="${key}"]`);
    expect(await links.count()).toBeGreaterThan(0);
    for (const link of await links.all()) {
      await expect(link, key).toBeHidden();
      expect(await link.evaluate((n) => getComputedStyle(n).display)).toBe("none");
    }
  }
});

test.describe("outage data that would mislead", () => {
  const expectUnavailable = async (page, data, why) => {
    await mockNetwork(page, { townPatch: OUTAGES_ON, outages: data });
    await page.goto("/#outages");
    await expect(page.locator("#tile-power .tile-value"), why).toHaveText("Unavailable");
    await expect(page.locator("#outage-stats"), why).not.toContainText(/No outages in|None/);
  };
  const soon = (min) => new Date(Date.now() + min * 60000).toISOString();

  for (const [why, data] of Object.entries({
    "fetchedAt in the future": freshOutages({ fetchedAt: soon(120) }),
    "lastUpdated far in the future": freshOutages({ lastUpdated: "2999-01-01 00:00:00" }),
    "negative total": freshOutages({ totals: { customers: 1, outages: -5, incidents: 0 } }),
    "fractional total": freshOutages({ totals: { customers: 1, outages: 2.5, incidents: 0 } }),
    "absurd total (1e308)": freshOutages({ totals: { customers: 1, outages: 1e308, incidents: 0 } }),
    "negative town count": freshOutages({ town: { level: "town", town: "X", Outages: -1 } }),
    "fractional county count": freshOutages({ county: { county: "X", Outages: 0.5 } }),
  })) {
    test(`${why} shows Unavailable`, async ({ page }) => expectUnavailable(page, data, why));
  }

  test("a clock a few minutes ahead is tolerated", async ({ page }) => {
    await mockNetwork(page, { townPatch: OUTAGES_ON, outages: freshOutages({ fetchedAt: soon(2) }) });
    await page.goto("/#outages");
    await expect(page.locator("#tile-power .tile-value")).toHaveText("5 out");
  });

  test("other towns are listed but ours isn't, and the spelling is unverified: 'No data', not 'None'", async ({ page }) => {
    const data = freshOutages({ town: null, county: null, towns: [{ level: "town", town: "SOMEWHERE ELSE", Outages: 3 }] });
    await mockNetwork(page, { townPatch: OUTAGES_ON, outages: data });
    await page.goto("/#outages");
    await expect(page.locator("#tile-power .tile-value")).toHaveText("No data");
    await expect(page.locator("#outage-stats")).toContainText(`No data for ${town.outages.match_town}`);
    await expect(page.locator("#outage-stats")).toContainText("check match_town");
    await expect(page.locator("#tile-power")).not.toHaveClass(/is-ok/);
  });

  test("once match_verified is set, a missing row really means no outages", async ({ page }) => {
    const data = freshOutages({ town: null, county: null, matchVerified: true, towns: [{ level: "town", town: "SOMEWHERE ELSE", Outages: 3 }] });
    await mockNetwork(page, { townPatch: OUTAGES_ON, outages: data });
    await page.goto("/#outages");
    await expect(page.locator("#tile-power .tile-value")).toHaveText("On");
    await expect(page.locator("#outage-stats")).toContainText(`No outages in ${town.site.place}`);
  });
});

const COASTAL_WORDS = [/\btides?\b/i, /\bboats?\b/i, /\bhurricanes?\b/i, /\bsurf\b/i, /\bmarine\b/i, /\bseas\b/i];

test("inland: no tide, boat, hurricane, surf, marine or seas wording anywhere in the hub or the fridge card", async ({ page }) => {
  await mockNetwork(page, { townConfig: inland });
  for (const url of ["/", "/?storm=demo", "/fridge-card.html"]) {
    await page.goto(url);
    await expect(page.locator("h1")).toBeVisible();
    await page.waitForTimeout(300);
    // textContent includes tab panels that are not currently shown
    const text = await page.evaluate(() => [...document.querySelectorAll("body")].map((b) => {
      const clone = b.cloneNode(true);
      clone.querySelectorAll("script,style").forEach((n) => n.remove());
      return clone.textContent;
    }).join(" "));
    for (const word of COASTAL_WORDS) expect(text, `${url} contains ${word}`).not.toMatch(word);
  }
});

test("the pest text claims no region, and the inland example turns pests off", async ({ page }) => {
  await mockNetwork(page);
  await page.goto("/");
  const text = await page.evaluate(() => document.getElementById("pests").textContent);
  for (const word of [/northern/i, /temperate/i, /deer tick/i, /Lyme transmission/i, /nymph/i]) expect(text).not.toMatch(word);
  expect(inland.features.pests).toBe(false);
});

test.describe("phone numbers are only dialable when they are one plain number", () => {
  const callButton = async (page, phone_dial, phone_display = phone_dial) => {
    await mockNetwork(page, { townPatch: { outages: { phone_dial, phone_display } } });
    await page.goto("/");
    await expect(page.locator("#tile-power .tile-value")).not.toHaveClass(/skeleton/);
    return page.locator(".btn-storm").first();
  };

  for (const bad of ["911 or 555-0100", "(555) 123-0100 ext. 12", "555-0100", "18005550100 / 18005550101", "TODO", "TODO: ask the co-op"]) {
    test(`'${bad}' is shown but never dialed`, async ({ page }) => {
      const call = await callButton(page, bad);
      await expect(call).not.toHaveAttribute("href", /./);
      expect(await page.locator("a[href^='tel:']").count()).toBe(0);
    });
  }
  for (const [shown, tel] of [["1-800-696-1000", "tel:18006961000"], ["(207) 555-0123", "tel:2075550123"]]) {
    test(`'${shown}' dials ${tel}`, async ({ page }) => {
      const call = await callButton(page, shown);
      await expect(call).toHaveAttribute("href", tel);
    });
  }

  test("a fridge-card phone entry with no number shows a TODO marker", async ({ page }) => {
    await mockNetwork(page, { townPatch: { fridge_card: { phones: [
      { label: "Life-threatening emergency", number: "911", urgent: true },
      { label: "Nobody filled this in" },
      { label: "Blank", number: "  " },
    ] } } });
    await page.goto("/fridge-card.html");
    await expect(page.locator("#card-phones .phone-row")).toHaveCount(3);
    await expect(page.locator("#card-phones .todo")).toHaveCount(2);
    await expect(page.locator("#card-phones")).toContainText("TODO: add number");
  });
});

test("iframes let embed popups open normally, and are still sandboxed", async ({ page }) => {
  await mockNetwork(page);
  await page.goto("/");
  for (const id of ["windy-map", "climate-map", "fire-map"]) {
    const sandbox = await page.locator(`#${id}`).getAttribute("sandbox");
    for (const token of ["allow-scripts", "allow-popups", "allow-popups-to-escape-sandbox"]) expect(sandbox, id).toContain(token);
    expect(sandbox).not.toContain("allow-top-navigation");
  }
  // the embeds get their URLs (their pages are blocked in tests, but the frames must be pointed at them)
  await expect(page.locator("#windy-map")).toHaveAttribute("src", /^https:\/\/embed\.windy\.com\//);
  await expect(page.locator("#climate-map")).toHaveAttribute("src", /^https:\/\/coastal\.climatecentral\.org\//);
});

test("site.public_url becomes the canonical URL when it is a safe https URL", async ({ page }) => {
  await mockNetwork(page, { townPatch: { site: { public_url: "https://weather.example.org/hub/" } } });
  await page.goto("/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://weather.example.org/hub/");
  const p2 = await page.context().newPage();
  await mockNetwork(p2, { townPatch: { site: { public_url: "javascript:alert(1)" } } });
  await p2.goto("/");
  await expect(p2.locator("#tile-weather .tile-value")).not.toHaveClass(/skeleton/);
  await expect(p2.locator('link[rel="canonical"]')).toHaveCount(0);
});
