/*
 * Shared helpers for index.html and fridge-card.html (and the Node tests).
 * Everything that turns town.json or remote data into markup or a URL goes through here, so the
 * safety rules live in one place:
 *   - safeUrl():  only https: links are ever put in href / src / iframe src
 *   - telHref():  a tel: link only for a real phone number (never for a TODO placeholder)
 *   - ident():    NWS / NOAA identifiers must match their documented shape before use in a URL
 *   - escapeHtml(), num(): for text and numbers that end up inside innerHTML
 *   - feature():  turns optional sections (marine, tides, ...) on and off from town.json
 */
const TownUtils = (() => {
  const SHAPES = {
    office: /^[A-Z]{3}$/,
    radar: /^[A-Z]{4}$/,
    alertsZone: /^[A-Z]{2}[ZC]\d{3}$/,
    marineZone: /^[A-Z]{2}Z\d{3}$/,
    tideStation: /^[A-Za-z0-9]{1,12}$/,
  };

  /* The convention for "I could not verify this": a string that starts with TODO. */
  function isTodo(v) {
    return typeof v === "string" && /^\s*TODO\b/i.test(v);
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* A finite number, or null. Strings are rejected on purpose: remote JSON that sends "5" or markup where a number belongs is treated as bad data. */
  function num(v) {
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }

  /* An https: URL (normalised), or null for anything else: javascript:, data:, http:, TODO, junk. */
  function safeUrl(u) {
    if (typeof u !== "string" || isTodo(u)) return null;
    try {
      const url = new URL(u.trim());
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  /*
   * "tel:18005550100" only when the whole string is ONE plain U.S./Canada phone number (10 or 11 digits,
   * with optional spaces, dots, dashes, parentheses and a leading + or 1). Anything with extra text or
   * extra digits ("911 or 555-0100", "555-123-0100 ext. 12", two numbers) returns null, so the page
   * shows the text but never dials a guess.
   */
  function telHref(v) {
    if (typeof v !== "string" || isTodo(v)) return null;
    if (!/^\s*\+?1?[\s.\-]*\(?\d{3}\)?[\s.\-]*\d{3}[\s.\-]*\d{4}\s*$/.test(v)) return null;
    const digits = v.replace(/\D/g, "");
    return digits.length === 10 || (digits.length === 11 && digits[0] === "1") ? `tel:${digits}` : null;
  }

  /* The value if it matches the identifier shape, else null. */
  function ident(v, shape) {
    return typeof v === "string" && shape.test(v) ? v : null;
  }

  /*
   * Utility timestamps look like "2030-06-01 07:25:00": local time with NO zone. Interpret them in the
   * town's IANA time zone (location.timezone) and return epoch milliseconds, or null when that can't be
   * done reliably (unrecognised format, missing or invalid zone). null means "unverifiable": the caller
   * must not present the data as current. An explicit Z or +hh:mm offset in the text is honoured.
   */
  function parseLocalTime(value, timeZone) {
    if (typeof value !== "string") return null;
    const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/i);
    if (!m) return null;
    const [, y, mo, d, h, mi, s = "0", zone] = m;
    const naive = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
    const check = new Date(naive);
    // Date.UTC silently rolls over impossible dates (month 13, 25:00); reject them
    if (Number.isNaN(naive) || check.getUTCMonth() !== +mo - 1 || check.getUTCDate() !== +d || check.getUTCHours() !== +h) return null;
    if (zone) {
      if (/z/i.test(zone)) return naive;
      const digits = zone.slice(1).replace(":", "");
      const minutes = (zone[0] === "-" ? -1 : 1) * (+digits.slice(0, 2) * 60 + +digits.slice(2, 4));
      return naive - minutes * 60000;
    }
    if (typeof timeZone !== "string" || !timeZone.trim()) return null;
    try {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
      const offsetAt = (utc) => {
        const p = Object.fromEntries(fmt.formatToParts(new Date(utc)).map((x) => [x.type, x.value]));
        return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utc;
      };
      // two passes settle the offset around daylight-saving changes
      const guess = naive - offsetAt(naive);
      return naive - offsetAt(guess);
    } catch {
      return null; // not a valid IANA zone name
    }
  }

  /* The path if it is a plain file inside data/ (data/outages.json), else null. */
  function safeDataFile(v) {
    if (typeof v !== "string" || !/^data\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(v)) return null;
    return v.split("/").some((seg) => seg === "." || seg === "..") ? null : v;
  }

  function getPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  }

  /*
   * Optional sections. Everything is on unless town.json says `"features": { "x": false }`.
   * Tides live inside the marine tab, so turning marine off turns tides off too.
   */
  const OFF_VALUES = new Set(["false", "0", "no", "off"]);
  const isOff = (v) => v === false || v === 0 || (typeof v === "string" && OFF_VALUES.has(v.trim().toLowerCase()));

  function feature(town, name) {
    const f = town && town.features && typeof town.features === "object" ? town.features : {};
    if (name === "tides" && isOff(f.marine)) return false;
    return !isOff(f[name]);
  }

  /* Remove every element marked data-feature="a b" whose feature is off. */
  function applyFeatures(town, doc = document) {
    doc.querySelectorAll("[data-feature]").forEach((n) => {
      const names = n.dataset.feature.split(/\s+/).filter(Boolean);
      if (names.some((name) => !feature(town, name))) n.remove();
    });
  }

  /*
   * Markup hooks used in index.html / fridge-card.html:
   *   data-town="site.place"                 -> element text ("TODO..." phone numbers read "TODO: add number")
   *   data-town-href="outages.map_url"       -> href, only if it is a safe https: URL (else the link is hidden)
   *   data-town-tel="outages.phone_dial"     -> href="tel:<value>", only for a real number
   */
  function applyBindings(town, doc = document) {
    doc.querySelectorAll("[data-town]").forEach((n) => {
      const path = n.dataset.town;
      const v = getPath(town, path);
      if (v == null) return;
      n.textContent = isTodo(v) && /phone|number/.test(path) ? "TODO: add number" : String(v);
    });
    doc.querySelectorAll("[data-town-href]").forEach((n) => {
      const url = safeUrl(getPath(town, n.dataset.townHref));
      if (url) n.setAttribute("href", url);
      else { n.removeAttribute("href"); n.hidden = true; }
    });
    doc.querySelectorAll("[data-town-tel]").forEach((n) => {
      const href = telHref(getPath(town, n.dataset.townTel));
      if (href) n.setAttribute("href", href);
      else { n.removeAttribute("href"); n.classList.add("is-todo"); n.setAttribute("aria-disabled", "true"); }
    });
  }

  const api = { SHAPES, isTodo, isOff, parseLocalTime, safeDataFile, escapeHtml, num, safeUrl, telHref, ident, getPath, feature, applyFeatures, applyBindings };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
