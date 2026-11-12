# Town Weather Hub

[![Tests](https://github.com/anniebritton/town-weather-hub-template/actions/workflows/tests.yml/badge.svg)](https://github.com/anniebritton/town-weather-hub-template/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A one-page weather, power, and coast dashboard you can fork and point at your own small town in an afternoon. National weather apps are too coarse for a rural community and miss what matters locally: which utility to call, what a gale warning means for the boats on your moorings, whether the well is going dry. This puts that in one place, in large plain type.

![Town Weather Hub rendered with the Southport, Maine example config](docs/screenshot-desktop.png)

*Illustrative: the Southport example config rendered with mocked weather data (the live demo's page is titled "Island Weather Hub", the title set in that config). Power reads "Unavailable" because the demo is not connected to a utility; the screenshots show the same.*

**Live demo (Southport, Maine example): <https://anniebritton.github.io/town-weather-hub-template/>** (works once GitHub Pages is enabled for the repo).

It is plain HTML/CSS/JS: **no server, no build step, no paid services**. Data comes from free public sources (National Weather Service, NOAA tides, the U.S. Drought Monitor), and the site is hosted free on GitHub Pages.

**Good fit:** a small town, island or rural county, with someone comfortable editing one JSON file. **Not** a replacement for official emergency channels (see the disclaimer below).

## What you get

- **Weather alerts and forecast** from the NWS, with plain-language "what this means for your town" text you write once
- **Power outage numbers** from your utility's public data (optional). The page says "Unavailable", never a reassuring "On", whenever the numbers are missing, malformed or stale
- **Marine and tides**, **fire danger**, **drought** with well guidance, and **mosquito and tick estimates**. The coastal parts switch off with one line for inland towns ([example](examples/inland-desert/town.json))
- A printable **fridge card** with emergency numbers that works when the power doesn't
- **Storm Mode**: a severe NWS warning switches the page to a red layout with a checklist and the utility's phone number (preview with `?storm=demo`)

<img src="docs/screenshot-mobile.png" alt="Mobile view of the same page" width="260">

## Set it up

1. Click **Use this template**, then **Create a new repository**.
2. Edit [`town.json`](town.json) for your town: every town-specific value lives there. [`examples/southport/`](examples/southport/town.json) (real coastal town, finished) and [`examples/inland-desert/`](examples/inland-desert/town.json) show finished configs.
3. Run `npm run check-config` to list what is still a placeholder or `TODO`, and `npm run check-config:online` to have NWS and NOAA confirm your zone, grid, radar and tide station.
4. Turn on GitHub Pages **before your first push**: Settings, Pages, Source: **GitHub Actions**. The included `pages.yml` publishes your own `town.json`.
5. Optional, for outage data: follow [docs/outages.md](docs/outages.md).

> **Using an AI coding agent?** Point it at [`AGENTS.md`](AGENTS.md): it has a step-by-step "set this up for my town" workflow and the rules for changing the template.

## Docs

- [Adapt it to your town](docs/adapting.md): name, NWS identifiers, inland towns, `TODO` values, state resources, local wording, QR code
- [Outage data](docs/outages.md): utility setup, the secret, how the page decides if numbers are trustworthy
- [Config reference](docs/config-reference.md): every `town.json` key
- [Development notes](docs/development.md): architecture, safety rules, tests
- [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

## Disclaimer

A site built from this template is a community resource, not an official emergency channel. Always follow guidance from local officials, and call 911 in an emergency.

## License

[MIT](LICENSE), copyright Annie Britton.
