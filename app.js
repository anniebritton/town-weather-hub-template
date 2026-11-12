/*
 * Town Weather Hub
 * Every town-specific value (name, NWS zones, tide station, utility, local
 * guidance text, thresholds...) comes from town.json. Nothing is hardcoded here.
 * Live data: api.weather.gov (NWS) and NOAA tides are fetched client-side;
 * utility outage numbers are read from the data file named in town.json
 * (refreshed on a schedule by a GitHub Action, since most utility APIs are
 * CORS-restricted to their own portal).
 *
 * Safety rules (see town-utils.js): remote data is rendered as text or as numbers
 * that passed num(); URLs from town.json must pass safeUrl(); identifiers that go
 * into URLs must match their documented shape; and missing or broken settings
 * produce a visible message, never a blank page.
 */

const {
  SHAPES, isTodo, escapeHtml, num, safeUrl, telHref, ident, getPath, feature, applyFeatures, applyBindings,
} = (typeof module !== "undefined" && module.exports) ? require("./town-utils.js") : TownUtils;

/* ---------- town config ---------- */

let TOWN = null; // set by setTown(); the browser loads it from town.json at boot

const DEFAULT_THRESHOLDS = {
  wind_watch_mph: 20, wind_caution_mph: 30, gust_watch_mph: 20, gust_caution_mph: 30,
  seas_watch_ft: 5, seas_caution_ft: 8,
};
const DEFAULT_STALE_MINUTES = 90; // outage data older than this is shown as unavailable
const MAX_FUTURE_MS = 5 * 60 * 1000; // a timestamp further ahead than this is clock trouble or tampering
const MAX_COUNT = 1e9; // no utility has a billion customers; this rejects 1e308 and friends
const REQUIRED_BLOCKS = ["site", "location", "nws"];

function setTown(config) {
  TOWN = config;
}

/* A description of what is wrong with a loaded town.json, or null if the page can start. */
function findConfigProblem(town) {
  if (!town || typeof town !== "object" || Array.isArray(town)) return "town.json must contain a JSON object.";
  const missing = REQUIRED_BLOCKS.filter((b) => !town[b] || typeof town[b] !== "object");
  if (missing.length) return `town.json is missing the required ${missing.map((b) => `"${b}"`).join(", ")} block${missing.length > 1 ? "s" : ""}.`;
  for (const [path, label] of [["site.name", "site.name"], ["site.place", "site.place"]]) {
    if (typeof getPath(town, path) !== "string" || !getPath(town, path).trim()) return `town.json needs a non-empty "${label}".`;
  }
  return null;
}

function nwsUrls() {
  const n = TOWN.nws;
  const office = ident(n.office, SHAPES.office);
  const gx = Number.isInteger(n.grid_x) ? n.grid_x : null;
  const gy = Number.isInteger(n.grid_y) ? n.grid_y : null;
  if (!office || gx === null || gy === null) throw new Error('town.json "nws.office", "nws.grid_x" and "nws.grid_y" are not valid.');
  const zone = ident(n.alerts_zone, SHAPES.alertsZone);
  if (!zone) throw new Error('town.json "nws.alerts_zone" is not a valid NWS zone code (like MEZ026).');
  const grid = `https://api.weather.gov/gridpoints/${office}/${gx},${gy}`;
  return {
    forecast: `${grid}/forecast`,
    hourly: `${grid}/forecast/hourly`,
    marineProducts: `https://api.weather.gov/products/types/CWF/locations/${office}`,
    alerts: `https://api.weather.gov/alerts/active?zone=${zone}`,
  };
}

/* ---------- helpers ---------- */

function el(id) {
  return document.getElementById(id);
}

function setStatus(id, message) {
  const node = el(id);
  if (node) node.textContent = message;
}

function setTile(id, state, value, sub) {
  const tile = el(id);
  if (!tile) return;
  tile.classList.remove("is-ok", "is-warn", "is-bad");
  if (state) tile.classList.add(`is-${state}`);
  const valueEl = tile.querySelector(".tile-value");
  valueEl.classList.remove("skeleton");
  valueEl.textContent = value;
  tile.querySelector(".tile-sub").textContent = sub || "";
}

