// WLSSD (Western Lake Superior Sanitary District) rain gauges around Duluth. The source page has no CORS and no
// https, so a scheduled GitHub Action (tools/harvest_wlssd.py) snapshots it into data/wlssd.json, which this reads.
import { $, escapeHtml, fmt, on, addDays } from "./util.js";
import { setOverlay } from "./map.js";
import { colorFor, current as precipWindow } from "./precip.js";

let doc = null;
export async function loadWlssd() {
  try {
    const r = await fetch("data/wlssd.json", { cache: "no-cache" }); if (!r.ok) throw new Error(r.status);
    doc = await r.json();
  } catch (e) { console.warn("WLSSD snapshot unavailable", e); doc = null; }
  draw();
  return doc;
}
export function initWlssd() { on("precip:loaded", draw); loadWlssd(); }

// Window total from the daily history for the current precipitation window (WLSSD days are midnight to midnight,
// unlike the 7 am observer days of the stations, so totals can differ by a day's rain at the edges).
function windowTotal(name) {
  const w = precipWindow; if (!doc || !w?.endDate) return { total: null, missing: 0, days: 0 };
  let total = 0, missing = 0;
  for (let i = 0; i < w.days; i++) {
    const d = addDays(w.endDate, -i); const v = doc.history?.[d]?.[name];
    if (v == null) missing++; else total += v;
  }
  return { total: missing === w.days ? null : total, missing, days: w.days };
}
function draw() {
  const feats = (doc?.gauges || []).filter((g) => g.lon != null).map((g) => {
    const wt = windowTotal(g.name);
    const p = { name: g.name, color: colorFor(wt.total, wt.total == null), today: g.today, thisHour: g.thisHour, lastHour: g.lastHour, yesterday: g.yesterday, wtotal: wt.total };
    p.popup = `<div class="popup-title">WLSSD · ${escapeHtml(g.name)}</div><div class="popup-big">${wt.total != null ? fmt(wt.total) + '"' : "–"}</div><div class="popup-sub">${wt.days}-day total${wt.missing ? ` (${wt.missing} day${wt.missing > 1 ? "s" : ""} missing)` : ""} · today ${fmt(g.today)}" · yesterday ${fmt(g.yesterday)}" · this hour ${fmt(g.thisHour)}"</div><div class="popup-sub">updated ${fmtUpd()} · location approximate</div>`;
    return { type: "Feature", geometry: { type: "Point", coordinates: [g.lon, g.lat] }, properties: p };
  });
  setOverlay("wlssd", { type: "FeatureCollection", features: feats });
  const el = $("region-wlssd"); if (el) renderWlssdSection(el);
}
const fmtUpd = () => (doc?.updated ? new Date(doc.updated).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "?");

export function renderWlssdSection(el) {
  if (!doc) { el.innerHTML = `<h3>WLSSD rain gauges · Duluth area</h3><div class="notice">WLSSD snapshot not available.</div>`; return; }
  const rows = doc.gauges.map((g) => { const wt = windowTotal(g.name); return { g, wt }; }).sort((a, b) => (b.wt.total ?? -1) - (a.wt.total ?? -1));
  const stale = Date.now() - new Date(doc.updated).getTime() > 3 * 3600e3;
  el.innerHTML = `<h3>WLSSD rain gauges · Duluth area</h3>
    <table class="data"><thead><tr><th>Gauge</th><th class="num">${precipWindow.days} d</th><th class="num">Today</th><th class="num">Yest.</th><th class="num">Last hr</th><th class="num">This hr</th></tr></thead><tbody>
      ${rows.map(({ g, wt }) => `<tr><td>${escapeHtml(g.name)}</td><td class="num">${wt.total != null ? fmt(wt.total) + (wt.missing ? "*" : "") : "–"}</td><td class="num">${g.today != null ? fmt(g.today) : "NV"}</td><td class="num">${g.yesterday != null ? fmt(g.yesterday) : "NV"}</td><td class="num">${g.lastHour != null ? fmt(g.lastHour) : "NV"}</td><td class="num">${g.thisHour != null ? fmt(g.thisHour) : "NV"}</td></tr>`).join("")}
    </tbody></table>
    <div class="small">${stale ? `<b>Stale:</b> ` : ""}WLSSD plant telemetry as of ${fmtUpd()}, snapshotted hourly from <a href="${escapeHtml(doc.source)}" target="_blank" rel="noopener">WLSSD's rainfall overview</a>. Days run midnight to midnight (station days end at 7 am), so window totals can differ from nearby CoCoRaHS gauges by a day's rain at the edges; * = days missing from the window. NV = no value reported. Gauge locations on the map are approximate.</div>`;
}
