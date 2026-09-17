// Radar QPE legend: the NWS RFC QPE service's own color classes (fetched from its legend endpoint, so they always
// match the tiles) plus the valid/issued time of the mosaic currently shown, so it is clear how old the estimate is.
import { $, escapeHtml } from "./util.js";
import { ENDPOINTS, QPE_LAYERS } from "./config.js";

const cache = {};
// NWS RFC QPE color classes (inches), as served by the service's legend endpoint on 2026-09-17 (colors sampled from
// its swatches). Embedded so the legend never depends on that 400 KB endpoint; the tiles use the same renderer.
const QPE_CLASSES = [["\u2265 10", "#dcdcdc"], ["8 to 10", "#7d4be1"], ["6 to 8", "#fa00fa"], ["5 to 6", "#7d0000"], ["4 to 5", "#af0000"], ["3 to 4", "#fa0000"], ["2.5 to 3", "#fa9600"], ["2 to 2.5", "#ffd966"], ["1.5 to 2", "#fafa00"], ["1 to 1.5", "#00640a"], ["0.75 to 1", "#00a00f"], ["0.5 to 0.75", "#00fa14"], ["0.25 to 0.5", "#001432"], ["0.1 to 0.25", "#3d85c6"], ["0.01 to 0.1", "#14c8fa"], ["< 0.01", "transparent"]];
async function validTime(win) {
  const fp = (QPE_LAYERS[win] ?? QPE_LAYERS["24h"]) + 2; // "Footprint" sublayer carries the mosaic's issue date
  const key = `t${fp}`; const now = Date.now();
  if (!cache[key] || now - cache[key].at > 5 * 60 * 1000) {
    cache[key] = { at: now, p: fetch(`${ENDPOINTS.rfcQpe}/${fp}/query?where=1%3D1&outFields=idp_issueddate,idp_ingestdate&orderByFields=idp_issueddate%20DESC&resultRecordCount=1&returnGeometry=false&f=json`).then((r) => r.json()).then((d) => d.features?.[0]?.attributes || null).catch(() => null) };
  }
  return cache[key].p;
}
// NWS/RIDGE base reflectivity color scale (dBZ) with the usual rain-rate reading
const DBZ = [[5, "#04e9e7"], [10, "#019ff4"], [15, "#0300f4"], [20, "#02fd02"], [25, "#01c501"], [30, "#008e00"], [35, "#fdf802"], [40, "#e5bc00"], [45, "#fd9500"], [50, "#fd0000"], [55, "#d40000"], [60, "#bc0000"], [65, "#f800fd"], [70, "#9854c6"], [75, "#fdfdfd"]];
const DBZ_NOTE = (d) => d < 20 ? "drizzle / light" : d < 35 ? "light–moderate rain" : d < 50 ? "heavy rain" : d < 65 ? "very heavy, hail possible" : "extreme, hail";
async function liveValidTime() {
  const now = Date.now();
  if (!cache.live || now - cache.live.at > 60 * 1000) {
    cache.live = { at: now, p: fetch(`${ENDPOINTS.radarRefl}/2/query?where=idp_subset%3D%27CONUS%27&outFields=idp_validtime&orderByFields=idp_validtime%20DESC&resultRecordCount=1&returnGeometry=false&f=json`).then((r) => r.json()).then((d) => d.features?.[0]?.attributes?.idp_validtime || null).catch(() => null) };
  }
  return cache.live.p;
}
async function renderLiveLegend(el) {
  const t = await liveValidTime(); if (!$("qpe-legend") || $("qpe-legend").dataset.win !== "live") return;
  const valid = t ? new Date(t) : null; const ageMin = valid ? Math.round((Date.now() - valid) / 60000) : null;
  const stale = ageMin != null && ageMin > 20;
  el.innerHTML = `<div class="small">Radar echoes <b>right now</b> (NWS MRMS 1 km base reflectivity, the same mosaic as radar.weather.gov). Not a rain total: pick a window above for inches.</div>
    <div class="qpe-grid">${DBZ.map(([d, c]) => `<div class="qpe-row"><span class="swatch sq" style="background:${c};width:14px;height:14px;border-radius:2px"></span><span>${d} dBZ${d % 15 === 5 ? ` · ${DBZ_NOTE(d)}` : ""}</span></div>`).join("")}</div>
    <div class="small ${stale ? "warn" : ""}">Mosaic time <b>${valid ? escapeHtml(valid.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) + ` (${ageMin} min ago)` : "unknown"}</b>${stale ? " · older than usual, the NWS feed may be delayed" : ""}. Re-pulled every 3 minutes while the page is open; typical lag 2–6 min.</div>`;
}
export async function renderQpeLegend(win, label) {
  const el = $("qpe-legend"); if (!el) return;
  if (win === "live") return renderLiveLegend(el);
  const t = await validTime(win);
  if (!$("qpe-legend") || $("qpe-legend").dataset.win !== win) return; // legend was rebuilt for another window meanwhile
  const issued = t?.idp_issueddate ? new Date(t.idp_issueddate) : null;
  const ageMin = issued ? Math.round((Date.now() - issued) / 60000) : null;
  const when = issued ? `${issued.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })} (${ageMin < 90 ? `${ageMin} min ago` : `${(ageMin / 60).toFixed(1)} h ago`})` : "unknown";
  const stale = ageMin != null && ageMin > 180;
  const rows = QPE_CLASSES.map(([label, c]) => `<div class="qpe-row"><span class="swatch sq" style="background:${c};width:14px;height:14px;border-radius:2px;${c === "transparent" ? "border:1px solid #555" : ""}"></span><span>${escapeHtml(label)}</span></div>`).join("");
  el.innerHTML = `<div class="small">Inches of rain <b>${escapeHtml(label)}</b>, ending at the last hourly analysis. Not live echoes: pick "Now (reflectivity)" above for the radar picture.</div>
    <div class="qpe-grid">${rows}</div>
    <div class="small ${stale ? "warn" : ""}">Estimate valid through <b>${escapeHtml(when)}</b>${stale ? " \u00b7 older than usual, the NWS feed may be delayed" : ""}. Multi-sensor (radar + gauges + satellite), 4 km grid, updated hourly and typically 1\u20132 h behind real time; totals are revised for a day or two as gauge reports arrive.</div>`;
}
