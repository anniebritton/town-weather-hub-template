# Contributing

Thanks for helping make this useful for more small communities. Bug reports, data-source notes for your region, and pull requests are all welcome. Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first.

AI coding agents: see [`AGENTS.md`](AGENTS.md).

## Run the tests

You need Node 20+ and Python 3. Nothing needs internet access or API keys; all network calls are mocked.

```sh
npm install
npx playwright install chromium
npm test              # unit + python + browser tests
npm run test:unit     # Node only
npm run test:py       # Python only (standard library)
npm run test:e2e      # Playwright
npm run check-config  # list placeholders, TODOs and non-https URLs left in town.json
npm run check-config:online  # ask NWS/NOAA whether the identifiers are real (needs internet)
```

To preview locally: `python3 -m http.server 8000` and open http://localhost:8000. To preview the Southport example, copy `examples/southport/town.json` over `town.json` (and do not commit that).

## Ground rules

- Everything town-specific belongs in `town.json`, not in `app.js` or `index.html`. If you need a new setting, add it to `town.json`, both worked examples under `examples/`, the config reference in `docs/config-reference.md`, and `tests/unit/town-config.test.js`.
- Anything coastal-only gets a `data-feature="marine"` (or `tides`, `climate_coastal`) attribute so inland towns can switch it off in `town.json`.
- Safety: remote data (NWS, NOAA, outage JSON) must reach the page as text or through `escapeHtml()`/`num()` from `town-utils.js`, URLs from config through `safeUrl()`, identifiers through `ident()`. Add a hostile-input test in `tests/e2e/security.spec.js` for any new sink.
- Never show reassurance you can't back up: missing, malformed or stale data is "Unavailable", not "None" or "All clear".
- Values a maintainer can't verify are the text `TODO`, never a made-up number.
- No build step, no framework, no runtime dependencies. A volunteer with a text editor should be able to maintain a fork.
- Keep language plain and type large; the audience skews older and non-technical.
- Never commit API keys, tokens, or personal contact details. `town.json` is public.

## Add an outage provider

Outage data is fetched server-side by `.github/workflows/outages.yml` because most utilities block cross-origin browser requests.

1. Add your provider name to the allowed values in `tests/unit/town-config.test.js` (`outages.provider`).
2. In `scripts/fetch_outages.py`, add a branch in `main()` for your provider that fetches the data and returns the same JSON shape the page reads (see `build_result()`: `status`, `fetchedAt`, `lastUpdated`, `totals`, `town`, `county`, `towns`). Add a response-shape check next to `validate_response()` so junk is rejected and the last good file is kept.
3. Keep parsing in a pure function and add a test with a recorded sample response in `tests/python/test_fetch_outages.py`, including junk and empty responses. Do not commit real keys. A unit test checks that what the script writes is accepted by the page (`checkOutageData()`).
4. Document the provider and any config keys in `docs/outages.md` and `docs/config-reference.md`.

## Add a local resource section

Resource lists (`resources.flood`, `.drought`, `.pests`) are arrays of `{title, url, description}` rendered by `app.js`. To add a new list, for example `resources.wildfire`:

1. Add the array to `town.json` and `examples/southport/town.json`.
2. Render it in `index.html` and `app.js` the same way the existing lists are.
3. Add it to the config reference in `docs/config-reference.md` and, if needed, to the resource checks in `tests/unit/town-config.test.js`.
4. Add a Playwright check in `tests/e2e/` that the section appears.

## Good first issues

- Add an outage provider for a Kubra Storm Center utility.
- Make the pest season calendars (`mosquitoSeason`, `tickSeason`) configurable from `town.json` for warmer climates.
- Add another worked example under `examples/` (for example a mountain or Great Plains town).
- Warn in `scripts/check-config.js` when `location.timezone` and `nws.office` look inconsistent.
- Add a Spanish-language `fridge-card` option.

## Pull requests

Branch from `main`, keep changes focused, run `npm test`, and fill in the PR template. Add a line to `CHANGELOG.md` under Unreleased.
