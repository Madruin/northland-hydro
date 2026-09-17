// Radar QPE legend: the NWS RFC QPE service's own color classes (fetched from its legend endpoint, so they always
// match the tiles) plus the valid/issued time of the mosaic currently shown, so it is clear how old the estimate is.
import { $, escapeHtml } from "./util.js";
import { ENDPOINTS, QPE_LAYERS } from "./config.js";

const cache = {};
async function legendClasses(win) {
  const imgLayer = (QPE_LAYERS[win] ?? QPE_LAYERS["24h"]) + 3; // mosaic layer → its "Image" sublayer
  if (!cache.legend) cache.legend = fetch(`${ENDPOINTS.rfcQpe}/legend?f=json`).then((r) => r.json()).then((d) => d.layers);
  const layers = await cache.legend;
  return (layers.find((l) => l.layerId === imgLayer)?.legend || []).filter((c) => !/missing/i.test(c.label));
}
async function validTime(win) {
  const fp = (QPE_LAYERS[win] ?? QPE_LAYERS["24h"]) + 2; // "Footprint" sublayer carries the mosaic's issue date
  const key = `t${fp}`; const now = Date.now();
  if (!cache[key] || now - cache[key].at > 5 * 60 * 1000) {
    cache[key] = { at: now, p: fetch(`${ENDPOINTS.rfcQpe}/${fp}/query?where=1%3D1&outFields=idp_issueddate,idp_ingestdate&orderByFields=idp_issueddate%20DESC&resultRecordCount=1&returnGeometry=false&f=json`).then((r) => r.json()).then((d) => d.features?.[0]?.attributes || null).catch(() => null) };
  }
  return cache[key].p;
}
export async function renderQpeLegend(win, label) {
  const el = $("qpe-legend"); if (!el) return;
  const [classes, t] = await Promise.all([legendClasses(win).catch(() => []), validTime(win)]);
  if (!$("qpe-legend") || $("qpe-legend").dataset.win !== win) return; // legend was rebuilt for another window meanwhile
  const issued = t?.idp_issueddate ? new Date(t.idp_issueddate) : null;
  const ageMin = issued ? Math.round((Date.now() - issued) / 60000) : null;
  const when = issued ? `${issued.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })} (${ageMin < 90 ? `${ageMin} min ago` : `${(ageMin / 60).toFixed(1)} h ago`})` : "unknown";
  const stale = ageMin != null && ageMin > 180;
  const rows = classes.map((c) => `<div class="qpe-row"><img src="data:${c.contentType};base64,${c.imageData}" width="14" height="14" alt=""><span>${escapeHtml(c.label.replace(/\s+/g, " ").replace("Greater than or equal to", "≥").replace("Less than", "<"))}</span></div>`).join("");
  el.innerHTML = `<div class="small">Inches of rain <b>${escapeHtml(label)}</b>, ending at the last hourly analysis.</div>
    <div class="qpe-grid">${rows || '<span class="small">Legend unavailable</span>'}</div>
    <div class="small ${stale ? "warn" : ""}">Estimate valid through <b>${escapeHtml(when)}</b>${stale ? " · older than usual, the NWS feed may be delayed" : ""}. Multi-sensor (radar + gauges + satellite), 4 km grid, updated hourly and typically 1–2 h behind real time; totals are revised for a day or two as gauge reports arrive.</div>`;
}
