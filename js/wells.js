// Wells and borings: Minnesota County Well Index (MGS/MDH) points with stratigraphy logs, water levels and construction,
// plus DNR Drill Core Library boring locations. Viewport layer at zoom 12+, point section, and basin depth-to-bedrock.
import { $, escapeHtml, fmt, fmtNum, debounce, haversineKm } from "./util.js";
import { map, setOverlay } from "./map.js";

const CWI = "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_health/water_well_information_non_pws/FeatureServer";
const DCL = "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/geos_boring_hole_locations/FeatureServer/0";
export const MIN_ZOOM = 12;
const WELL_FIELDS = "relateid,unique_no,wellname,elevation,elev_mc,depth_drll,depth_comp,date_drll,case_diam,case_depth,use_c,status_c,depth2bdrk,first_bdrk,last_strat,aquifer,strat_mc,strat_src,loc_mc,swl,core,cuttings,bhgeophys,data_src";
const DCL_FIELDS = "dhname,dhalias,drilldate,drillfor,totdep,azimuth,dip,z_elevft,dnrnum,mdhnum,drillmthd,drlpurpose,project,coreloc";

// Depth-to-bedrock classes (ft) → color. Grey = no interpreted stratigraphy.
export const BDRK_CLASSES = [[10, "#b91c1c", "< 10 ft"], [25, "#ea580c", "10–25 ft"], [50, "#eab308", "25–50 ft"], [100, "#16a34a", "50–100 ft"], [Infinity, "#1d4ed8", "> 100 ft"]];
const NO_BDRK = "#94a3b8";
export function bdrkColor(d) { if (d == null || isNaN(d)) return NO_BDRK; for (const [lim, c] of BDRK_CLASSES) if (d < lim) return c; return NO_BDRK; }
const STATUS = { A: "active", I: "inactive", S: "sealed", T: "temporarily sealed", U: "unknown" };
const ERA = { Q: "Quaternary (glacial/alluvial)", R: "Recent / surface", P: "Precambrian", C: "Cretaceous", O: "Ordovician", D: "Devonian", K: "Cretaceous" };

let enabled = false, lastKey = null, inflight = null;
export function initWells() { map.on("moveend", debounce(() => { if (enabled) refresh(); }, 350)); }
export function setWellsEnabled(on) { enabled = on; if (on) refresh(); else { setOverlay("wells", empty()); setOverlay("drillholes", empty()); lastKey = null; note(""); } }
const empty = () => ({ type: "FeatureCollection", features: [] });
function note(t) { const el = $("wells-note"); if (el) el.textContent = t; }

async function qgeo(base, params, fmtOut = "geojson") {
  const u = new URLSearchParams({ inSR: "4326", outSR: "4326", geometryPrecision: "6", f: fmtOut, ...params });
  const r = await fetch(`${base}/query?${u}`); if (!r.ok) throw new Error(`${r.status}`);
  const d = await r.json(); if (d.error) throw new Error(d.error.message); return d;
}
const ymd = (n) => { if (!n || n < 10000000) return null; const s = String(n); const m = s.slice(4, 6), d = s.slice(6, 8); return `${s.slice(0, 4)}${m !== "00" ? "-" + m : ""}${d !== "00" ? "-" + d : ""}`; };
const useDesc = (c) => codes?.use?.[c?.trim()] || c || "";