function formatTime(iso) {
  if (typeof iso !== "string" && typeof iso !== "number") return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function severityClass(severity) {
  const s = (typeof severity === "string" ? severity : "").toLowerCase();
  return s === "extreme" || s === "severe" ? "severity-severe" : "severity-watch";
}

/*
 * Rough-weather tint for forecast/marine cards.
 * Returns "", "cond-watch", "cond-caution", or "cond-severe".
 */
function hazardLevel(text) {
  const t = (typeof text === "string" ? text : "").toLowerCase();
  if (/hurricane|tropical storm|gale|storm warning|severe thunderstorm|damaging|blizzard|ice storm|storm force/.test(t)) {
    return "cond-severe";
  }
  let level = 0; // 0 calm, 1 watch, 2 caution
  if (/thunderstorm|squall|heavy rain|heavy snow|freezing|dense fog|small craft|waterspout/.test(t)) level = 2;
  else if (/showers|rain|snow|drizzle|fog/.test(t)) level = 1;

  const th = { ...DEFAULT_THRESHOLDS, ...(TOWN && TOWN.thresholds) };
  const gust = t.match(/gusts (?:up )?to (\d+)/);
  if (gust) {
    if (+gust[1] >= th.gust_caution_mph) level = 2;
    else if (+gust[1] >= th.gust_watch_mph) level = Math.max(level, 1);
  }
  for (const w of t.matchAll(/winds?[^.]*?(\d+)(?:\s+to\s+(\d+))?\s*(kt|mph)/g)) {
    const mph = +(w[2] || w[1]) * (w[3] === "kt" ? 1.15 : 1);
    if (mph >= th.wind_caution_mph) level = 2;
    else if (mph >= th.wind_watch_mph) level = Math.max(level, 1);
  }
  const seas = t.match(/seas[^.]*?(\d+)(?:\s+to\s+(\d+))?\s*ft/);
  if (seas) {
    const ft = +(seas[2] || seas[1]);
    if (ft >= th.seas_caution_ft) level = 2;
    else if (ft >= th.seas_watch_ft) level = Math.max(level, 1);
  }
  if (/slight chance/.test(t)) level = Math.max(level - 1, 0);
  return level === 2 ? "cond-caution" : level === 1 ? "cond-watch" : "";
}

/* A text label for a tint, so the meaning never depends on color alone. */
const HAZARD_LABELS = {
  "cond-watch": "Some chance of rougher weather",
  "cond-caution": "Rougher weather likely",
  "cond-severe": "Severe weather possible",
};

function hazardTag(level) {
  return HAZARD_LABELS[level] ? `<span class="cond-tag">${escapeHtml(HAZARD_LABELS[level])}</span>` : "";
}

/* ---------- "What this means for <town>" translations (from town.json) ---------- */

// First match wins, so order matters: specific entries before general ones.
// A broken pattern in one entry is skipped; it must never stop alerts from being shown.
function localMeaning(event) {
  const entries = TOWN && Array.isArray(TOWN.local_meaning) ? TOWN.local_meaning : [];
  for (const entry of entries) {
    try {
      if (new RegExp(entry.pattern, "i").test(typeof event === "string" ? event : "")) return entry.text;
    } catch (err) {
      console.warn(`Ignoring invalid local_meaning pattern ${JSON.stringify(entry && entry.pattern)}:`, err.message);
    }
  }
  return null;
}

/* ---------- storm mode ---------- */

function isStormAlert(p) {
  const alerts = (TOWN && TOWN.alerts) || {};
  const severities = Array.isArray(alerts.storm_severities) ? alerts.storm_severities : ["Extreme", "Severe"];
  let byEvent = false;
  try {
    byEvent = new RegExp(alerts.storm_event_pattern || "(?!)", "i").test(typeof p?.event === "string" ? p.event : "");
  } catch (err) {
    console.warn("Ignoring invalid alerts.storm_event_pattern:", err.message);
  }
  return severities.includes(p?.severity) || byEvent;
}

const DEMO_STORM = typeof location !== "undefined" && new URLSearchParams(location.search).get("storm") === "demo";

function demoAlert() {
  const event = (TOWN.alerts && TOWN.alerts.demo_event) || "Severe Weather Warning";
  return {
    properties: {
      severity: "Severe",
      event,
      headline: `${event} issued for ${TOWN.site.area_name || TOWN.site.place} (DEMO — this is a preview, not a real alert)`,
      description: "This is a demonstration of Storm Mode. During a real warning, the National Weather Service alert text would appear here with details about expected conditions and timing.",
      instruction: "This is a preview only. No storm is expected.",
      effective: new Date().toISOString(),
      expires: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    },
  };
}

function enterStormMode(alerts) {
  const active = alerts.filter((f) => isStormAlert(f.properties));
  if (!active.length) return;
  const banner = el("storm-banner");
  if (!banner) return;
  document.body.classList.add("storm-mode");
  banner.hidden = false;
  const p = active[0].properties || {};
  el("storm-headline").textContent = `${typeof p.event === "string" ? p.event : "Severe weather"} is in effect for our area`;
  fillStormTide();
}

/* ---------- weather alerts + forecast ---------- */

/* False only when NWS says it has never heard of the alert zone (HTTP 404); network trouble is not a config error. */
async function zoneRecognised() {
  const zone = ident(TOWN.nws && TOWN.nws.alerts_zone, SHAPES.alertsZone);
  if (!zone) return false;
  try {
    const res = await fetch(`https://api.weather.gov/zones/${zone[2] === "C" ? "county" : "forecast"}/${zone}`);
    return res.status !== 404;
  } catch {
    return true;
  }
}

function alertCardHtml(f) {
  const p = f.properties || {};
  const text = (v, fallback) => (typeof v === "string" && v ? v : fallback);
  const meaning = localMeaning(p.event);
  return `
          <div class="alert-card ${severityClass(p.severity)}">
            <span class="alert-label">${escapeHtml(text(p.severity, "Alert"))} — ${escapeHtml(text(p.event, "Weather Alert"))}</span>
            <h3>${escapeHtml(text(p.headline, text(p.event, "Weather Alert")))}</h3>
            <p>${escapeHtml(text(p.description, "").split("\n").slice(0, 3).join(" "))}</p>
            <p class="alert-meta">Effective: ${escapeHtml(formatTime(p.effective))} &middot; Expires: ${escapeHtml(formatTime(p.expires))}</p>
            ${text(p.instruction, "") ? `<p><strong>What to do:</strong> ${escapeHtml(p.instruction.split("\n")[0])}</p>` : ""}
            ${meaning ? `
            <details class="alert-local">
              <summary>What this means for ${escapeHtml(TOWN.site.place)}</summary>
              <p>${escapeHtml(meaning)}</p>
            </details>` : ""}
          </div>`;
}

async function loadAlerts() {
  const listEl = el("alerts-list");
  try {
    const res = await fetch(nwsUrls().alerts);
    if (!res.ok) throw new Error(`Alerts request failed: ${res.status}`);
    const data = await res.json();
    const alerts = (Array.isArray(data.features) ? data.features : []).filter((f) => f && typeof f === "object");
    if (DEMO_STORM) alerts.unshift(demoAlert());
    try { enterStormMode(alerts); } catch (err) { console.error(err); }

    if (alerts.length === 0) {
      if (!(await zoneRecognised())) {
        const zone = escapeHtml(TOWN.nws.alerts_zone);
        setStatus("alerts-status", "");
        listEl.innerHTML = `
        <div class="alert-card severity-watch">
          <span class="alert-label">Setup problem</span>
          <p>The National Weather Service does not recognise the alert zone <strong>${zone}</strong> in town.json, so this page cannot tell you whether there are alerts. Check the weather.gov link below.</p>
        </div>`;
        setTile("tile-weather", "warn", "Check setup", "Alert zone not recognised");
        return;
      }
      setStatus("alerts-status", "");
      listEl.innerHTML = `
        <div class="alert-card severity-none">
          <span class="alert-label">All clear</span>
          <p>No active weather alerts for ${escapeHtml(TOWN.site.place)} right now.</p>
        </div>`;
      setTile("tile-weather", "ok", "All clear", "No active alerts");
    } else {
      setStatus("alerts-status", `${alerts.length} active alert${alerts.length > 1 ? "s" : ""}:`);
      // One malformed alert must not hide the others
      listEl.innerHTML = alerts.map((f) => {
        try {
          return alertCardHtml(f);
        } catch (err) {
          console.error(err);
          return `<div class="alert-card severity-watch"><span class="alert-label">Alert</span><p>A weather alert was issued but could not be displayed. See weather.gov.</p></div>`;
        }
      }).join("");
      const worst = alerts.some((f) => ["Extreme", "Severe"].includes(f.properties?.severity));
      const firstEvent = alerts[0].properties?.event;
      const first = typeof firstEvent === "string" && firstEvent ? firstEvent : "Weather alert";
      setTile("tile-weather", worst ? "bad" : "warn", first,
        alerts.length > 1 ? `+ ${alerts.length - 1} more alert${alerts.length > 2 ? "s" : ""}` : "Tap Alerts below for details");
    }
  } catch (err) {
    console.error(err);
    setStatus("alerts-status", "Couldn't load live alerts right now — use the weather.gov link below.");
    listEl.innerHTML = "";
    setTile("tile-weather", null, "Unavailable", "Check weather.gov");
  }
}

async function loadForecast() {
  const grid = el("forecast-summary");
  try {
    const res = await fetch(nwsUrls().forecast);
    if (!res.ok) throw new Error(`Forecast request failed: ${res.status}`);
    const data = await res.json();
    const periods = (data.properties?.periods || []).slice(0, 4);
    if (!periods.length) throw new Error("Empty forecast");
    grid.innerHTML = periods.map((p) => {
      const temp = num(p.temperature);
      const unit = p.temperatureUnit === "C" ? "C" : "F";
      const level = hazardLevel(p.detailedForecast);
      return `
      <div class="forecast-card ${level}">
        <h4>${escapeHtml(p.name)}</h4>
        <span class="temp">${temp === null ? "—" : `${Math.round(temp)}°${unit}`}</span>
        <p>${escapeHtml(p.detailedForecast)}</p>
        ${hazardTag(level)}
      </div>`;
    }).join("");
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<p class="status-line">Forecast unavailable — use the weather.gov link below.</p>`;
  }
}

/* ---------- marine ---------- */

async function loadMarineForecast() {
  const grid = el("marine-forecast");
  try {
    const typesRes = await fetch(nwsUrls().marineProducts);
    if (!typesRes.ok) throw new Error(`Marine product list failed: ${typesRes.status}`);
    const typesData = await typesRes.json();
    const latest = typesData["@graph"]?.[0]?.["@id"];
    if (!latest) throw new Error("No marine forecast product found");

    const productRes = await fetch(latest);
    if (!productRes.ok) throw new Error(`Marine product fetch failed: ${productRes.status}`);
    const productData = await productRes.json();

    const zone = ident(TOWN.nws.marine_zone, SHAPES.marineZone);
    if (!zone) throw new Error('town.json "nws.marine_zone" is not a valid NWS zone code');
    const section = extractZoneSection(typeof productData.productText === "string" ? productData.productText : "", zone);
    if (!section) throw new Error("Zone section not found");

    setStatus("marine-status", "");
    const periods = parseMarinePeriods(section).slice(0, 4);
    grid.innerHTML = periods.map((p) => {
      const d = parseMarineDetail(p.body);
      const arrow = windArrow(d.wind);
      const level = hazardLevel(p.body);
      return `
      <div class="marine-period ${level}">
        <h4>${escapeHtml(p.name)}</h4>
        ${hazardTag(level)}
        <div class="m-seas">${escapeHtml(compressSeas(d.seas))}<span class="m-seas-label">seas</span></div>
        ${d.wind ? `
        <div class="m-row">
          <span class="m-label">Wind</span>
          <div class="m-wind">${arrow}<span>${escapeHtml(compressWind(d.wind))}</span></div>
        </div>` : ""}
        ${d.waves ? `
        <div class="m-row">
          <span class="m-label">Waves</span>
          <div class="m-waves">${compressWaves(d.waves)}</div>
        </div>` : ""}
        ${d.note ? `
        <div class="m-row">
          <span class="m-label">Note</span>
          <p class="m-note">${escapeHtml(d.note)}</p>
        </div>` : ""}
      </div>`;
    }).join("");

    const seas = seasHeadline(periods[0]?.body);
    const wind = periods[0]?.body.match(/^([A-Z]{1,3} winds [^.]+?kt)/i);
    setTile("tile-seas", null, seas || "See forecast", wind ? wind[1] : `Coastal waters off ${TOWN.site.place}`);
  } catch (err) {
    console.error(err);
    setStatus("marine-status", "Couldn't load live marine conditions — use the links below.");
    grid.innerHTML = "";
    setTile("tile-seas", null, "Unavailable", "Check weather.gov");
  }
}

/* Hero tile text from a period's seas: "4–5 ft seas", "≤1 ft seas" (calm days), or null */
function seasHeadline(body) {
  const m = (body || "").match(/\bSeas?\b[^.]*?(\d+)(?:\s+to\s+(\d+))?\s*(?:ft|foot|feet)\b( or less)?/i);
  if (!m) return null;
  if (m[3]) return `≤${m[1]} ft seas`;
  return `${m[2] ? `${m[1]}–${m[2]}` : m[1]} ft seas`;
}

function extractZoneSection(fullText, zoneCode) {
  const startIdx = fullText.indexOf(`${zoneCode}-`);
  if (startIdx === -1) return null;
  const rest = fullText.slice(startIdx);
  // Zone sections in NWS text products end at "$$" or the next zone header
  // (zone headers look like "XXZ001-142300-": three letters, three digits, dash)
  let endIdx = rest.length;
  const dollars = rest.indexOf("\n$$", 10);
  if (dollars !== -1) endIdx = dollars;
  const nextZone = rest.slice(10).search(/\n[A-Z]{2}[A-Z]\d{3}-/);
  if (nextZone !== -1 && nextZone + 10 < endIdx) endIdx = nextZone + 10;
  return rest.slice(0, endIdx).trim();
}

/* Marine text compressors — trim NWS phrasing down to scannable fragments */

function compressSeas(seas) {
  if (!seas) return "—";
  return seas
    .replace(/^around\s+/i, "~")
    .replace(/(\d+)\s+to\s+(\d+)\s*ft/i, "$1–$2 ft")
    .replace(/\s*ft\b/i, " ft");
}

function compressWind(wind) {
  return wind
    .replace(/\bwinds?\s+/i, " ")
    .replace(/(\d+)\s+to\s+(\d+)\s*kt/gi, "$1–$2 kt")
    .replace(/gusts up to (\d+) kt/i, "gusts $1 kt")
    .trim();
}

function compressWaves(waves) {
  // "SE 4 ft at 8 seconds" → "4 ft from the SE, every 8 s"
  return waves
    .split(/\s+and\s+/i)
    .map((w) => {
      const m = w.trim().match(/^([NSEW]{1,3})\s+(\d+)\s*ft at (\d+) seconds?/i);
      if (m) return escapeHtml(`${m[2]} ft from the ${m[1].toUpperCase()}, every ${m[3]} s`);
      return escapeHtml(w.trim());
    })
    .join("<br>");
}

const COMPASS = {
  N: 0, NNE: 22, NE: 45, ENE: 67, E: 90, ESE: 112, SE: 135, SSE: 157,
  S: 180, SSW: 202, SW: 225, WSW: 247, W: 270, WNW: 292, NW: 315, NNW: 337,
};

/* Arrow showing where the wind blows toward (from-direction + 180°) */
function windArrow(wind) {
  const m = (wind || "").match(/^([NSEW]{1,3})\b/i);
  const from = m ? COMPASS[m[1].toUpperCase()] : undefined;
  if (from === undefined) return "";
  const deg = (from + 180) % 360;
  return `<svg class="m-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(${deg}deg)" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>`;
}

/* Break a period's text blob into labeled parts: wind, seas, wave detail, notes */
function parseMarineDetail(body) {
  const out = { wind: "", seas: "", waves: "", note: "" };
  const sentences = body.split(/(?<=\.)\s+/);
  const notes = [];
  for (const s of sentences) {
    const sent = s.trim().replace(/\.$/, "");
    if (!sent) continue;
    if (/^wave detail:/i.test(sent)) out.waves = sent.replace(/^wave detail:\s*/i, "");
    else if (!out.wind && /\bwinds?\b/i.test(sent)) out.wind = sent;
    else if (!out.seas && /^seas\b/i.test(sent)) out.seas = sent.replace(/^seas\s*/i, "");
    else notes.push(sent);
  }
  out.note = notes.join(". ");
  return out;
}

function parseMarinePeriods(section) {
  // Each period starts with ".NAME..." e.g. ".TODAY...NE winds 5 to 10 kt."
  // Anchored to line starts so "...SMALL CRAFT ADVISORY..." headlines aren't read as periods
  const parts = section.split(/(?:^|\n)\.([A-Z][A-Z .]*?)\.\.\./g);
  const periods = [];
  for (let i = 1; i < parts.length; i += 2) {
    periods.push({
      name: parts[i].trim(),
      body: (parts[i + 1] || "").replace(/\s+/g, " ").trim(),
    });
  }
  return periods;
}

/* ---------- tides (NOAA CO-OPS; station comes from town.json) ---------- */

let nextHighTide = null; // shared with the storm banner

function tideDate(t) {
  // API returns "YYYY-MM-DD HH:MM" in local station time
  return new Date(String(t).replace(" ", "T"));
}

function formatTideTime(d) {
  const today = new Date();
  const opts = { hour: "numeric", minute: "2-digit" };
  if (d.toDateString() !== today.toDateString()) opts.weekday = "short";
  return d.toLocaleString(undefined, opts);
}

/* The NOAA station ID if it has a plausible shape, else null. */
function tideStation() {
  return ident(TOWN && TOWN.tides && TOWN.tides.station, SHAPES.tideStation);
}

function tideTableUrl() {
  const station = tideStation();
  return station
    ? `https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=${encodeURIComponent(station)}`
    : "https://tidesandcurrents.noaa.gov/";
}

async function fetchTidePredictions(ymd) {
  const station = tideStation();
  if (!station) throw new Error('town.json "tides.station" is not a valid NOAA station ID');
  const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=${encodeURIComponent(TOWN.site.app_id || "town_weather_hub")}&station=${encodeURIComponent(station)}&begin_date=${ymd}&range=72&datum=MLLW&time_zone=lst_ldt&units=english&interval=hilo&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tide request failed: ${res.status}`);
  const data = await res.json();
  const predictions = (data.predictions || [])
    .map((p) => ({
      time: tideDate(p?.t),
      height: Number.parseFloat(p?.v),
      high: p?.type === "H",
      low: p?.type === "L",
    }))
    .filter((p) => !Number.isNaN(p.time.getTime()) && Number.isFinite(p.height) && (p.high || p.low));
  if (!predictions.length) throw new Error("No tide predictions returned");
  return predictions;
}

function tideChartTime(d) {
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
}

function interpolateTideCurve(events, start, end) {
  const points = [];
  const step = 30 * 60 * 1000;

  for (let timeMs = start.getTime(); timeMs <= end.getTime(); timeMs += step) {
    const nextIndex = events.findIndex((event) => event.time.getTime() >= timeMs);
    if (nextIndex < 1) continue;
    const previous = events[nextIndex - 1];
    const next = events[nextIndex];
    const duration = next.time.getTime() - previous.time.getTime();
    const progress = (timeMs - previous.time.getTime()) / duration;
    const eased = (1 - Math.cos(Math.PI * progress)) / 2;
    points.push({
      time: new Date(timeMs),
      height: previous.height + (next.height - previous.height) * eased,
    });
  }

  return points;
}

function renderTideChart(events) {
  const chart = el("tide-chart");
  if (!chart) return;

  const now = new Date();
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const points = interpolateTideCurve(events, now, end);
  if (points.length < 2) throw new Error("Not enough tide predictions to draw chart");

  const width = Math.min(900, Math.max(320, document.documentElement.clientWidth - 72));
  const height = 270;
  const pad = { top: 24, right: 18, bottom: 42, left: 46 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const chartEvents = events.filter((p) => p.time >= points[0].time && p.time <= points[points.length - 1].time);
  const chartHeights = [...points, ...chartEvents].map((p) => p.height);
  const rawMin = Math.min(...chartHeights);
  const rawMax = Math.max(...chartHeights);
  const range = Math.max(rawMax - rawMin, 1);
  const min = rawMin - range * 0.12;
  const max = rawMax + range * 0.12;
  const startMs = points[0].time.getTime();
  const endMs = points[points.length - 1].time.getTime();
  const x = (time) => pad.left + ((time.getTime() - startMs) / (endMs - startMs)) * plotWidth;
  const y = (value) => pad.top + ((max - value) / (max - min)) * plotHeight;
  const linePath = points.map((p, i) => `${i ? "L" : "M"} ${x(p.time).toFixed(1)} ${y(p.height).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${x(points[points.length - 1].time).toFixed(1)} ${(pad.top + plotHeight).toFixed(1)} L ${x(points[0].time).toFixed(1)} ${(pad.top + plotHeight).toFixed(1)} Z`;

  const yTicks = [rawMin, (rawMin + rawMax) / 2, rawMax].map((value) => `
    <g class="tide-axis">
      <line x1="${pad.left}" y1="${y(value).toFixed(1)}" x2="${width - pad.right}" y2="${y(value).toFixed(1)}"></line>
      <text x="${pad.left - 8}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end">${value.toFixed(1)}</text>
    </g>`).join("");

  const tickIndexes = [0, 12, 24, 36, points.length - 1]
    .filter((index, position, indexes) => index < points.length && indexes.indexOf(index) === position);
  const xTicks = tickIndexes.map((index) => {
    const point = points[index];
    return `
      <g class="tide-axis tide-axis-x">
        <line x1="${x(point.time).toFixed(1)}" y1="${pad.top}" x2="${x(point.time).toFixed(1)}" y2="${pad.top + plotHeight}"></line>
        <text x="${x(point.time).toFixed(1)}" y="${height - 14}" text-anchor="middle">${tideChartTime(point.time)}</text>
      </g>`;
  }).join("");

  const markers = chartEvents.map((p) => {
    const type = p.high ? "high" : "low";
    const label = p.high ? "High" : "Low";
    return `
      <g class="tide-marker tide-marker-${type}">
        <title>${label} tide at ${formatTideTime(p.time)}, ${p.height.toFixed(1)} feet</title>
        <circle cx="${x(p.time).toFixed(1)}" cy="${y(p.height).toFixed(1)}" r="5"></circle>
        <text x="${x(p.time).toFixed(1)}" y="${(y(p.height) + (p.high ? -10 : 18)).toFixed(1)}" text-anchor="middle">${p.high ? "H" : "L"}</text>
      </g>`;
  }).join("");

  chart.innerHTML = `
    <svg class="tide-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="tide-chart-title tide-chart-desc">
      <title id="tide-chart-title">${escapeHtml(TOWN.site.place)} tide prediction for the next 24 hours</title>
      <desc id="tide-chart-desc">The tide ranges from approximately ${rawMin.toFixed(1)} to ${rawMax.toFixed(1)} feet. NOAA high and low predictions are marked on an interpolated curve.</desc>
      <defs>
        <linearGradient id="tide-area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#86bfd3" stop-opacity="0.55"></stop>
          <stop offset="100%" stop-color="#dbeef5" stop-opacity="0.2"></stop>
        </linearGradient>
      </defs>
      ${yTicks}
      ${xTicks}
      <path class="tide-chart-area" d="${areaPath}"></path>
      <path class="tide-chart-line" d="${linePath}"></path>
      ${markers}
      <text class="tide-axis-label" x="12" y="16">Feet</text>
    </svg>`;
}

async function loadTides() {
  const strip = el("tides-strip");
  const chart = el("tide-chart");
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 1);
  const ymd = `${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, "0")}${String(startDate.getDate()).padStart(2, "0")}`;

  try {
    const events = await fetchTidePredictions(ymd);
    const now = new Date();
    const upcoming = events.filter((p) => p.time > now).slice(0, 4);
    if (!upcoming.length) throw new Error("No upcoming tide predictions returned");

    nextHighTide = upcoming.find((p) => p.high) || null;
    fillStormTide();

    strip.innerHTML = upcoming.map((p, i) => `
      <div class="tide-chip ${p.high ? "tide-high" : ""} ${i === 0 ? "tide-next" : ""}">
        <span class="tide-type">${p.high ? "High" : "Low"}${i === 0 ? " (next)" : ""}</span>
        <span class="tide-time">${formatTideTime(p.time)}</span>
        <span class="tide-height">${p.height.toFixed(1)} ft</span>
      </div>`).join("");

    try {
      renderTideChart(events);
    } catch (err) {
      console.error(err);
      chart.innerHTML = `<p class="status-line">The tide chart is unavailable right now — the high and low tide times above are still current.</p>`;
    }
  } catch (err) {
    console.error(err);
    const link = escapeHtml(tideTableUrl());
    strip.innerHTML = `<p class="status-line">Tide times unavailable right now —
      <a href="${link}" target="_blank" rel="noopener noreferrer">see NOAA's tide table ↗</a></p>`;
    chart.innerHTML = `<p class="status-line">The tide chart is unavailable right now —
      <a href="${link}" target="_blank" rel="noopener noreferrer">see NOAA's tide chart ↗</a></p>`;
  }
}

function fillStormTide() {
  const line = el("storm-tide");
  if (!line || !feature(TOWN, "tides") || !document.body.classList.contains("storm-mode") || !nextHighTide) return;
  line.textContent = `Next high tide: ${formatTideTime(nextHighTide.time)} (${nextHighTide.height.toFixed(1)} ft) — flooding risk is greatest around this time.`;
}

/* ---------- power outages ---------- */

/*
 * Decide whether an outage data file can be shown as current. Returns {ok:true} or {ok:false, reason}.
 * Anything that is not clearly real, recent data from scripts/fetch_outages.py is rejected, so the
 * page says "Unavailable" instead of a reassuring "On" it cannot back up.
 */
function checkOutageData(data, staleMinutes = DEFAULT_STALE_MINUTES, now = Date.now()) {
  const bad = (reason) => ({ ok: false, reason });
  const count = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_COUNT; // whole, non-negative, plausible
  if (!data || typeof data !== "object" || Array.isArray(data)) return bad("not a JSON object");
  if (data.sample === true) return bad("sample data, not from a real utility");
  if (data.status !== undefined && data.status !== "ok") return bad(`status is ${JSON.stringify(data.status)}`);
  if (typeof data.lastUpdated !== "string" || !data.lastUpdated.trim()) return bad("no lastUpdated");
  // utility timestamps are local time with no zone, so reading them as UTC can only make them look EARLIER
  // than they are; a value that still lands in the future is wrong
  const stamped = Date.parse(data.lastUpdated.trim().replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(data.lastUpdated) ? "" : "Z"));
  if (!Number.isNaN(stamped) && stamped - now > MAX_FUTURE_MS) return bad("lastUpdated is in the future");
  if (!data.totals || !count(data.totals.outages)) return bad("totals.outages is not a whole number of customers");
  for (const key of ["town", "county"]) {
    if (!(key in data)) return bad(`no ${key} entry`);
    if (data[key] !== null && (typeof data[key] !== "object" || !count(data[key].Outages))) return bad(`${key}.Outages is not a whole number of customers`);
  }
  const fetched = typeof data.fetchedAt === "string" ? Date.parse(data.fetchedAt) : NaN;
  if (Number.isNaN(fetched)) return bad("no valid fetchedAt time");
  if (fetched - now > MAX_FUTURE_MS) return bad("fetchedAt is in the future");
  const limit = num(staleMinutes) ?? DEFAULT_STALE_MINUTES;
  if (now - fetched > limit * 60000) return bad(`data is more than ${limit} minutes old`);
  return { ok: true };
}

async function loadOutages() {
  const grid = el("outage-stats");
  if (!grid) return;
  const o = TOWN.outages || {};
  const place = escapeHtml(TOWN.site.place);
  const utilityName = typeof o.utility_short === "string" && o.utility_short ? o.utility_short : "your utility";
  const utility = escapeHtml(utilityName);
  const unavailable = (why) => {
    grid.innerHTML = `<p class="status-line">Live outage numbers unavailable${why ? ` (${escapeHtml(why)})` : ""} — use ${utility}'s outage map below.</p>`;
    setTile("tile-power", null, "Unavailable", `Check ${utilityName}'s map`);
    setStatus("outage-updated", "");
  };

  if (!o.provider || o.provider === "none") {
    unavailable("this site isn't connected to the utility's data");
    return;
  }
  try {
    const res = await fetch(typeof o.data_file === "string" ? o.data_file : "data/outages.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`Outage data fetch failed: ${res.status}`);
    const data = await res.json();
    const verdict = checkOutageData(data, o.stale_after_minutes);
    if (!verdict.ok) {
      console.warn(`Outage data rejected: ${verdict.reason}`);
      unavailable(verdict.reason.startsWith("data is more") ? "data is out of date" : "");
      return;
    }

    const townOut = data.town ? data.town.Outages : 0;
    const countyOut = data.county ? data.county.Outages : 0;
    const totalOut = data.totals.outages;
    const fmt = (n) => n.toLocaleString();
    const countyLabel = escapeHtml(typeof o.county_label === "string" ? o.county_label : "the county");

    // The utility reports other towns but none matching ours, and nobody has confirmed the spelling
    // (outages.match_verified): most likely a typo in match_town. Say so instead of claiming "None".
    const unverifiedMatch = data.town === null && Array.isArray(data.towns) && data.towns.length > 0 && data.matchVerified !== true;
    if (unverifiedMatch) {
      const matchName = typeof o.match_town === "string" ? o.match_town : TOWN.site.place;
      grid.innerHTML = `<p class="status-line">No data for ${escapeHtml(matchName)} (check match_town in town.json). Use ${utility}'s outage map below.</p>`;
      setTile("tile-power", "warn", "No data", `for ${matchName}: check match_town`);
      setStatus("outage-updated", "");
      return;
    }

    grid.innerHTML = `
      <div class="stat-card ${townOut ? "stat-bad" : "stat-ok"}">
        <span class="stat-value">${townOut ? fmt(townOut) : "None"}</span>
        <span class="stat-label">${townOut ? `customers out in ${place}` : `No outages in ${place}`}</span>
      </div>
      <div class="stat-card ${countyOut ? "stat-bad" : "stat-ok"}">
        <span class="stat-value">${countyOut ? fmt(countyOut) : "None"}</span>
        <span class="stat-label">${countyOut ? `customers out in ${countyLabel}` : `No outages in ${countyLabel}`}</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">${fmt(totalOut)}</span>
        <span class="stat-label">customers out across all of ${utility}</span>
      </div>`;

    setStatus("outage-updated", `${utilityName} data as of ${data.lastUpdated} (${o.timestamp_zone_label || "local time"}). Refreshes every 15 minutes.`);

    if (townOut) {
      setTile("tile-power", "bad", `${fmt(townOut)} out`, `in ${TOWN.site.place} — see Power section`);
    } else if (countyOut) {
      setTile("tile-power", "warn", `On in ${TOWN.site.place}`, `${fmt(countyOut)} out elsewhere in ${o.county_label || "the county"}`);
    } else {
      setTile("tile-power", "ok", "On", `No outages reported in ${o.county_label || "the county"}`);
    }
  } catch (err) {
    console.error(err);
    unavailable("");
  }
}

/* ---------- tabs ---------- */

function setupTabs() {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = tabs.map((t) => el(t.getAttribute("aria-controls")));

  function activate(tab, { focus = true, updateHash = true } = {}) {
    tabs.forEach((t, i) => {
      const selected = t === tab;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
      panels[i].hidden = !selected;
    });
    if (focus) tab.focus({ preventScroll: true });
    if (updateHash) history.replaceState(null, "", `#${tab.getAttribute("aria-controls")}`);
    // On narrow screens the tab bar scrolls — keep the selected pill centered
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    tab.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest", inline: "center" });
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      activate(tab);
    });
    tab.addEventListener("keydown", (e) => {
      const idx = tabs.indexOf(tab);
      let next = null;
      if (e.key === "ArrowRight") next = tabs[(idx + 1) % tabs.length];
      else if (e.key === "ArrowLeft") next = tabs[(idx - 1 + tabs.length) % tabs.length];
      else if (e.key === "Home") next = tabs[0];
      else if (e.key === "End") next = tabs[tabs.length - 1];
      if (next) {
        e.preventDefault();
        activate(next);
      }
    });
  });

  // Deep link: #outages opens the Power tab, etc. — on load and on back/forward
  function syncFromHash() {
    const fromHash = tabs.find((t) => `#${t.getAttribute("aria-controls")}` === location.hash);
    if (fromHash) activate(fromHash, { focus: false, updateHash: false });
  }
  window.addEventListener("hashchange", syncFromHash);
  syncFromHash();
}

