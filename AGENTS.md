# AGENTS.md

Instructions for AI coding agents. Two jobs: **(A) set this template up for a user's town**, and **(B) work on the template itself**. Check which one the user wants.

## What this is

A static weather, power-outage, marine, fire, drought and pest dashboard for a small town. No build step, no framework, no runtime dependencies. **Every town-specific value lives in `town.json`.** Code must never hardcode a place. Full detail: `README.md` ("Adapt it to your town" and the config reference). A finished real-world config is in `examples/southport/town.json`.

## A. Set it up for the user's town

Do these in order. Ask the user only for what you can't look up.

1. **Ask** for: the town and state, and whether it is coastal (marine/tides) or inland. Optional: their power utility, and the county/state agencies for the resource links.
2. **Create the user's repo** from the template (they can click "Use this template", or `gh repo create <name> --template anniebritton/town-weather-hub-template --public --clone`). Work in their repo, not the template's.
3. **Look up the NWS identifiers** (free, no key). Geocode the town to `lat,lon`, then fetch `https://api.weather.gov/points/{lat},{lon}`. Copy `properties.gridId`, `gridX`, `gridY`, `forecastZone` (last path segment), and `radarStation` into the `nws` block. Coordinates and IANA timezone go in `location`. Send a descriptive `User-Agent` header with NWS requests.
4. **Coastal only:** find the marine zone (NWS coastal waters) and the nearest NOAA tide station (tidesandcurrents.noaa.gov). **Inland:** remove the Seas/Tides tab from `index.html` and set the related config to match; run the tests to see what the page expects.
5. **Fill in `site`** (name, place, tagline, description) and the **local content**: `local_meaning` (what each alert type means in this town), `fridge_card` phone numbers and write-ins, and `resources.*` links. Use real, verified URLs; fetch each one and check it returns 200. **Do not invent phone numbers, agencies, or road names.** If you can't verify something, leave an obvious `TODO` and tell the user.
6. **Outages:** set `outages.provider` to `"none"` (link-out buttons only) unless the utility is Avangrid-style (see README step 3). Never ask the user to paste an API key into the chat. If a key is needed, tell them to add it as the repo secret `OUTAGE_API_KEY` themselves (`gh secret set OUTAGE_API_KEY`, entered at their own prompt).
7. **Check your work:** `npm run check-config` lists values still left as placeholders (`XXX`, `example.com`, ...). The goal is zero, or an explicit list for the user of what only they can supply. Then `npm install && npx playwright install chromium && npm test`.
8. **Remove demo-only pieces:** delete the `examples/southport` overlay step from `.github/workflows/pages.yml` (it makes the live demo show Southport) so the user's site shows their own `town.json`. Regenerate `assets/site-qr.svg` for their URL (README step 6).
9. **Publish:** in their repo, Settings > Pages > Source = "GitHub Actions". That's a user-only setting; tell them. Preview locally with `python3 -m http.server 8000`.
10. **Report** what you filled in and where each value came from, plus the short list of things only the user can confirm (phone numbers, shelter location, etc.).

Safety note for the user's community: this site shows alerts and outage info but is not an official source. Keep the README disclaimer and don't remove the links to NWS and the utility.

## B. Work on the template

```sh
npm install && npx playwright install chromium
npm test              # unit + python + browser; all network is mocked, no keys needed
npm run check-config  # placeholders left in town.json
```

- New setting? Add it to `town.json` **and** `examples/southport/town.json`, the README config reference, and `tests/unit/town-config.test.js`. The test fails if the example drifts from the template's keys.
- No town-specific text in `app.js`, `index.html`, `fridge-card.html`, or scripts. A leak here defeats the purpose of the template.
- No build step, frameworks, or runtime dependencies. Keep language plain and type large; the audience skews older and non-technical.
- `town.json` and everything in the repo are public. Never commit keys, tokens, or personal contact details. Secrets are referenced by env var **name** only.
- Outage providers: `scripts/fetch_outages.py` (pure parsing function plus a recorded sample in `tests/python/`). See `CONTRIBUTING.md`.
- Add a line to `CHANGELOG.md` under Unreleased; PRs use the template in `.github/`.