// ---- code tables (aquifer/strat units, lithology, use), cached 30 days ----
let codes = null, codesP = null;
async function loadCodes() {
  if (codes) return codes; if (codesP) return codesP;
  codesP = (async () => {
    try { const c = JSON.parse(localStorage.getItem("nh-cwi-codes2") || "null"); if (c && Date.now() - c.t < 30 * 86400_000) return (codes = c.v); } catch {}
    const tbl = async (id, k, v) => { const d = await qgeo(`${CWI}/${id}`, { where: "1=1", outFields: "*", returnGeometry: "false", resultRecordCount: "2000" }, "json"); return Object.fromEntries((d.features || []).map((f) => [String(f.attributes[k]).trim(), f.attributes[v]])); };
    const [aq, lith, use, loc, elev] = await Promise.all([tbl(4, "code", "aquifer_name"), tbl(36, "code", "descrptn"), tbl(58, "code", "descrptn"), tbl(33, "code", "descrptn"), tbl(23, "code", "descrptn")]);
    codes = { aq, lith, use, loc, elev };
    try { localStorage.setItem("nh-cwi-codes2", JSON.stringify({ t: Date.now(), v: codes })); } catch {}
    return codes;
  })();
  return codesP;
}
function unit(code) { if (!code) return ""; const c = code.trim(); const n = codes?.aq?.[c]; if (n) return n; return ERA[c[0]] ? `${c} (${ERA[c[0]]})` : c; }
function lith(code) { if (!code) return ""; return codes?.lith?.[code.trim()] || code; }

function decorateWell(p) {
  p.color = bdrkColor(p.depth2bdrk);
  p.popup = `<div class="popup-title">Well ${escapeHtml(String(p.unique_no || p.relateid || "").replace(/^0+/, ""))} · ${escapeHtml(useDesc(p.use_c))}${p.status_c && p.status_c !== "A" ? ` (${STATUS[p.status_c] || p.status_c})` : ""}</div><div class="popup-sub">depth ${fmt(p.depth_drll, 0)} ft · bedrock ${p.depth2bdrk != null ? `at ${fmt(p.depth2bdrk, 0)} ft` : "not interpreted"}${p.first_bdrk ? " · " + escapeHtml(unit(p.first_bdrk)) : ""}${p.aquifer ? " · aquifer " + escapeHtml(unit(p.aquifer)) : ""}</div><div class="popup-sub">drilled ${ymd(p.date_drll) || "?"}${p.elevation ? ` · surface ${fmt(p.elevation, 0)} ft` : ""} · CWI</div>`;
}
function decorateHole(p) {
  const purp = (p.drlpurpose || "").toLowerCase();
  p.color = purp.includes("explor") ? "#7c3aed" : purp.includes("engineer") ? "#0f766e" : "#0891b2";
  p.popup = `<div class="popup-title">Drill hole ${escapeHtml(p.dhname || "")} · ${escapeHtml(p.drlpurpose || "")}</div><div class="popup-sub">${escapeHtml(p.drillfor || "")} · ${p.drilldate ? new Date(p.drilldate).getFullYear() : "?"} · ${escapeHtml(p.drillmthd || "")}${p.totdep ? ` · ${fmt(p.totdep, 0)} ft` : ""}${p.dip != null && p.dip !== -90 ? ` · dip ${p.dip}°` : ""}</div><div class="popup-sub">${escapeHtml(p.coreloc || "DNR Drill Core Library")}</div>`;
}
async function refresh() {
  const z = map.getZoom(); const b = map.getBounds();
  if (z < MIN_ZOOM) { setOverlay("wells", empty()); setOverlay("drillholes", empty()); lastKey = null; note(`Wells: zoom in (${MIN_ZOOM}+) to load`); return; }
  const pad = 0.15;
  const bbox = [b.getWest() - (b.getEast() - b.getWest()) * pad, b.getSouth() - (b.getNorth() - b.getSouth()) * pad, b.getEast() + (b.getEast() - b.getWest()) * pad, b.getNorth() + (b.getNorth() - b.getSouth()) * pad];
  const key = bbox.map((v) => v.toFixed(3)).join(","); if (key === lastKey) return; lastKey = key;
  note("Wells: loading…");
  await loadCodes().catch(() => {});
  const env = { geometry: bbox.map((v) => v.toFixed(5)).join(","), geometryType: "esriGeometryEnvelope", spatialRel: "esriSpatialRelIntersects", resultRecordCount: "2000" };
  const mine = (inflight = Promise.allSettled([qgeo(`${CWI}/1`, { ...env, outFields: WELL_FIELDS }), qgeo(DCL, { ...env, outFields: DCL_FIELDS })]));
  const [wr, hr] = await mine; if (inflight !== mine || !enabled) return;
  let nw = 0, nh = 0; const errs = [];
  if (wr.status === "fulfilled") { for (const f of wr.value.features) decorateWell(f.properties); setOverlay("wells", wr.value); nw = wr.value.features.length; } else errs.push("CWI " + wr.reason?.message);
  if (hr.status === "fulfilled") { for (const f of hr.value.features) decorateHole(f.properties); setOverlay("drillholes", hr.value); nh = hr.value.features.length; } else errs.push("DNR " + hr.reason?.message);
  note(`Wells: ${nw}${nw >= 2000 ? "+ (capped, zoom in)" : ""} CWI wells, ${nh} DNR drill holes${errs.length ? " · failed: " + errs.join("; ") : ""}`);
}

