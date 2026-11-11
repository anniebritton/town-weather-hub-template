// @ts-check
const { defineConfig, devices } = require("@playwright/test");

const PORT = 4173;
const town = require("./town.json");

module.exports = defineConfig({
  testDir: "tests/e2e",
  // All specs mock the network (see tests/e2e/helpers.js), so no keys or internet are needed.
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "en-US",
    timezoneId: town.location.timezone,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Serve the repo exactly as GitHub Pages does: static files, no build.
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
