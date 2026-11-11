# Town Weather Hub (template)

A one-page weather, power, and coast dashboard for a small town, built to be forked and adapted in an afternoon. Residents get everything that matters before, during, and after severe weather without knowing which agency's website to visit:

- Live **weather alerts and forecast** from the National Weather Service, with plain-language "what this means for your town" translations
- **Power outage numbers** from your utility's public data, refreshed every 15 minutes by a GitHub Action (optional)
- **Marine conditions**: wind, seas, wave heights, and NOAA tides at your nearest gauge (delete the tab if you are inland)
- **Daily fire danger** map from your state forestry agency
- **Mosquito and tick activity estimates** computed from the day's forecast
- **Long-term climate risk**: sea level rise, drought, and well-water resources
- A printable **fridge card** with emergency numbers and checklists that work when the power doesn't
- **Storm Mode**: when the NWS issues a severe warning, the whole page switches to a red alert layout with a preparedness checklist, tide timing, and the utility's phone number (preview it any time with `?storm=demo`)

It is plain HTML/CSS/JS with **no build step and no backend**, hosted free on GitHub Pages. Large type, high contrast, plain language, and no app to install, for an audience that skews older and non-technical.

All town-specific values live in one file, [`town.json`](town.json). The version in this repo describes a fictional town, "Exampleton, Anystate", and its NWS and NOAA identifiers are placeholders: the page will load but show errors or fallbacks until you replace them.

## Use this template

1. On GitHub, click **Use this template** (top right) and choose **Create a new repository**. (If you are reading a copy that is not a template, clone it and push to a new repo instead.)
2. Edit `town.json` for your town (steps below).
3. Turn on GitHub Pages: **Settings, Pages**, deploy from the `main` branch, root folder.
4. Optional, for outage data: **Settings, Actions, General**, allow workflows read/write permissions, then add your API key as a repository secret (see "Point the outage data at your utility").

## Adapt it to your town

### 1. Name and place

Edit `site` in `town.json`: `name`, `place` (used in sentences such as "No active weather alerts for ..."), `kicker`, `tagline`, `description`, and `area_name` (the county or region used in the storm-mode demo alert).

### 2. Point the weather at your town

Get your identifiers from the free, keyless NWS API: open `https://api.weather.gov/points/{lat},{lon}` for your coordinates and copy:

