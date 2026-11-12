/*
 * Pest activity meters for the Ticks & Mosquitoes page.
 * Estimates are computed from the NWS hourly forecast for the configured town
 * (temperature, humidity, wind) plus time of year. They are weather-based
 * planning signals, NOT surveillance measurements — see the methodology
 * section on the page for validation notes and limitations.
 */

const PEST_LEVELS = [
  { max: 0.25, label: "Low" },
  { max: 0.5, label: "Moderate" },
  { max: 0.75, label: "High" },
  { max: Infinity, label: "Very High" },
];

function pestLevel(score) {
  return PEST_LEVELS.find((l) => score < l.max);
}

function parseWindMph(s) {
  const m = (s || "").match(/(\d+)(?:\s+to\s+(\d+))?\s*mph/);
  return m ? +(m[2] || m[1]) : 8;
}

function avg(list) {
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function mosquitoSeason(month) {
  if (month >= 5 && month <= 7) return 1;      // Jun–Aug
  if (month === 4 || month === 8) return 0.8;  // May, Sep
  if (month === 3 || month === 9) return 0.35; // Apr, Oct
  return 0.05;
}

function tickSeason(month) {
  if (month >= 3 && month <= 6) return 1;       // Apr–Jul (nymph peak)
  if (month === 9 || month === 10) return 0.85; // Oct–Nov (adults)
  if (month === 7 || month === 8) return 0.65;  // Aug–Sep
  if (month === 2) return 0.45;                 // Mar
  return 0.25;                                  // winter thaw days
}

/* Pure scoring functions — hours: [{hour, temp, rh, wind, day}], month: 0-11 */

/*
 * Both scores are multiplicative: temperature sets the ceiling, and
 * humidity/wind scale it down. (An additive model was tried first and
 * failed validation — a hot but dry, windy day scored "High" for
 * mosquitoes when it should read Low/Moderate.)
 */

function mosquitoScore(hours, month) {
  const duskHours = hours.filter((h) => h.hour >= 17 && h.hour <= 22);
  const mHours = duskHours.length >= 3 ? duskHours : hours;
  return mosquitoSeason(month) * avg(mHours.map((h) => {
    const t = h.temp < 50 ? 0 : h.temp < 57 ? 0.3 : h.temp < 65 ? 0.7 : h.temp <= 90 ? 1 : 0.6;
    const rh = h.rh >= 75 ? 1 : h.rh >= 60 ? 0.75 : h.rh >= 45 ? 0.45 : 0.2;
    const w = h.wind < 6 ? 1 : h.wind < 11 ? 0.7 : h.wind < 16 ? 0.35 : 0.1;
    return t * (0.55 + 0.45 * rh) * (0.5 + 0.5 * w);
  }));
}

function tickScore(hours, month) {
  const dayHours = hours.filter((h) => h.day);
  const tHours = dayHours.length >= 3 ? dayHours : hours;
  const maxTemp = Math.max(...tHours.map((h) => h.temp));
  if (maxTemp < 40) return 0.05;
  return tickSeason(month) * avg(tHours.map((h) => {
    let t = h.temp < 40 ? 0 : h.temp < 46 ? 0.35 : h.temp < 58 ? 0.75 : h.temp <= 85 ? 1 : 0.7;
    if (h.temp > 78 && h.rh < 45) t = Math.min(t, 0.6); // hot + dry suppresses questing
    const rh = h.rh >= 60 ? 1 : h.rh >= 45 ? 0.6 : 0.35;
    return t * (0.35 + 0.65 * rh);
  }));
}

function mosquitoWhy(score, month) {
  if (score >= 0.75) return "Warm, humid, and still — prime mosquito weather, especially at dusk.";
  if (score >= 0.5) return "Decent mosquito conditions this evening — repellent is worth it.";
  if (score >= 0.25) return "Some activity possible around dusk, but conditions aren't ideal for them.";
  if (month >= 4 && month <= 9) return "Cool, dry, or breezy conditions are keeping mosquitoes down today.";
  return "Too cold for mosquito activity this time of year.";
}

function tickWhy(score, maxTemp) {
  if (maxTemp < 40) return "Below 40°F — ticks are mostly inactive today.";
  if (score >= 0.75) return "Mild and humid — ticks are questing. Check yourself and pets after yard work or trails.";
  if (score >= 0.5) return "Good tick conditions — do a tick check after time in grass or brush.";
  if (score >= 0.25) return "Some tick activity possible — worth a check after being outside.";
  return "Conditions are keeping tick activity low today.";
}

/* ---------- browser rendering (skipped when running under Node for tests) ---------- */

if (typeof document !== "undefined") {
  // townReady comes from app.js (loaded first); the forecast URL depends on town.json
  townReady.then((ok) => { if (ok && document.getElementById("meter-mosquito")) return loadPestMeters(); }).catch((err) => console.error(err));
}

async function loadPestMeters() {
  try {
    const res = await fetch(nwsUrls().hourly, { headers: { Accept: "application/geo+json" } });
    if (!res.ok) throw new Error(`Hourly forecast failed: ${res.status}`);
    const data = await res.json();
    const periods = (data.properties?.periods || []).map((p) => {
      const start = new Date(p.startTime);
      return {
        date: start.toDateString(),
        weekday: start.toLocaleDateString(undefined, { weekday: "short" }),
        hour: start.getHours(),
        temp: typeof p.temperature === "number" ? p.temperature : NaN,
        rh: typeof p.relativeHumidity?.value === "number" ? p.relativeHumidity.value : 60,
        wind: parseWindMph(p.windSpeed),
        day: p.isDaytime,
      };
    });
    if (!periods.length) throw new Error("No hourly data");
    const month = new Date().getMonth();

    // Bucket hours into the next 3 calendar days
    const dayKeys = [...new Set(periods.map((p) => p.date))].slice(0, 3);
    const days = dayKeys.map((key, i) => {
      const hours = periods.filter((p) => p.date === key);
      return {
        label: i === 0 ? "Today" : hours[0].weekday,
        mosquito: mosquitoScore(hours, month),
        tick: tickScore(hours, month),
        maxTemp: Math.max(...hours.filter((h) => h.day).map((h) => h.temp), -99),
      };
    });

    const today = days[0];
    renderPestMeter("meter-mosquito", today.mosquito, mosquitoWhy(today.mosquito, month));
    renderPestMeter("meter-tick", today.tick, tickWhy(today.tick, today.maxTemp));
    renderPestDays("meter-mosquito", days, "mosquito");
    renderPestDays("meter-tick", days, "tick");
  } catch (err) {
    console.error(err);
    for (const id of ["meter-mosquito", "meter-tick"]) {
      const m = document.getElementById(id);
      if (!m) continue;
      const lvl = m.querySelector(".meter-level");
      lvl.classList.remove("skeleton");
      lvl.textContent = "Unavailable";
      m.querySelector(".meter-why").textContent = "Couldn't load today's forecast data.";
    }
  }
}

function renderPestDays(id, days, key) {
  const holder = document.querySelector(`#${id} .meter-days`);
  if (!holder) return;
  holder.innerHTML = days.map((d) => {
    const level = pestLevel(d[key]);
    return `
      <div class="meter-day" data-level="${level.label.toLowerCase().replace(" ", "-")}">
        <span class="meter-day-name">${escapeHtml(d.label)}</span>
        <span class="meter-day-level">${escapeHtml(level.label)}</span>
      </div>`;
  }).join("");
}

function renderPestMeter(id, score, why) {
  const meter = document.getElementById(id);
  if (!meter) return;
  const level = pestLevel(score);
  const lvlEl = meter.querySelector(".meter-level");
  lvlEl.classList.remove("skeleton");
  lvlEl.textContent = level.label;
  meter.dataset.level = level.label.toLowerCase().replace(" ", "-");
  meter.querySelector(".meter-dot").style.left = `${Math.round(Math.min(0.98, Math.max(0.02, score)) * 100)}%`;
  meter.querySelector(".meter-why").textContent = why;
}

/* Allow Node-based tests to import the scoring functions */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { mosquitoScore, tickScore, pestLevel, mosquitoSeason, tickSeason };
}
