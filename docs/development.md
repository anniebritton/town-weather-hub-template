# Development notes

## Architecture notes

- **Plain HTML/CSS/JS, no framework, no build step**, so future maintainers only need a text editor.
- The browser loads `town.json` at start-up; `app.js` fills the page text and builds all NWS, NOAA, Windy, and Climate Central URLs from it. Elements marked `data-town="path.in.config"` in `index.html` get their text from the config.
- All live data is fetched client-side from free public APIs (NWS, NOAA tides) except utility outage data, which the GitHub Action snapshots into the repo.
- Fetch failures degrade gracefully: every live section falls back to a labeled link to the official source. A broken `town.json` shows a visible error naming the problem instead of a blank page, and a bad regex in one `local_meaning` entry never hides a real alert.
- **Safety rules** live in [`town-utils.js`](../town-utils.js): remote data is rendered as text or checked numbers (never trusted markup), every link from `town.json` must be `https:`, and identifiers that go into URLs must match their documented shape. Third-party map iframes are sandboxed and send no referrer.
- **Embeds:** the map iframes are sandboxed with `allow-scripts allow-same-origin` (the embeds need both). Chrome logs a console warning for that combination; it is expected, and the sandbox still blocks navigation of your page and form posts. **Privacy note:** the fonts load from Google Fonts, so visitors' IP addresses reach Google. Delete the three `<link>` lines for fonts in `index.html` and `fridge-card.html` to use system fonts instead.
- An alert zone that NWS does not recognise shows a "Setup problem" card instead of a false green "All clear".
- The pest meters are **weather-based estimates, not surveillance**.

## Tests

None of the tests need internet access or API keys. Node and Playwright are used only for testing.

```sh
npm install
npx playwright install chromium
npm test            # unit + python + browser tests
npm run check-config  # report placeholder values left in town.json
npm run check-config:online  # ask NWS/NOAA whether your zone, grid, radar and stations are real
npm run test:unit   # Node only: text helpers, safety helpers, pest model, town.json validation, outage data contract
npm run test:py     # Python only: scripts/fetch_outages.py parsing (standard library, no installs)
npm run test:e2e    # Playwright against a local static server, with NWS/NOAA/outage data mocked
```

`npm test` runs all three suites even if one fails, then lists which failed.

The unit tests read `town.json`, so they keep passing after you adapt it, and the config test catches typos (bad regexes, malformed zone codes, non-https URLs, a key pasted where an env var name belongs). The config tests and a browser smoke test also cover every `examples/*/town.json`; the inland example is tested to show no coastal content at all. The tests include hostile inputs (script injection through NWS, NOAA and outage data, and `javascript:` links in `town.json`). `.github/workflows/tests.yml` runs everything on pull requests and pushes to `main`.