/* ---------- climate water-level slider ---------- */

function setupWaterSlider() {
  const slider = el("water-level");
  const valueEl = el("water-level-value");
  const iframe = el("climate-map");
  if (!slider || !iframe) return;

  slider.addEventListener("input", () => {
    valueEl.textContent = `${slider.value} ${slider.value === "1" ? "foot" : "feet"}`;
  });
  // Only reload the map when the user lets go of the slider
  slider.addEventListener("change", () => {
    if (!iframe.src || iframe.src === "about:blank") return;
    const url = new URL(iframe.src);
    url.searchParams.set("water_level", `${slider.value}.0`);
    iframe.src = url.toString();
  });
}

/* ---------- fill static page text from town.json ---------- */

function renderLinkList(id, items) {
  const list = el(id);
  if (!list) return;
  list.innerHTML = (Array.isArray(items) ? items : []).map((r) => {
    const url = safeUrl(r && r.url);
    if (!url) return ""; // a link we can't verify is safe is not shown
    return `
    <li>
      <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.title)} ↗</a>
      <p>${escapeHtml(r.description)}</p>
    </li>`;
  }).join("");
}

/* Run one part of the page setup; a failure in one part must not take the others down. */
function safely(name, fn, problems) {
  try {
    fn();
  } catch (err) {
    console.error(`Setting up "${name}" failed:`, err);
    if (problems) problems.push(name);
  }
}

