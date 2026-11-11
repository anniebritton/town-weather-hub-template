# Changelog

All notable changes to this template. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `examples/southport/`: a complete, real `town.json` for Southport Island, Maine, as a worked example.
- GitHub Pages workflow that deploys the site with the Southport example as a live demo.
- `scripts/check-config.js` (`npm run check-config`): lists `town.json` values that are still placeholders.
- Screenshots and a social preview image in `docs/`.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue templates, a pull request template, and Dependabot updates.
- Config tests now also validate every `examples/*/town.json`.

### Changed
- README rewritten for people finding the template for the first time.

## [0.1.0]

### Added
- Initial template: static site configured entirely by `town.json`, with NWS alerts and forecasts, NOAA tides and marine forecast, optional outage data via a scheduled GitHub Action, fire danger, pest estimates, climate risk resources, Storm Mode, and a printable fridge card.
- Unit, Python, and Playwright tests with all network access mocked.