| `town.json` key | What it is | Where to find it |
|---|---|---|
| `location.lat`, `location.lon` | Town coordinates (map centers, forecast link) | Any map |
| `location.timezone` | IANA time zone (used by the test browser) | e.g. `America/New_York` |
| `nws.office`, `nws.grid_x`, `nws.grid_y` | Forecast gridpoint | `properties.gridId`, `gridX`, `gridY` |
| `nws.alerts_zone` | Forecast zone for alerts | `properties.forecastZone` (last part, e.g. `XXZ000`) |
| `nws.marine_zone` | Coastal waters zone | [NWS marine zones](https://www.weather.gov/marine/); delete the Seas tab if inland |
| `nws.radar_station` | Nearest radar, e.g. `KXXX` | `properties.radarStation` |
| `tides.station` | NOAA tide station ID | [tidesandcurrents.noaa.gov](https://tidesandcurrents.noaa.gov/) |

### 3. Point the outage data at your utility

This is the piece that varies most. Many utilities block cross-origin requests from other websites, so `.github/workflows/outages.yml` runs every 15 minutes, fetches the utility's public data server-side with `scripts/fetch_outages.py`, and commits `data/outages.json` for the page to read (the "git scraping" pattern).

- **Kubra Storm Center** utilities usually allow direct browser requests (look for `kubra.io/stormcenter/api` in your browser's dev tools on the outage map page). You may be able to skip the workflow and change `loadOutages()` in `app.js` to fetch directly.
- **Avangrid-family utilities** (the response shape `fetch_outages.py` understands): set `outages.provider` to `"avangrid"`, set `api_url`, `api_key_header`, `match_town`, and `match_county`, and add the public subscription key from your utility's outage-map request headers as a repository secret named `OUTAGE_API_KEY` (**Settings, Secrets and variables, Actions**). `town.json` stores only the *name* of the environment variable (`api_key_env`), never the key. If you rename it, update the `env:` line in `outages.yml` to match.
- **Anything else**: set `outages.provider` to `"none"` and rely on the link-out buttons (`report_url`, `map_url`). A reliable button beats a broken widget. The page shows a "data unavailable" message with the buttons if the data file is missing.

`data/outages.json` in this repo is a tiny fictional sample. With provider `"none"` or no secret, the workflow does nothing.

### 4. Swap the state-level resources

- **Fire danger**: set `fire.map_url` (and the agency text). Check that the site allows iframes; if not, the "open full-screen" button still works. Some maps need the iframe offset; see the comment above `.embed-fire` in `styles.css`.
- **Drought**: the [U.S. Drought Monitor](https://droughtmonitor.unl.edu/) publishes a PNG per state; change `current_us_trd.png` in `drought.image_url` to your state code, e.g. `current_ca_trd.png`.
- **Resource lists**: `resources.flood`, `resources.drought`, and `resources.pests` are lists of `{title, url, description}` links. Replace them with your county, state, and university-extension pages.
- **Pest model**: the scoring in `pests.js` works anywhere, but the seasonal calendars (`mosquitoSeason`, `tickSeason`) are tuned for a northern temperate climate. Adjust the months for your latitude, or delete the Mosquitoes and Ticks tab.

### 5. Localize the words

The highest-value content is also the cheapest to change: the `local_meaning` entries (what each alert type means *here*: which road floods, who to call, where the shelter is), the `fridge_card` phone numbers and write-in lines, and the checklists in `fridge-card.html` and the storm banner in `index.html`. National sites will never have this local knowledge.

`local_meaning` is checked in order and the first matching `pattern` (a case-insensitive regular expression against the NWS event name) wins, so put specific entries before general ones.

### 6. Regenerate the QR code

`assets/site-qr.svg` points at a placeholder URL. Regenerate it for your site, then commit it:

```sh
pip install segno
python3 -c "import segno; segno.make('https://YOUR-SITE-URL/', error='m').save('assets/site-qr.svg', scale=4, dark='#16262e', xmldecl=True)"
```

## Config reference (`town.json`)

| Block | Keys |
|---|---|
| `site` | `name`, `short_name`, `place`, `kicker`, `tagline`, `description`, `app_id` (sent to NOAA as the application name; letters, digits, underscore), `public_url`, `region_name`, `area_name` |
| `location` | `lat`, `lon`, `timezone`, `map_zoom` (Windy map) |
| `nws` | `office`, `grid_x`, `grid_y`, `alerts_zone`, `marine_zone`, `marine_description`, `radar_station`, `radar_name` |
| `tides` | `station`, `name` |
| `outages` | `provider` (`none` or `avangrid`), `utility_name`, `utility_short`, `phone_display`, `phone_dial` (digits only, used for `tel:` links), `report_url`, `map_url`, `api_url`, `api_key_header`, `api_key_env` (env var **name**), `match_town`, `match_county`, `county_label`, `timestamp_zone_label`, `data_file` |
| `alerts` | `storm_severities` (NWS severities that trigger Storm Mode), `storm_event_pattern` (regex of event names that also trigger it), `demo_event` (event shown by `?storm=demo`) |
| `thresholds` | `wind_watch_mph`, `wind_caution_mph`, `gust_watch_mph`, `gust_caution_mph`, `seas_watch_ft`, `seas_caution_ft` (when forecast cards get tinted) |
| `fire` | `agency`, `map_url`, `map_title`, `season`, `burn_note` |
| `drought` | `image_url`, `image_alt`, `region_name`, `well_note` |
| `resources` | `flood`, `drought`, `pests`: lists of `{title, url, description}` |
| `fridge_card` | `title`, `description`, `phones` (list of `{label, number, urgent?}`), `write_ins` (list of labels), `qr_alt` |
| `local_meaning` | ordered list of `{pattern, text}` |

`town.json` is public (it is served by your site), so never put keys or personal contact details in it.

## Architecture notes

- **Plain HTML/CSS/JS, no framework, no build step**, so future maintainers only need a text editor.
- The browser loads `town.json` at start-up; `app.js` fills the page text and builds all NWS, NOAA, Windy, and Climate Central URLs from it. Elements marked `data-town="path.in.config"` in `index.html` get their text from the config.
- All live data is fetched client-side from free public APIs (NWS, NOAA tides) except utility outage data, which the GitHub Action snapshots into the repo.
- Fetch failures degrade gracefully: every live section falls back to a labeled link to the official source.
- The pest meters are **weather-based estimates, not surveillance**.

## Tests

None of the tests need internet access or API keys. Node and Playwright are used only for testing.

```sh
npm install
npx playwright install chromium
npm test            # unit + python + browser tests
npm run test:unit   # Node only: text helpers, pest model, town.json validation, outage data contract
npm run test:py     # Python only: scripts/fetch_outages.py parsing (standard library, no installs)
npm run test:e2e    # Playwright against a local static server, with NWS/NOAA/outage data mocked
```

The unit tests read `town.json`, so they keep passing after you adapt it, and the config test catches typos (bad regexes, malformed zone codes, a key pasted where an env var name belongs). `.github/workflows/tests.yml` runs everything on pull requests and pushes to `main`.

## Maintenance

- GitHub pauses cron workflows after ~60 days of repo inactivity. The outage bot's commits normally keep it alive; if outage timestamps go stale, re-enable the workflow under the Actions tab.
- If the utility rotates its public API key, the fetch fails and the page keeps showing the last good data; update the repository secret.

## Disclaimer

A site built from this template is a community resource, not an official emergency channel. Always follow guidance from local officials, and call 911 in an emergency.

## License

[MIT](LICENSE), copyright Annie Britton.