function applyHubPage() {
  const problems = [];
  const { site, location: loc, nws } = TOWN;
  const marine = feature(TOWN, "marine");

  safely("features and text", () => {
    applyFeatures(TOWN);
    applyBindings(TOWN);
    document.title = `${site.name} — ${marine ? "Weather, Power & Coast" : "Weather & Power"}`;
    const desc = document.querySelector('meta[name="description"]');
    if (desc && site.description) desc.setAttribute("content", site.description);
  }, problems);

  safely("canonical URL", () => {
    const url = safeUrl(site.public_url);
    if (!url) return;
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) { link = document.createElement("link"); link.rel = "canonical"; document.head.append(link); }
    link.href = url;
  }, problems);

  const lat = num(loc.lat);
  const lon = num(loc.lon);

  safely("radar", () => {
    const radar = el("radar-img");
    const station = ident(nws.radar_station, SHAPES.radar);
    if (radar && station) {
      radar.src = `https://radar.weather.gov/ridge/standard/${station}_loop.gif`;
      radar.alt = `Animated weather radar loop from ${nws.radar_name || "the National Weather Service"}. The loop shows recent rain, snow and storm movement over the area.`;
    } else if (radar) {
      radar.closest("figure")?.remove();
    }
  }, problems);

  safely("forecast link", () => {
    const link = el("forecast-link");
    if (link && lat !== null && lon !== null) link.href = `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}`;
  }, problems);

  if (marine) {
    safely("marine links and map", () => {
      const zone = ident(nws.marine_zone, SHAPES.marineZone);
      const marineLink = el("marine-link");
      if (marineLink) {
        if (zone) marineLink.href = `https://forecast.weather.gov/shmrn.php?mz=${zone.toLowerCase()}`;
        else marineLink.remove();
      }
      const tideLink = el("tide-table-link");
      if (tideLink) tideLink.href = tideTableUrl();

      const windy = el("windy-map");
      if (windy && lat !== null && lon !== null) {
        const zoom = num(loc.map_zoom) ?? 9;
        windy.title = `Interactive wind and wave map centered on ${site.place}, from Windy.com`;
        windy.src = `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lon}&detailLat=${lat}&detailLon=${lon}&zoom=${zoom}&level=surface&overlay=waves&product=ecmwf&menu=&message=true&marker=true&calendar=now&type=map&location=coordinates&metricWind=mph&metricTemp=%C2%B0F`;
      }
    }, problems);
  }

  if (feature(TOWN, "climate_coastal")) {
    safely("climate map", () => {
      const climate = el("climate-map");
      if (climate && lat !== null && lon !== null) {
        const level = num(Number(el("water-level")?.value)) ?? 3;
        climate.title = `Coastal flood risk map of ${site.place} from Climate Central, highlighting areas below the selected water level`;
        climate.src = `https://coastal.climatecentral.org/embed/map/12/${lon}/${lat}/?theme=water_level&map_type=water_level_above_mhhw&basemap=roadmap&contiguous=true&elevation_model=best_available&refresh=true&water_level=${level}.0&water_unit=ft`;
      }
    }, problems);
  }

  safely("wildfire map", () => {
    const fire = TOWN.fire || {};
    const frame = el("fire-map");
    const url = safeUrl(fire.map_url);
    if (fire.embed === false || !url) {
      // No embeddable map (the agency may block framing): show only the full-screen link, if there is one
      el("fire-embed")?.remove();
      el("fire-legend")?.remove();
    } else if (frame) {
      frame.src = url;
      if (fire.map_title) frame.title = fire.map_title;
    }
  }, problems);

  safely("drought map", () => {
    const drought = TOWN.drought || {};
    const img = el("drought-img");
    const url = safeUrl(drought.image_url);
    if (img && url) {
      img.src = url;
      if (drought.image_alt) img.alt = drought.image_alt;
    } else if (img) {
      img.closest("figure")?.remove();
    }
  }, problems);

  safely("resource lists", () => {
    const resources = TOWN.resources || {};
    renderLinkList("resources-flood", resources.flood);
    renderLinkList("resources-drought", resources.drought);
    renderLinkList("resources-pests", resources.pests);
  }, problems);

  return problems;
}

