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

  /* "tel:+15551230100" for a plausible phone number, else null. */
  function telHref(v) {
    if (typeof v !== "string" || isTodo(v)) return null;
    const digits = v.replace(/[^\d+]/g, "");
    return /^\+?\d{7,15}$/.test(digits) ? `tel:${digits}` : null;
  }

  /* The value if it matches the identifier shape, else null. */
  function ident(v, shape) {
    return typeof v === "string" && shape.test(v) ? v : null;
  }

  function getPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  }

  /*
   * Optional sections. Everything is on unless town.json says `"features": { "x": false }`.
   * Tides live inside the marine tab, so turning marine off turns tides off too.
   */
  function feature(town, name) {
    const f = town && town.features && typeof town.features === "object" ? town.features : {};
    if (name === "tides" && f.marine === false) return false;
    return f[name] !== false;
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

  const api = { SHAPES, isTodo, escapeHtml, num, safeUrl, telHref, ident, getPath, feature, applyFeatures, applyBindings };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
