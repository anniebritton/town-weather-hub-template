# Changelog

All notable changes to this template. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `AGENTS.md`: instructions for AI coding agents to set the template up for a town or to contribute to it.
- `examples/southport/`: a complete, real `town.json` for Southport Island, Maine, as a worked example.
- GitHub Pages workflow that deploys the site with the Southport example as a live demo.
- `scripts/check-config.js` (`npm run check-config`): lists `town.json` values that are still placeholders.
- Screenshots and a social preview image in `docs/`.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue templates, a pull request template, and Dependabot updates.
- Config tests now also validate every `examples/*/town.json`.

- `features` switches in `town.json` (`marine`, `tides`, `climate_coastal`, `pests`): an inland town needs config changes only, and `examples/inland-desert/` shows it.
- `TODO` convention for values you cannot verify: shown as a visible "TODO: add number", never a dialable link.
- `scripts/check-config.js --online` (`npm run check-config:online`) verifies the NWS zone, grid, radar, marine zone and NOAA tide station.
- `town-utils.js`: shared safety helpers (`safeUrl`, `telHref`, `ident`, `num`, `escapeHtml`, feature switches) used by both pages.
- `scripts/run-tests.js`: `npm test` now runs all suites even if one fails.
- Default local meanings for Red Flag Warning, Dust Storm and Extreme Heat.
- `fire.embed` option, `outages.stale_after_minutes`, and a `Setup problem` card when NWS does not recognise the alert zone.
- Hostile-input, robustness, outage-honesty, inland and every-example browser tests; python tests for junk API responses.

### Changed
- README rewritten for people finding the template for the first time.
- Outage pipeline: `fetch_outages.py` rejects malformed API responses and keeps the last good file, records `fetchedAt`, rewrites only on change or every ~45 minutes, and warns when the town matches nothing. `outages.yml` has a concurrency group, rebases before pushing, exits early when disabled, fails loudly, and starts the Pages deploy (the schedule is commented out by default). `pages.yml` now publishes `data/`.
- The Southport overlay in `pages.yml` runs only in the upstream template repository, so a user's copy always deploys its own `town.json`.
- The Power section shows "Unavailable" (never "On"/"None") when the provider is `none`, the data is missing or malformed, a sample, or older than `stale_after_minutes`. The bundled `data/outages.json` is marked `"sample": true`.
- The page shows a visible error when `town.json` is missing, invalid or lacks a required block, and keeps working when optional blocks (resources, fire, alerts, ...) are absent.
- Cards that are tinted for rough weather now also say so in words; minimum font size is 0.8rem; the radar image has a descriptive alt text.
- Actions updated to current majors; Dependabot no longer watches pip (there is no manifest).
- The template's default drought map now uses `current_conus_trd.png` (the previous `current_us_trd.png` returns 404).

### Fixed (review round 3)
- A frozen utility feed behind a fresh fetch no longer reads as "No outages": the utility's own `lastUpdated` must be younger than `outages.max_source_age_minutes` (default 360), on the page and in `fetch_outages.py` (which rejects it and keeps the last good file).
- The utility's `lastUpdated` (local time, no zone) is now read in `location.timezone` (Intl in the page, zoneinfo in the script) instead of as UTC, so the future-date and age checks are correct. A missing or invalid zone, or an unreadable format, means unverifiable: shown as unavailable.
- The page only reads `outages.data_file` when it is a file inside `data/`, and `check-config` flags anything else.
- When the town has no row and the town list is empty but the utility reports outages overall, the page shows "No data (check match_town)" (and the script fails) instead of "None"/"On".

### Fixed (review round 2)
- A hidden element (`hidden` attribute) was still shown when a class like `.btn` set `display`, leaving dead TODO/bad-URL buttons visible; `[hidden]` now always wins.
- Outage data is rejected if `fetchedAt` or `lastUpdated` is in the future (> 5 minutes), or if a count is negative, fractional or absurd (1e308). `fetch_outages.py` applies the same checks.
- An unmatched `match_town` (utility lists other towns, none is ours) now shows "No data for <town> (check match_town)" and makes the fetch fail loudly, until `outages.match_verified` is set to `true`. `outages.data_file` must be inside `data/`.
- Tests are fixture-based: adapting the root `town.json` (inland, no marine) no longer breaks `npm test`.
- Southport example: the CMP outage line is now 1-800-696-1000, the number CMP's FAQ publishes for its 24/7 outage system (the previous number could not be verified).
- Fridge card and pest text no longer claim tides or a northern climate; the inland example has pests off; `telHref` dials only a single plain phone number; feature flags written as "false"/0 count as off; `check-config` flags more placeholder shapes, missing bindings, missing phone numbers, non-boolean flags and a QR code that doesn't match `site.public_url`; `site.public_url` is the canonical URL.
- Embed iframes also allow popups to escape the sandbox; the Pages "unfinished config" warning no longer creates empty annotations.
- README and social-preview screenshots are labeled as illustrative and match what the live demo shows (Power unavailable).

### Fixed (security)
- Remote NWS, NOAA and outage data can no longer inject markup or script into the page (temperature and outage counts were rendered unescaped).
- `javascript:`, `data:` and `http:` URLs in `town.json` are never used for links, images or iframes; third-party iframes are sandboxed and send no referrer; identifiers that end up in URLs must match their documented shape.
- A bad regex in `local_meaning` or `alerts.storm_event_pattern` no longer hides real alerts.

## [0.1.0]

### Added
- Initial template: static site configured entirely by `town.json`, with NWS alerts and forecasts, NOAA tides and marine forecast, optional outage data via a scheduled GitHub Action, fire danger, pest estimates, climate risk resources, Storm Mode, and a printable fridge card.
- Unit, Python, and Playwright tests with all network access mocked.