/* ---------- boot (skipped when running under Node for tests) ---------- */

/* A message nobody can miss, for when the page cannot start at all. */
function showBootError(message) {
  console.error(message);
  const box = document.createElement("div");
  box.className = "boot-error";
  box.setAttribute("role", "alert");
  const strong = document.createElement("strong");
  strong.textContent = "This page can't start.";
  const p = document.createElement("p");
  p.textContent = `${message} If you run this site, fix town.json (run "npm run check-config" to see what is missing).`;
  box.append(strong, p);
  document.body.prepend(box);
  document.querySelectorAll(".tile-value.skeleton").forEach((n) => { n.classList.remove("skeleton"); n.textContent = "Unavailable"; });
  document.querySelectorAll(".skeleton-block").forEach((n) => n.remove());
}

// Resolves to true once town.json is loaded and applied (false if the page could not start);
// pests.js waits on this too. Never rejects.
const townReady = typeof document !== "undefined" ? bootHub() : null;

async function bootHub() {
  try {
    let res;
    try {
      res = await fetch("town.json", { cache: "no-cache" });
    } catch (err) {
      throw new Error(`town.json could not be loaded (${err.message}).`);
    }
    if (!res.ok) throw new Error(`town.json could not be loaded (HTTP ${res.status}).`);
    let town;
    try {
      town = await res.json();
    } catch (err) {
      throw new Error(`town.json is not valid JSON (${err.message}).`);
    }
    const problem = findConfigProblem(town);
    if (problem) throw new Error(problem);
    setTown(town);
  } catch (err) {
    showBootError(err.message);
    return false;
  }

  applyHubPage();
  safely("tabs", setupTabs);
  safely("water slider", setupWaterSlider);
  const marine = feature(TOWN, "marine");
  const run = (name, fn) => safely(name, () => { Promise.resolve(fn()).catch((err) => console.error(`${name}:`, err)); });
  run("alerts", loadAlerts);
  run("forecast", loadForecast);
  if (marine) run("marine forecast", loadMarineForecast);
  run("outages", loadOutages);
  if (feature(TOWN, "tides")) run("tides", loadTides);

  const lastUpdated = el("last-updated");
  if (lastUpdated) lastUpdated.textContent = `Page loaded: ${new Date().toLocaleString()}`;
  return true;
}

/* Allow Node-based tests to import the helpers */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    setTown, nwsUrls, hazardLevel, hazardTag, localMeaning, isStormAlert, seasHeadline, extractZoneSection, parseMarinePeriods,
    parseMarineDetail, compressSeas, compressWind, compressWaves, windArrow, checkOutageData, findConfigProblem,
    tideStation, tideTableUrl,
  };
}
