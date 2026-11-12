# Adapt it to your town

### 1. Name and place

Edit `site` in `town.json` (compare with [`examples/southport/town.json`](../examples/southport/town.json) for what finished values look like): `name`, `place` (used in sentences such as "No active weather alerts for ..."), `kicker`, `tagline`, `description`, and `area_name` (the county or region used in the storm-mode demo alert).

### 2. Point the weather at your town

Get your identifiers from the free, keyless NWS API: open `https://api.weather.gov/points/{lat},{lon}` for your coordinates and copy:

| `town.json` key | What it is | Where to find it |
|---|---|---|
| `location.lat`, `location.lon` | Town coordinates (map centers, forecast link) | Any map |
| `location.timezone` | IANA time zone (the tests run the browser in the root config's zone) | e.g. `America/New_York` |
| `nws.office`, `nws.grid_x`, `nws.grid_y` | Forecast gridpoint | `properties.gridId`, `gridX`, `gridY` |
| `nws.alerts_zone` | Forecast zone for alerts | `properties.forecastZone` (last part, e.g. `XXZ000`) |
| `nws.marine_zone` | Coastal waters zone | [NWS marine zones](https://www.weather.gov/marine/); not needed if `features.marine` is `false` |
| `nws.radar_station` | Nearest radar, e.g. `KXXX` | `properties.radarStation` |
| `tides.station` | NOAA tide station ID | [tidesandcurrents.noaa.gov](https://tidesandcurrents.noaa.gov/); not needed if `features.tides` is `false` |

#### Inland towns (no coast)

Turn off the coastal parts in `town.json`; no HTML editing is needed:

```json
"features": { "marine": false, "tides": false, "climate_coastal": false, "pests": true }
```

This removes the Seas & Wind tab and tile, the tides, the coastal flood map, and the boat and high-tide lines from the storm banner and fridge card. You can then delete `nws.marine_zone`, `nws.marine_description`, the `tides` block and the `seas_*` thresholds. Also replace `alerts.demo_event` (what `?storm=demo` shows) with an alert your area really gets, such as `Red Flag Warning`, and drop coastal entries from `local_meaning`. `npm run check-config` lists any coastal wording still left. See [`examples/inland-desert/town.json`](../examples/inland-desert/town.json).

`features.pests: false` removes the Mosquitoes & Ticks tab (useful if the seasonal calendars do not fit your climate).

#### Values you cannot verify yet

Write `TODO` (or `TODO: reason`) instead of guessing. A phone number of `TODO` appears on the page and fridge card as a visible **TODO: add number** and is never a dialable link, and a TODO link is simply not shown. `npm run check-config` lists every TODO. Never invent phone numbers, agencies or shelter locations: a wrong number on an emergency card is worse than a visible gap.

### 3. Point the outage data at your utility

See [outages.md](outages.md): it covers the workflow, the secret, `match_town`, and how the page decides whether outage numbers are trustworthy.

### 4. Swap the state-level resources

- **Fire danger**: set `fire.map_url` (and the agency text). Many agencies forbid embedding their map (a blank frame); set `fire.embed` to `false` to show only the "open full-screen" button. Some maps need the iframe offset; see the comment above `.embed-fire` in `styles.css`.
- **Drought**: the [U.S. Drought Monitor](https://droughtmonitor.unl.edu/) publishes a PNG per state; change `current_conus_trd.png` in `drought.image_url` to your state code, e.g. `current_ca_trd.png`.
- **Resource lists**: `resources.flood`, `resources.drought`, and `resources.pests` are lists of `{title, url, description}` links. Replace them with your county, state, and university-extension pages.
- **Pest model**: the scoring in `pests.js` works anywhere, but the seasonal calendars (`mosquitoSeason`, `tickSeason`) are tuned for a northern temperate climate. Adjust the months for your latitude, or delete the Mosquitoes and Ticks tab.

### 5. Localize the words

The highest-value content is also the cheapest to change: the `local_meaning` entries (what each alert type means *here*: which road floods, who to call, where the shelter is), the `fridge_card` phone numbers and write-in lines, and and the checklists in `fridge-card.html` and the storm banner in `index.html` (these two files are plain HTML you may edit; lines about boats and tides are hidden automatically when `features.marine` is `false`). National sites will never have this local knowledge.

`local_meaning` is checked in order and the first matching `pattern` (a case-insensitive regular expression against the NWS event name) wins, so put specific entries before general ones.

### 6. Regenerate the QR code

`assets/site-qr.svg` points at a placeholder URL. Regenerate it for your site (use the same URL as `site.public_url`), then commit it. The `title=` argument records the URL inside the file so `npm run check-config` can confirm the code matches `site.public_url`:

```sh
pip install segno
python3 -c "import segno; u='https://YOUR-SITE-URL/'; segno.make(u, error='m').save('assets/site-qr.svg', scale=4, dark='#16262e', xmldecl=True, title=u)"
```

`site.public_url` is also used as the page's canonical URL.
