# AGENTS.md

Instructions for AI coding agents. Two jobs: **(A) set this template up for a user's town**, and **(B) work on the template itself**. Check which one the user wants.

## What this is

A static weather, power-outage, marine, fire, drought and pest dashboard for a small town. No build step, no framework, no runtime dependencies. **Every town-specific value lives in `town.json`.** Code must never hardcode a place. Full detail: `README.md` ("Adapt it to your town" and the config reference). Worked examples: `examples/southport/town.json` (real coastal town, finished) and `examples/inland-desert/town.json` (fictional inland town, coastal features off).

## A. Set it up for the user's town

Do these in order. Ask the user only for what you can't look up.

1. **Ask** for: the town and state, and whether it is coastal (marine/tides) or inland. Optional: their power utility, and the county/state agencies for the resource links.
2. **Create the user's repo** from the template (they can click "Use this template", or `gh repo create <name> --template anniebritton/town-weather-hub-template --public --clone`; ask whether it should be public or private). Work in their repo, not the template's. `.github/workflows/pages.yml` is safe to leave as is: it deploys the user's own `town.json` everywhere except the upstream template repo, so another town's data cannot be published by mistake.
3. **Look up the NWS identifiers** (free, no key). Geocode the town to `lat,lon` with OpenStreetMap Nominatim: `https://nominatim.openstreetmap.org/search?q=<town>,+<state>&format=json&limit=1` with a descriptive `User-Agent` header (the Census geocoder often returns nothing for small places). Then fetch `https://api.weather.gov/points/{lat},{lon}` (also with a `User-Agent`). Copy `properties.gridId`, `gridX`, `gridY`, `forecastZone` (last path segment), and `radarStation` into the `nws` block. Coordinates and IANA timezone go in `location`. If two towns share a name, confirm the county with the user.
4. **Coastal or inland, config only.** Coastal: find the marine zone (NWS coastal waters) and the nearest NOAA tide station (tidesandcurrents.noaa.gov). **Inland: set `features.marine`, `features.tides` and `features.climate_coastal` to `false`**, delete `nws.marine_zone`, `nws.marine_description`, the `tides` block and the `seas_*` thresholds, change `alerts.demo_event` to an alert the area really gets (for example `Red Flag Warning`), and remove coastal entries from `local_meaning`. No HTML editing is needed; copy the shape of `examples/inland-desert/town.json`. If a region's seasons don't suit the pest meters, set `features.pests` to `false`.
5. **Fill in `site`** (name, place, tagline, description) and the **local content**: `local_meaning` (what each alert type means in this town), `fridge_card` phone numbers and write-ins, and `resources.*` links. Fetch every URL and check it returns 200 (every URL must be `https://`). **Never invent phone numbers, agencies, shelters or road names.** Anything you cannot verify gets the literal text **`TODO`** (or `TODO: why`): the page shows it as a visible "TODO: add number" and never as a dialable link, and a TODO URL is simply not shown. Tell the user the list of TODOs at the end.
6. **Outages:** leave `outages.provider` as `"none"` (link-out buttons only; the Power tile will say "Unavailable", which is honest) unless the utility is Avangrid-style (see README step 3). `outages.phone_display`/`phone_dial` should be real or `TODO`. Never ask the user to paste an API key into the chat. If a key is needed, tell them to add it as the repo secret `OUTAGE_API_KEY` themselves (`gh secret set OUTAGE_API_KEY`, entered at their own prompt), then uncomment the `schedule` in `.github/workflows/outages.yml`. The bundled `data/outages.json` is a sample marked `"sample": true`; the page ignores it, so you don't need to delete it.
7. **Check your work:**
   - `npm run check-config` lists everything still unfinished: placeholders (`XXX`, `example.com`, ...), `TODO`s, non-https URLs, and coastal wording in an inland config. The goal is zero, or an explicit list for the user of what only they can supply.
   - `npm run check-config:online` asks NWS/NOAA whether the zone, grid, radar, marine zone and tide station exist and agree with the coordinates. **Run it; a mistyped zone otherwise looks like a calm "all clear".**
   - `npm install && npx playwright install chromium && npm test` (unit, python and browser tests; none need keys). The tests pass with a finished or an unfinished `town.json`; they do not require placeholders to remain.
8. **Hand edits (not in `town.json`).** Review these and tell the user what you changed: the generic checklists in `fridge-card.html` and the storm banner in `index.html` (boat/tide lines hide automatically when marine is off; the rest is general advice); `site.tagline` and `site.description` wording; regenerate `assets/site-qr.svg` for their real URL (README step 6) and set `site.public_url`; the README (still describes the template and shows Southport screenshots in `docs/`: replace or trim); `docs/` images; `LICENSE` copyright if they want their own name; the seasonal calendars in `pests.js` if the climate is not northern temperate.
9. **Publish:** in their repo, Settings > Pages > Source = "GitHub Actions". That's a user-only setting; tell them. Preview locally with `python3 -m http.server 8000`.
10. **Report** what you filled in and where each value came from, the TODO list, and the things only the user can confirm (phone numbers, shelter location, burn rules, etc.).

Safety note for the user's community: this site shows alerts and outage info but is not an official source. Keep the README disclaimer and don't remove the links to NWS and the utility.

## B. Work on the template

```sh
npm install && npx playwright install chromium
npm test                       # unit + python + browser; runs all three even if one fails; no keys needed
npm run check-config           # what is unfinished in town.json
npm run check-config:online    # confirm NWS/NOAA identifiers (needs internet)
```

- New setting? Add it to `town.json`, `examples/southport/town.json` **and** `examples/inland-desert/town.json` (or make it an optional key in the test's `OPTIONAL` list), the README config reference, and `tests/unit/town-config.test.js`. The test fails if an example drifts from the template's keys.
- No town-specific text in `app.js`, `index.html`, `fridge-card.html`, or scripts. A leak here defeats the purpose of the template. Coastal-only markup gets `data-feature="marine"` (or `tides`, `climate_coastal`, `pests`) so it disappears when the feature is off.
- **Safety rules for anything that renders data:** remote data (NWS, NOAA, outage JSON) goes into the DOM as text, or through `escapeHtml()` / `num()` from `town-utils.js`; never interpolate it raw into `innerHTML`. URLs from `town.json` go through `safeUrl()` (https only) and identifiers that end up in URLs through `ident()`. Add a hostile-input Playwright test when you add a new sink (see `tests/e2e/security.spec.js`).
- Never show reassuring defaults. If data is missing, malformed, or stale, show "Unavailable" (see `checkOutageData()`), not "None" or "All clear".
- No build step, frameworks, or runtime dependencies. Keep language plain and type large (minimum 0.8rem); the audience skews older and non-technical.
- `town.json` and everything in the repo are public. Never commit keys, tokens, or personal contact details. Secrets are referenced by env var **name** only.
- Outage providers: `scripts/fetch_outages.py` (validation, pure parsing function, recorded samples in `tests/python/`). See `CONTRIBUTING.md`.
- Add a line to `CHANGELOG.md` under Unreleased; PRs use the template in `.github/`.
