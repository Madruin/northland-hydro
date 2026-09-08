// Observed-precipitation station layer (CoCoRaHS + COOP + ASOS via RCC-ACIS) and its legend.
import { PRECIP_BINS, PRECIP_MISSING_COLOR, REGION_BBOX } from "./config.js";
import { windowTotals } from "./api/acis.js";
import { setStations } from "./map.js";
import { $, escapeHtml, fmt, fmtDate, addDays, emit } from "./util.js";

export let stations = [];      // last loaded station list (with totals)
export let current = { endDate: null, days: 1 };

export function colorFor(total, missingAll) {
  if (missingAll || total == null) return PRECIP_MISSING_COLOR;
  for (const b of PRECIP_BINS) if (total <= b.max) return b.color;
  return PRECIP_BINS[PRECIP_BINS.length - 1].color;
}

const CACHE_KEY = (endDate, days) => `nh-precip-${endDate}-${days}`;
function finalize(list, endDate, days, stale) {
  const startDate = addDays(endDate, -(days - 1));
  stations = list.map((s) => {
    const missingAll = s.total == null || s.missing >= days;
    const partial = !missingAll && s.missing > 0;
    return { ...s, missingAll, partial, color: colorFor(s.total, missingAll), startDate };
  }).sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
  setStations(toFeatureCollection(stations, days));
  emit("precip:loaded", { stations, endDate, days, stale });
  return stations;
}
// Shows the last cached result for this window immediately (if any), then replaces it with fresh data.
export async function loadPrecip({ endDate, days }) {
  current = { endDate, days };
  try { const c = JSON.parse(localStorage.getItem(CACHE_KEY(endDate, days)) || "null"); if (c && Date.now() - c.t < 3 * 86400e3) finalize(c.list, endDate, days, true); } catch {}
  const list = await windowTotals({ bbox: REGION_BBOX, endDate, days });
  if (current.endDate !== endDate || current.days !== days) return stations; // superseded by a newer request
  try { localStorage.setItem(CACHE_KEY(endDate, days), JSON.stringify({ t: Date.now(), list })); pruneCache(); } catch {}
  return finalize(list, endDate, days, false);
}
function pruneCache() {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("nh-precip-"));
  if (keys.length > 6) keys.map((k) => ({ k, t: JSON.parse(localStorage.getItem(k) || "{}").t || 0 })).sort((a, b) => a.t - b.t).slice(0, keys.length - 6).forEach(({ k }) => localStorage.removeItem(k));
}

function toFeatureCollection(list, days) {
  return {
    type: "FeatureCollection",
    features: list.map((s) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: {
        kind: "station", sid: s.sid, name: s.name, network: s.network, color: s.color, missing: s.missingAll,
        total: s.total, label: s.missingAll ? "" : s.total === 0 && s.totalFlag === "T" ? "T" : fmt(s.total),
        popup: popupHtml(s, days),
      },
    })),
  };
}

function popupHtml(s, days) {
  const val = s.missingAll ? "no report" : (s.total === 0 && s.totalFlag === "T" ? "Trace" : `${fmt(s.total)}"`);
  const pctN = days >= 7 && s.normal ? Math.round((100 * s.total) / s.normal) : null;
  return `<div class="popup-title">${escapeHtml(s.name)}</div>
    <div class="popup-big">${val}</div>
    <div class="popup-sub">${days === 1 ? "on " + fmtDate(current.endDate) : days + "-day total ending " + fmtDate(current.endDate)}
    ${s.partial ? ` · ${s.missing} day${s.missing > 1 ? "s" : ""} missing` : ""}
    ${pctN != null ? ` · ${pctN}% of normal` : ""}</div>
    <div class="popup-sub">${escapeHtml(s.network)} · ${escapeHtml(s.ids["10"] ? "CoCoRaHS " + s.ids["10"] : s.sid)}${s.max1 != null && days > 1 ? ` · max 1-day ${fmt(s.max1)}" (${s.max1Date ? fmtDate(s.max1Date) : ""})` : ""}</div>`;
}

export function renderPrecipLegend(container, { days }) {
  const rows = PRECIP_BINS.map((b) => `<div class="legend-row"><span class="swatch" style="background:${b.color}"></span>${b.label}</div>`).join("");
  container.innerHTML = `<h4>Precipitation, in (${days === 1 ? "1 day" : days + " days"})</h4>${rows}
    <div class="legend-row"><span class="swatch" style="background:${PRECIP_MISSING_COLOR};opacity:.5"></span>No report</div>`;
}

export function summarize(list) {
  const reporting = list.filter((s) => !s.missingAll);
  const totals = reporting.map((s) => s.total).sort((a, b) => a - b);
  const median = totals.length ? totals[Math.floor(totals.length / 2)] : null;
  const withNormal = current.days >= 7 ? reporting.filter((s) => s.normal && !s.partial) : [];
  const pctNormal = withNormal.length ? Math.round((100 * withNormal.reduce((a, s) => a + s.total, 0)) / withNormal.reduce((a, s) => a + s.normal, 0)) : null;
  return { n: list.length, reporting: reporting.length, median, max: totals[totals.length - 1] ?? null, pctNormal, top: reporting.slice(0, 12) };
}