export function wellsLegendHtml() {
  return `<h4>Wells &amp; borings · depth to bedrock</h4>
    ${BDRK_CLASSES.map(([, c, l]) => `<div class="legend-row"><span class="swatch" style="background:${c}"></span>${l}</div>`).join("")}
    <div class="legend-row"><span class="swatch" style="background:${NO_BDRK}"></span>no interpreted stratigraphy</div>
    <div class="legend-row"><span class="swatch sq" style="background:#7c3aed;transform:rotate(45deg);width:10px;height:10px"></span>DNR drill hole (purple exploration · teal engineering · blue scientific)</div>
    <div class="small">MN County Well Index (MGS/MDH): located wells and borings with driller logs interpreted by MGS. Loads at zoom ${MIN_ZOOM}+. <span id="wells-note"></span></div>`;
}

// ---- Point panel: nearest wells with stratigraphy logs, water levels; nearby DNR drill holes ----
export async function renderWellsAt(container, lon, lat) {
  container.innerHTML = "";
  const box = (m) => { const d = m / 111320, dx = d / Math.cos((lat * Math.PI) / 180); return { geometry: `${(lon - dx).toFixed(6)},${(lat - d).toFixed(6)},${(lon + dx).toFixed(6)},${(lat + d).toFixed(6)}`, geometryType: "esriGeometryEnvelope", spatialRel: "esriSpatialRelIntersects" }; };
  try {
    const [, wr, hr] = await Promise.all([loadCodes().catch(() => {}), qgeo(`${CWI}/1`, { ...box(600), outFields: WELL_FIELDS, resultRecordCount: "400" }).catch(() => null), qgeo(DCL, { ...box(600), outFields: DCL_FIELDS, resultRecordCount: "100" }).catch(() => null)]);
    const dist = (f) => haversineKm(lat, lon, f.geometry.coordinates[1], f.geometry.coordinates[0]) * 1000;
    const wells = (wr?.features || []).map((f) => ({ ...f.properties, d: dist(f) })).sort((a, b) => a.d - b.d);
    const holes = (hr?.features || []).map((f) => ({ ...f.properties, d: dist(f) })).sort((a, b) => a.d - b.d);
    if (!wells.length && !holes.length) return;
    const near = wells.slice(0, 5);
    const ids = near.map((w) => `'${w.relateid}'`).join(",");
    let strat = [], wl = [];
    if (near.length) {
      const [sr, lr] = await Promise.all([
        qgeo(`${CWI}/12`, { where: `relateid IN (${ids})`, outFields: "relateid,depth_top,depth_bot,drllr_desc,color,hardness,strat,lith_prim,lith_sec", returnGeometry: "false", orderByFields: "relateid,depth_top", resultRecordCount: "500" }, "json").catch(() => null),
        qgeo(`${CWI}/13`, { where: `relateid IN (${ids}) AND measuremt IS NOT NULL`, outFields: "relateid,meas_date,measuremt,meas_type,meas_elev", returnGeometry: "false", orderByFields: "meas_date DESC", resultRecordCount: "200" }, "json").catch(() => null)]);
      strat = (sr?.features || []).map((f) => f.attributes); wl = (lr?.features || []).map((f) => f.attributes);
    }
    const bd = wells.map((w) => w.depth2bdrk).filter((v) => v != null).sort((a, b) => a - b);
    const med = bd.length ? bd[Math.floor(bd.length / 2)] : null;
    const n0 = near[0];
    let html = `<h3>Wells and borings near this point</h3>
      <div class="stat-row">
        <div class="stat"><div class="v">${n0?.depth2bdrk != null ? fmt(n0.depth2bdrk, 0) : "–"}</div><div class="l">depth to bedrock, ft</div><div class="s">nearest well, ${fmtNum(n0?.d * 3.281)} ft away${n0?.first_bdrk ? `: ${escapeHtml(unit(n0.first_bdrk))}` : ""}</div></div>
        <div class="stat"><div class="v">${med != null ? fmt(med, 0) : "–"}</div><div class="l">median bedrock depth, ft</div><div class="s">${bd.length} of ${wells.length} wells within 600 m${bd.length ? `, range ${fmt(bd[0], 0)}–${fmt(bd[bd.length - 1], 0)}` : ""}</div></div>
        <div class="stat"><div class="v">${(() => { const s = wl.find((r) => r.relateid === n0?.relateid); return s ? fmt(s.measuremt, 0) : "–"; })()}</div><div class="l">static water, ft below grade</div><div class="s">${(() => { const s = wl.find((r) => r.relateid === n0?.relateid); return s ? `nearest well, ${ymd(s.meas_date) || "?"}` : "no measurement on nearest well"; })()}</div></div>
      </div>`;
    for (const w of near) {
      const rows = strat.filter((r) => r.relateid === w.relateid);
      const s = wl.find((r) => r.relateid === w.relateid);
      const id = String(w.unique_no || w.relateid).replace(/^0+/, "");
      html += `<details class="well" ${w === n0 ? "open" : ""}><summary><b>Well ${escapeHtml(id)}</b> · ${escapeHtml(useDesc(w.use_c))}${w.status_c && w.status_c !== "A" ? ` (${STATUS[w.status_c] || w.status_c})` : ""} · ${fmtNum(w.d * 3.281)} ft away · ${fmt(w.depth_drll, 0)} ft deep · bedrock ${w.depth2bdrk != null ? `at ${fmt(w.depth2bdrk, 0)} ft` : "n/a"}</summary>
        <div class="small">${escapeHtml(w.wellname || "")}${w.date_drll ? ` · drilled ${ymd(w.date_drll)}` : ""}${w.elevation ? ` · surface ${fmt(w.elevation, 0)} ft (${escapeHtml(codes?.elev?.[(w.elev_mc || "").trim()] || (w.elev_mc || "").trim() || "source ?")})` : ""}${w.case_depth ? ` · ${fmt(w.case_diam, 0)}-in casing to ${fmt(w.case_depth, 0)} ft` : ""}${w.aquifer ? ` · aquifer ${escapeHtml(unit(w.aquifer))}` : ""}${w.first_bdrk ? ` · first bedrock ${escapeHtml(unit(w.first_bdrk))}` : ""}${s ? ` · static water ${fmt(s.measuremt, 1)} ft (${ymd(s.meas_date) || "?"})` : ""} · location: ${escapeHtml(codes?.loc?.[(w.loc_mc || "").trim()] || (w.loc_mc || "").trim() || "unverified")}${[w.core && "core", w.cuttings && "cuttings", w.bhgeophys && "geophysical log"].filter(Boolean).length ? " · samples: " + [w.core && "core", w.cuttings && "cuttings", w.bhgeophys && "geophysical log"].filter(Boolean).join(", ") : ""}</div>
        ${rows.length ? `<table class="data"><thead><tr><th class="num">From ft</th><th class="num">To ft</th><th>Driller's description</th><th>Unit</th><th>Lithology</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td class="num">${fmt(r.depth_top, 0)}</td><td class="num">${fmt(r.depth_bot, 0)}</td><td>${escapeHtml((r.drllr_desc || "").trim())}${r.color ? ` <span class="small">${escapeHtml(r.color.trim().toLowerCase())}${r.hardness ? ", " + escapeHtml(r.hardness.trim().toLowerCase()) : ""}</span>` : ""}</td><td title="${escapeHtml(r.strat || "")}">${escapeHtml(r.strat ? unit(r.strat) : "")}</td><td>${escapeHtml(lith(r.lith_prim))}${r.lith_sec ? ", " + escapeHtml(lith(r.lith_sec)) : ""}</td></tr>`).join("")}</tbody></table>` : `<div class="small">No stratigraphy record in CWI for this well.</div>`}
        <div class="small"><a href="https://apps.health.state.mn.us/cwiinfo/index.xhtml?wellId=${encodeURIComponent(w.relateid)}" target="_blank" rel="noopener">Full MDH well record (log, construction, water levels)</a></div>
      </details>`;
    }
    if (wells.length > near.length) html += `<div class="small">${wells.length - near.length} more wells within 600 m; turn on the Wells layer to see them.</div>`;
    if (holes.length) {
      html += `<div style="margin-top:8px"><b>DNR Drill Core Library holes within 600 m</b></div><table class="data"><thead><tr><th>Hole</th><th>Purpose</th><th>Drilled for</th><th class="num">Year</th><th class="num">Depth ft</th><th>Method</th><th class="num">Dist ft</th></tr></thead><tbody>
        ${holes.slice(0, 8).map((h) => `<tr><td>${escapeHtml(h.dhname || "")}${h.mdhnum ? `<div class="small">MDH ${h.mdhnum}</div>` : ""}</td><td>${escapeHtml(h.drlpurpose || "")}</td><td>${escapeHtml(h.drillfor || "")}${h.project ? `<div class="small">${escapeHtml(h.project)}</div>` : ""}</td><td class="num">${h.drilldate ? new Date(h.drilldate).getFullYear() : "–"}</td><td class="num">${h.totdep ? fmt(h.totdep, 0) : "–"}</td><td>${escapeHtml(h.drillmthd || "")}${h.dip != null && h.dip !== -90 ? ` <span class="small">dip ${h.dip}°</span>` : ""}</td><td class="num">${fmtNum(h.d * 3.281)}</td></tr>`).join("")}</tbody></table>
        <div class="small">Core and logs for these holes are held at the <a href="https://www.dnr.state.mn.us/lands_minerals/dc_library.html" target="_blank" rel="noopener">DNR Drill Core Library</a> in Hibbing; documents via the <a href="https://www.dnr.state.mn.us/lands_minerals/mpes_projects/mmrd.html" target="_blank" rel="noopener">Minnesota Mineral Resources Database</a>.</div>`;
    }
    html += `<div class="small">Source: MN County Well Index (Minnesota Geological Survey and MDH). Driller descriptions are as logged by the contractor; unit codes are the MGS interpretation. Well locations vary from GPS to section-level; check the location method before relying on a log. <a href="https://mnwellindex.web.health.state.mn.us/mwi/" target="_blank" rel="noopener">Minnesota Well Index map</a>.</div>`;
    container.innerHTML = html;
  } catch (e) { console.warn("wells lookup failed", e); }
}

// ---- Watershed: depth to bedrock from wells inside the basin ----
const basinCache = new Map();
function basinRing(geometry) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const ring = polys.map((p) => p[0]).sort((a, b) => b.length - a.length)[0];
  const step = Math.max(1, Math.ceil(ring.length / 400));
  const pts = ring.filter((_, i) => i % step === 0).map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]);
  if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) pts.push(pts[0]);
  return pts;
}
export async function basinBedrock(geometry) {
  const ring = basinRing(geometry); const key = JSON.stringify(ring).slice(0, 300) + ring.length;
  if (basinCache.has(key)) return basinCache.get(key);
  await loadCodes().catch(() => {});
  const geom = JSON.stringify({ rings: [ring], spatialReference: { wkid: 4326 } });
  const all = []; let offset = 0;
  while (offset < 8000) {
    const d = await qgeo(`${CWI}/1`, { where: "1=1", geometry: geom, geometryType: "esriGeometryPolygon", spatialRel: "esriSpatialRelIntersects", outFields: "depth2bdrk,first_bdrk,depth_drll", returnGeometry: "false", resultRecordCount: "2000", resultOffset: String(offset) }, "json");
    const rows = (d.features || []).map((f) => f.attributes); all.push(...rows);
    if (rows.length < 2000 || !d.exceededTransferLimit) break; offset += 2000;
  }
  const bd = all.map((r) => r.depth2bdrk).filter((v) => v != null).sort((a, b) => a - b);
  const q = (p) => (bd.length ? bd[Math.min(bd.length - 1, Math.floor(p * bd.length))] : null);
  const units = {}; for (const r of all) if (r.first_bdrk) units[r.first_bdrk.trim()] = (units[r.first_bdrk.trim()] || 0) + 1;
  const out = { wells: all.length, withBdrk: bd.length, min: bd[0] ?? null, q1: q(0.25), median: q(0.5), q3: q(0.75), max: bd[bd.length - 1] ?? null, lt10: bd.filter((v) => v < 10).length, lt25: bd.filter((v) => v < 25).length, units: Object.entries(units).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => [unit(c), n]) };
  basinCache.set(key, out); return out;
}
export async function renderBasinBedrock(container, geometry) {
  container.innerHTML = `<div class="small">Loading wells in basin…</div>`;
  try {
    const r = await basinBedrock(geometry);
    if (!r.wells) { container.innerHTML = `<h3>Depth to bedrock · CWI wells in basin</h3><div class="small">No located wells or borings inside the basin.</div>`; return; }
    container.innerHTML = `<h3>Depth to bedrock · CWI wells in basin</h3>
      <div class="stat-row">
        <div class="stat"><div class="v">${r.median != null ? fmt(r.median, 0) : "–"}</div><div class="l">median depth to bedrock, ft</div><div class="s">${r.withBdrk} wells with stratigraphy of ${r.wells}${r.wells >= 8000 ? "+" : ""} in basin</div></div>
        <div class="stat"><div class="v">${r.q1 != null ? `${fmt(r.q1, 0)}–${fmt(r.q3, 0)}` : "–"}</div><div class="l">interquartile range, ft</div><div class="s">full range ${r.min != null ? `${fmt(r.min, 0)}–${fmt(r.max, 0)}` : "–"}</div></div>
        <div class="stat ${r.withBdrk && r.lt10 / r.withBdrk > 0.25 ? "warn" : ""}"><div class="v">${r.withBdrk ? fmt((100 * r.lt10) / r.withBdrk, 0) + "%" : "–"}</div><div class="l">wells with bedrock &lt; 10 ft</div><div class="s">${r.withBdrk ? fmt((100 * r.lt25) / r.withBdrk, 0) + "% under 25 ft" : ""}</div></div>
      </div>
      ${r.units.length ? `<div class="small">First bedrock units: ${r.units.map(([u, n]) => `${escapeHtml(u)} (${n})`).join(", ")}.</div>` : ""}
      <div class="small">Wells cluster along roads and lakeshores, so this is a biased sample of the basin, not an areal average. Use with the karst and soils sections for infiltration and excavation judgments.</div>`;
  } catch (e) { container.innerHTML = `<div class="small">Basin well query failed: ${escapeHtml(e.message || String(e))}</div>`; }
}
