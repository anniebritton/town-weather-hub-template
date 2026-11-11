# Contributing

Thanks for helping make this useful for more small communities. Bug reports, data-source notes for your region, and pull requests are all welcome. Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## Run the tests

You need Node 20+ and Python 3. Nothing needs internet access or API keys; all network calls are mocked.

```sh
npm install
npx playwright install chromium
npm test              # unit + python + browser tests
npm run test:unit     # Node only
npm run test:py       # Python only (standard library)
npm run test:e2e      # Playwright
npm run check-config  # list placeholders left in town.json
```

To preview locally: `python3 -m http.server 8000` and open http://localhost:8000. To preview the Southport example, copy `examples/southport/town.json` over `town.json` (and do not commit that).

## Ground rules

- Everything town-specific belongs in `town.json`, not in `app.js` or `index.html`. If you need a new setting, add it to `town.json` and `examples/southport/town.json`, the config reference in the README, and `tests/unit/town-config.test.js`.
- No build step, no framework, no runtime dependencies. A volunteer with a text editor should be able to maintain a fork.
- Keep language plain and type large; the audience skews older and non-technical.
- Never commit API keys, tokens, or personal contact details. `town.json` is public.

## Add an outage provider

Outage data is fetched server-side by `.github/workflows/outages.yml` because most utilities block cross-origin browser requests.

1. Add your provider name to the allowed values in `tests/unit/town-config.test.js` (`outages.provider`).
2. In `scripts/fetch_outages.py`, add a branch in `main()` for your provider that fetches the data and returns the same JSON shape the page reads (see `build_result()` and `data/outages.json`: `lastUpdated`, `totals`, `town`, `county`, `towns`).
3. Keep parsing in a pure function and add a test with a recorded sample response in `tests/python/test_fetch_outages.py`. Do not commit real keys.
4. Document the provider and any config keys in the README ("Point the outage data at your utility" and the config reference).

## Add a local resource section

Resource lists (`resources.flood`, `.drought`, `.pests`) are arrays of `{title, url, description}` rendered by `app.js`. To add a new list, for example `resources.wildfire`:

1. Add the array to `town.json` and `examples/southport/town.json`.
2. Render it in `index.html` and `app.js` the same way the existing lists are.
3. Add it to the config reference in the README and, if needed, to the resource checks in `tests/unit/town-config.test.js`.
4. Add a Playwright check in `tests/e2e/` that the section appears.

## Good first issues

- Add an outage provider for a Kubra Storm Center utility.
- Make the pest season calendars (`mosquitoSeason`, `tickSeason`) configurable from `town.json` for warmer climates.
- Make the marine tab optional with a single `town.json` flag, so inland towns do not have to delete HTML.
- Add a second worked example under `examples/` for an inland or Western town (wildfire and drought focus).
- Warn in `scripts/check-config.js` when `location.timezone` and `nws.office` look inconsistent.
- Add a Spanish-language `fridge-card` option.

## Pull requests

Branch from `main`, keep changes focused, run `npm test`, and fill in the PR template. Add a line to `CHANGELOG.md` under Unreleased.
