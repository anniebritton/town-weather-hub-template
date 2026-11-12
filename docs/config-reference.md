# Config reference (`town.json`)

| Block | Keys |
|---|---|
| `features` | `marine`, `tides`, `climate_coastal`, `pests` (booleans, all default `true`; `tides` is off whenever `marine` is off) |
| `site` | `name`, `short_name`, `place`, `kicker`, `tagline`, `description`, `app_id` (sent to NOAA as the application name; letters, digits, underscore), `public_url`, `region_name`, `area_name` |
| `location` | `lat`, `lon`, `timezone`, `map_zoom` (Windy map) |
| `nws` | `office`, `grid_x`, `grid_y`, `alerts_zone`, `marine_zone`\*, `marine_description`\*, `radar_station`, `radar_name` |
| `tides`\* | `station`, `name` |
| `outages` | `provider` (`none` or `avangrid`), `utility_name`, `utility_short`, `phone_display`, `phone_dial` (digits only, used for `tel:` links), `report_url`, `map_url`, `api_url`, `api_key_header`, `api_key_env` (env var **name**), `match_town`, `match_county`, `county_label`, `timestamp_zone_label`, `data_file` (must be a file inside `data/`), `stale_after_minutes`, `max_source_age_minutes`, `match_verified` |
| `alerts` | `storm_severities` (NWS severities that trigger Storm Mode), `storm_event_pattern` (regex of event names that also trigger it), `demo_event` (event shown by `?storm=demo`) |
| `thresholds` | `wind_watch_mph`, `wind_caution_mph`, `gust_watch_mph`, `gust_caution_mph`, `seas_watch_ft`\*, `seas_caution_ft`\* (when forecast cards get tinted) |
| `fire` | `agency`, `map_url`, `embed` (`false` hides the iframe), `map_title`, `season`, `burn_note` |
| `drought` | `image_url`, `image_alt`, `region_name`, `well_note` |
| `resources` | `flood`, `drought`, `pests`: lists of `{title, url, description}` |
| `fridge_card` | `title`, `description`, `phones` (list of `{label, number, urgent?}`), `write_ins` (list of labels), `qr_alt` |
| `local_meaning` | ordered list of `{pattern, text}` |

\* only needed when the matching feature is on. Any value you cannot verify can be `TODO`. Every URL must be `https://` (or `TODO`); the page will not link to anything else.

`town.json` is public (it is served by your site), so never put keys or personal contact details in it.
