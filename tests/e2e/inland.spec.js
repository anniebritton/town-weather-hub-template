// An inland town needs only config changes: no marine, tide, or coastal-climate content may appear.
const { test, expect } = require("@playwright/test");
const { mockNetwork } = require("./helpers");
const inland = require("../../examples/inland-desert/town.json");

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.pageErrors = [];
  page.on("pageerror", (e) => testInfo.pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") testInfo.pageErrors.push(m.text()); });
});
test.afterEach(async ({}, testInfo) => {
  // The mocked-out external hosts return 204; anything else logged as a console error is a real problem
  expect(testInfo.pageErrors.filter((e) => !/Failed to load resource/.test(e)), "console/page errors").toEqual([]);
});

const load = async (page, url = "/") => {
  const net = await mockNetwork(page, { townConfig: inland });
  await page.goto(url);
  await expect(page.locator("#tile-weather .tile-value")).not.toHaveClass(/skeleton/);
  return net;
};

test("no marine, tide, or coastal-climate UI is rendered", async ({ page }) => {
  await load(page);
  for (const sel of ["#tab-marine", "#marine", "#tile-seas", "#tides-strip", "#tide-chart", "#windy-map", "#climate-map", "#water-level", "#storm-tide"]) {
    await expect(page.locator(sel), sel).toHaveCount(0);
  }
  await expect(page.locator("#tab-climate")).toBeVisible(); // drought still lives there
  await page.locator("#tab-climate").click();
  await expect(page.locator(".topic-drought")).toBeVisible();
  await expect(page).toHaveTitle("Dryfork Weather Hub — Weather & Power");
});

test("no coastal wording anywhere on the page", async ({ page }) => {
  await load(page);
  const text = await page.locator("body").innerText();
  const html = await page.content();
  for (const word of [/\bboats?\b/i, /\bhurricane\b/i, /\btides?\b/i, /\bhaul\b/i, /\bseas\b/i, /Windy/i, /Climate Central/i, /\bshore/i]) {
    expect(text, String(word)).not.toMatch(word);
  }
  expect(html).not.toContain("tidesandcurrents");
});

test("no marine, tide, or coastal-map requests are made", async ({ page }) => {
  const { requests } = await load(page);
  await page.waitForTimeout(500);
  for (const bad of ["tidesandcurrents", "/products/types/CWF", "embed.windy.com", "climatecentral"]) {
    expect(requests.filter((u) => u.includes(bad)), bad).toEqual([]);
  }
});

test("the storm preview uses the configured event, with its local meaning and no tide line", async ({ page }) => {
  await load(page, "/?storm=demo");
  await expect(page.locator("#storm-banner")).toBeVisible();
  await expect(page.locator("#storm-headline")).toHaveText("Red Flag Warning is in effect for our area");
  await expect(page.locator("#tile-weather .tile-value")).toHaveText("Red Flag Warning");
  await expect(page.locator("#alerts-list details.alert-local")).toContainText("Fire can start and spread quickly");
  await expect(page.locator("#storm-banner")).not.toContainText(/boat|tide|haul/i);
});

test("an unverified phone number is shown as TODO and is never a tel: link", async ({ page }) => {
  await load(page);
  const call = page.locator(".btn-storm").first();
  await expect(call).toContainText("TODO: add number");
  await expect(call).not.toHaveAttribute("href", /./);
  await page.goto("/fridge-card.html");
  await expect(page.locator("#card-phones")).toContainText("TODO: add number");
  await expect(page.locator("a[href^='tel:']")).toHaveCount(0);
});

test("fire.embed=false removes the map frame and legend but keeps the open-full-screen link", async ({ page }) => {
  await load(page, "/#wildfire");
  await expect(page.locator("#fire-map")).toHaveCount(0);
  await expect(page.locator("#fire-legend")).toHaveCount(0);
  await expect(page.locator("#wildfire a[href^='https://']").first()).toBeVisible();
});

test("fridge card has no boat checklist line for an inland town", async ({ page }) => {
  await mockNetwork(page, { townConfig: inland });
  await page.goto("/fridge-card.html");
  await expect(page.locator("h1")).toHaveText(inland.fridge_card.title);
  await expect(page.locator("body")).not.toContainText(/boat/i);
});
