// DNR overlay layers loaded per viewport: designated trout streams, karst (Pine County sandstone karst polygons,
// karst feature points, springs). All from enterprise.gisdata.mn.gov (CORS).
import { $, escapeHtml, fmt, debounce, emit } from "./util.js";
import { track } from "./loader.js";
import { map, setOverlay } from "./map.js";

const B = "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr";
const PCA = "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_pca";
const BWSR = "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_bwsr";
const KARST_FEATURE = { D: "Sinkhole", X: "Stream sink / disappearing stream", B: "Karst spring / seep", I: "Karst window", U: "Karst feature (unclassified)" };
export const WETLAND_COLORS = { "Freshwater Emergent Wetland": "#7fc97f", "Freshwater Forested Wetland": "#1b7837", "Freshwater Shrub Wetland": "#5aae61", "Freshwater Pond": "#74add1", "Lake": "#2166ac", "Riverine": "#4575b4", "Other": "#bdbdbd", "Estuarine and Marine Wetland": "#c2a5cf", "Estuarine and Marine Deepwater": "#762a83" };
const CIRC39 = { 1: "Type 1 seasonally flooded basin/flat", 2: "Type 2 wet meadow", 3: "Type 3 shallow marsh", 4: "Type 4 deep marsh", 5: "Type 5 shallow open water", 6: "Type 6 shrub swamp", 7: "Type 7 wooded swamp", 8: "Type 8 bog", 80: "Type 80 municipal/industrial", 90: "Type 90 riverine" };
export const circ39 = (c) => CIRC39[c] || (c != null ? "Type " + c : "");
const TROUT_FLAG = { 1: "Designated trout stream", 2: "Designated trout stream (tributary reach)" };

export const LAYERS = {
  pwi: {
    label: "Public waters (PWI)", minZoom: 11, note: "DNR Public Waters Inventory: public water basins and wetlands (with DNR shoreland class) and public watercourses. Bed or bank work below the OHWL needs a DNR public waters work permit; shoreland rules apply within 1,000 ft of a basin and 300 ft of a watercourse.",
    sources: [
      { id: "pwi-basins", url: `${B}/water_mn_public_waters/FeatureServer/1`, fields: "pw_basin_name,dowlknum,pwi_class,pwi_label,wettype,acres,dnr_shoreland_class", kind: "fill", where: "dowlknum <> '16000100'" },
      { id: "pwi-lines", url: `${B}/water_mn_public_waters/FeatureServer/0`, fields: "kittle_name,kittle_nbr,pwi_label,entire", kind: "line" },
    ],
    legend: `<div class="legend-row"><span class="swatch sq" style="background:#38bdf8;opacity:.5"></span>Public water basin</div><div class="legend-row"><span class="swatch sq" style="background:#a3e635;opacity:.5"></span>Public water wetland</div><div class="legend-row"><span class="swatch sq" style="background:#0284c7"></span>Public watercourse</div>`,
  },
  impaired: {
    label: "Impaired waters & TMDLs", minZoom: 10, note: "MPCA 2024 impaired waters list (303(d)): stream reaches and lakes with their impairments, and approved TMDL allocation areas. Hover for the impairments; click a point for TMDL status and affected uses.",
    sources: [
      { id: "tmdl-areas", url: `${PCA}/env_tmdl_allocation_areas/FeatureServer/3`, fields: "waterbody_name,tmdl_pollutant,epa_approval,source,area_sq_mi", kind: "fill" },
      { id: "imp-lakes", url: `${PCA}/env_impaired_water_2024/FeatureServer/13`, fields: "auid,name,reach_desc,affected_u,imp_param,approved,needs_pln,area_acres", kind: "fill", where: "area_acres < 200000" },
      { id: "imp-streams", url: `${PCA}/env_impaired_water_2024/FeatureServer/7`, fields: "auid,name,reach_desc,affected_u,imp_param,approved,needs_pln", kind: "line" },
    ],
    legend: `<div class="legend-row"><span class="swatch sq" style="background:#dc2626"></span>Impaired stream reach</div><div class="legend-row"><span class="swatch sq" style="background:#f97316;opacity:.6"></span>Impaired lake</div><div class="legend-row"><span class="swatch sq" style="background:#a855f7;opacity:.35"></span>TMDL allocation area</div>`,
  },
  easements: {
    label: "Conservation easements", minZoom: 10, note: "BWSR Reinvest in Minnesota (RIM) conservation easements and wetland banking easements. Use restrictions apply inside the boundary; the recorded legal description governs.",
    sources: [
      { id: "rim", url: `${BWSR}/bdry_bwsr_rim_cons_easements/FeatureServer/0`, fields: "ease_num,ease_type,ease_cat,ease_acres,ease_year,exp_status,swcd_name", kind: "fill" },
      { id: "wetbank", url: `${BWSR}/bdry_wetland_banking_easements/FeatureServer/0`, fields: "county,siteid,easement_number,acres,instrument_type,recording_date", kind: "fill" },
    ],
    legend: `<div class="legend-row"><span class="swatch sq" style="background:#16a34a;opacity:.6"></span>RIM easement</div><div class="legend-row"><span class="swatch sq" style="background:#0d9488;opacity:.6"></span>Wetland bank easement</div>`,
  },
  wetlands: {
    label: "Wetlands (NWI)", minZoom: 11, note: "Minnesota National Wetlands Inventory update (DNR, 2009–2014 imagery): Cowardin code, wetland type, Circular 39 type and hydrogeomorphic class. Inventory-level mapping; jurisdictional boundaries require a delineation.",
    sources: [{ id: "wetlands", url: `${B}/water_nat_wetlands_inv_2009_2014/FeatureServer/0`, fields: "attribute,wetland_type,acres,circ39_class,hgm_desc,spcc_desc", kind: "fill", static: false }],
    legend: Object.entries(WETLAND_COLORS).filter(([k]) => !/Estuarine/.test(k)).map(([k, c]) => `<div class="legend-row"><span class="swatch sq" style="background:${c};opacity:.75"></span>${k.replace("Freshwater ", "")}</div>`).join(""),
  },
  trout: {
    label: "Trout streams", minZoom: 9, note: "DNR designated trout streams (MN Rules 6264.0050). Blue = designated; light blue = tributary reaches carrying the designation. Special regulations, sanctuaries and posted boundaries are on the DNR special-regs layer (not shown).",
    sources: [{ id: "trout", url: `${B}/env_trout_stream_designations/FeatureServer/0`, fields: "kittle_nbr,kittle_name,trout_flag,length_mi", kind: "line" }],
    legend: `<div class="legend-row"><span class="swatch sq" style="background:#1d4ed8"></span>Designated trout stream</div><div class="legend-row"><span class="swatch sq" style="background:#60a5fa"></span>Designated tributary reach</div>`,
  },
  karst: {
    label: "Karst", minZoom: 9, note: "MGS/DNR surface karst: bedrock units with karst development (in TSA3, the Hinckley Sandstone in Pine County), karst feature inventory points (sinkholes, stream sinks, springs) and the springs inventory.",
    sources: [
      { id: "karst-poly", url: `${B}/geos_surface_karst_feature_devel/FeatureServer/1`, fields: "maplabel,descriptn,map", kind: "fill" },
      { id: "karst-pts", url: `${B}/geos_karst_feature_inventory_pts/FeatureServer/0`, fields: "feature,name,feat_label,status,depth2bdrk,first_bdrk,elevation,vert_datum,field_check_date", kind: "point" },
      { id: "springs", url: `${B}/env_mn_springs_inventory/FeatureServer/0`, fields: "name,feature,spring_type,lithology,flowing,flow,flow_units,temp_c,field_check_date", kind: "point" },
    ],
    legend: `<div class="legend-row"><span class="swatch sq" style="background:#c084fc;opacity:.6"></span>Karst-prone bedrock (sandstone/carbonate)</div><div class="legend-row"><span class="swatch" style="background:#7e22ce"></span>Sinkhole / stream sink / karst feature</div><div class="legend-row"><span class="swatch" style="background:#06b6d4"></span>Spring (DNR inventory)</div>`,
  },
};

const enabled = {}; const lastKey = {}; const inflight = {};

export function initDnrLayers() { map.on("moveend", debounce(() => { for (const k of Object.keys(LAYERS)) if (enabled[k]) refresh(k); }, 350)); }
export function setDnrLayerEnabled(k, on) { enabled[k] = on; if (on) refresh(k); else { for (const s of LAYERS[k].sources) setOverlay(s.id, { type: "FeatureCollection", features: [] }); lastKey[k] = null; note(k, ""); } }
function note(k, t) { const el = $(`${k}-note`); if (el) el.textContent = t; emit("layer:status", { name: k, text: t }); }

// Static snapshots (tools/build_static_layers.py → data/layers/<id>/) are read first; MnGeo is the fallback.
const staticIdx = {}, staticCells = {};
function bboxOfGeom(g) { if (g.__bb) return g.__bb; let w = 180, s = 90, e = -180, n = -90; const walk = (c) => { if (typeof c[0] === "number") { if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1]; } else c.forEach(walk); }; walk(g.coordinates); return (g.__bb = [w, s, e, n]); }
async function fetchStatic(s, bbox) {
  const base = `data/layers/${s.id}`;
  if (staticIdx[s.id] === undefined) { try { const r = await fetch(`${base}/index.json`); staticIdx[s.id] = r.ok ? await r.json() : null; } catch { staticIdx[s.id] = null; } }
  const idx = staticIdx[s.id]; if (!idx) return null;
  if (idx.single) { const k = s.id + "/" + idx.single; if (!staticCells[k]) { const r = await fetch(`${base}/${idx.single}`); staticCells[k] = r.ok ? await r.json() : { features: [] }; for (const f of staticCells[k].features) decorate(s.id, f.properties); } const feats = staticCells[k].features.filter((f) => { const bb = bboxOfGeom(f.geometry); return bb[0] <= bbox[2] && bb[2] >= bbox[0] && bb[1] <= bbox[3] && bb[3] >= bbox[1]; }); return { fc: { type: "FeatureCollection", features: feats }, exceeded: false, fetched: idx.fetched }; }
  const cells = idx.cells.filter((c) => c.bbox[0] <= bbox[2] && c.bbox[2] >= bbox[0] && c.bbox[1] <= bbox[3] && c.bbox[3] >= bbox[1]);
  const fcs = await Promise.all(cells.map(async (c) => { const k = s.id + "/" + c.f; if (!staticCells[k]) { const r = await fetch(`${base}/${c.f}`); staticCells[k] = r.ok ? await r.json() : { features: [] }; if (Object.keys(staticCells).length > 60) delete staticCells[Object.keys(staticCells)[0]]; } return staticCells[k]; }));
  const seen = new Set(); const features = [];
  for (const fc of fcs) for (const f of fc.features) { const id = f.properties.__id; if (seen.has(id)) continue; seen.add(id); decorate(s.id, f.properties); features.push(f); }
  return { fc: { type: "FeatureCollection", features }, exceeded: false, fetched: idx.fetched };
}
async function fetchSrc(s, bbox) {
  if (s.static !== false) { const st = await fetchStatic(s, bbox); if (st) return st; }
  return fetchLive(s, bbox);
}
async function fetchLive(s, bbox, signal) {
  const offset = (360 / (256 * 2 ** map.getZoom())) / 2; // half a screen pixel in degrees: simplify big polygons server-side
  const q = new URLSearchParams({ geometry: bbox.map((v) => v.toFixed(5)).join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: s.fields, outSR: "4326", geometryPrecision: "5", maxAllowableOffset: offset.toFixed(6), where: s.where || "1=1", f: "geojson", resultRecordCount: "2000" });
  let r; try { r = await fetch(`${s.url}/query?${q}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000) }); } catch (e) { throw new Error(`${s.id}: ${e.name === "TimeoutError" ? "MnGeo did not answer in 90 s" : e.message}`); }
  if (!r.ok) throw new Error(`${s.id} ${r.status}`);
  const d = await r.json(); if (d.error) throw new Error(`${s.id}: ${d.error.message}`);
  for (const f of d.features || []) decorate(s.id, f.properties);
  return { fc: { type: "FeatureCollection", features: d.features || [] }, exceeded: !!d.properties?.exceededTransferLimit };
}
const IMPN = { "Hg-F": "mercury (fish)", "Hg-W": "mercury (water)", T: "turbidity", TSS: "TSS", "E.coli": "E. coli", FC: "fecal coliform", DO: "dissolved oxygen", Nutrients: "nutrients", "Fishes bio": "fish IBI", "Invert bio": "invertebrate IBI", Chloride: "chloride", "PCB-F": "PCBs (fish)", "PFOS-F": "PFOS (fish)", pH: "pH", Temp: "temperature" };
const impShort = (s) => (s || "").split(";").map((x) => x.trim()).filter((x) => x && x !== "None").map((x) => IMPN[x] || x).join(", ");
function decorate(id, p) {
  if (id === "pwi-basins") { p.color = /wetland/i.test(p.pwi_label || "") ? "#a3e635" : "#38bdf8"; p.opacity = 0.35; p.popup = `<div class="popup-title">${escapeHtml(p.pw_basin_name || "Unnamed basin")}</div><div class="popup-sub">${escapeHtml(p.pwi_label || "")}${p.dowlknum ? " · DOW " + escapeHtml(p.dowlknum) : ""}${p.acres ? " · " + Math.round(p.acres).toLocaleString() + " ac" : ""}${p.dnr_shoreland_class ? " · shoreland: " + escapeHtml(p.dnr_shoreland_class) : ""}</div>`; return; }
  if (id === "pwi-lines") { p.color = "#0284c7"; p.popup = `<div class="popup-title">${escapeHtml(p.kittle_name || "Unnamed watercourse")}</div><div class="popup-sub">${escapeHtml(p.pwi_label || "Public watercourse")}${p.entire === "Y" ? " · entire length" : ""}${p.upsum_sqmi ? ` · ${fmt(p.upsum_sqmi, 1)} mi² upstream` : ""}${p.kittle_nbr ? " · " + escapeHtml(p.kittle_nbr) : ""}</div>`; return; }
  if (id === "imp-streams") { p.color = "#dc2626"; p.popup = `<div class="popup-title">${escapeHtml(p.name || "Impaired reach")}</div><div class="popup-sub">${escapeHtml(p.reach_desc || "")} · AUID ${escapeHtml(p.auid || "")}</div><div class="popup-sub">Impaired: ${escapeHtml(impShort(p.imp_param))}${p.approved && p.approved !== "None" ? " · TMDL approved: " + escapeHtml(impShort(p.approved)) : ""}${p.needs_pln && p.needs_pln !== "None" ? " · TMDL needed: " + escapeHtml(impShort(p.needs_pln)) : ""}</div>`; return; }
  if (id === "imp-lakes") { p.color = "#f97316"; p.opacity = 0.4; p.popup = `<div class="popup-title">${escapeHtml(p.name || "Impaired lake")}</div><div class="popup-sub">AUID ${escapeHtml(p.auid || "")}${p.area_acres ? " · " + Math.round(p.area_acres).toLocaleString() + " ac" : ""}</div><div class="popup-sub">Impaired: ${escapeHtml(impShort(p.imp_param))}${p.approved && p.approved !== "None" ? " · TMDL approved: " + escapeHtml(impShort(p.approved)) : ""}</div>`; return; }
  if (id === "tmdl-areas") { p.color = "#a855f7"; p.opacity = 0.18; p.popup = `<div class="popup-title">TMDL allocation area · ${escapeHtml(p.waterbody_name || "")}</div><div class="popup-sub">${escapeHtml(p.tmdl_pollutant || "")}${p.epa_approval ? " · EPA approved " + new Date(p.epa_approval).toLocaleDateString() : ""}${p.area_sq_mi ? ` · ${fmt(p.area_sq_mi, 1)} mi²` : ""}</div>`; return; }
  if (id === "rim") { p.color = "#16a34a"; p.opacity = 0.4; p.popup = `<div class="popup-title">BWSR ${escapeHtml(p.ease_cat || "RIM")} easement ${escapeHtml(p.ease_num || "")}</div><div class="popup-sub">${escapeHtml(p.ease_type || "")} · ${fmt(p.ease_acres, 1)} ac · ${escapeHtml(String(p.ease_year || ""))} · ${escapeHtml(p.swcd_name || "")} SWCD · ${escapeHtml(p.exp_status || "")}</div>`; return; }
  if (id === "wetbank") { p.color = "#0d9488"; p.opacity = 0.4; p.popup = `<div class="popup-title">Wetland bank easement ${escapeHtml(p.easement_number || "")}</div><div class="popup-sub">site ${escapeHtml(String(p.siteid || ""))} · ${fmt(p.acres, 1)} ac · ${escapeHtml(p.county || "")} County${p.instrument_type ? " · " + escapeHtml(p.instrument_type) : ""}</div>`; return; }
  if (id === "trout") { p.color = p.trout_flag === 1 ? "#1d4ed8" : "#60a5fa"; p.popup = `<div class="popup-title">${escapeHtml(p.kittle_name || "Unnamed stream")}</div><div class="popup-sub">${TROUT_FLAG[p.trout_flag] || "Trout stream"} · ${escapeHtml(p.kittle_nbr || "")} · ${fmt(p.length_mi, 2)} mi segment</div>`; }
  else if (id === "wetlands") { p.color = WETLAND_COLORS[p.wetland_type] || "#bdbdbd"; p.popup = `<div class="popup-title">${escapeHtml(p.wetland_type || "Wetland")} <span class="popup-sub">${escapeHtml(p.attribute || "")}</span></div><div class="popup-sub">${escapeHtml(circ39(p.circ39_class))}${p.spcc_desc ? " · " + escapeHtml(p.spcc_desc) : ""} · ${fmt(p.acres, 2)} ac</div><div class="popup-sub">${escapeHtml(p.hgm_desc || "")}</div>`; }
  else if (id === "karst-poly") { p.popup = `<div class="popup-title">Karst-prone bedrock: ${escapeHtml(p.descriptn || p.maplabel)}</div><div class="popup-sub">Unit ${escapeHtml(p.maplabel || "")} · MGS map ${escapeHtml(p.map || "")}</div>`; }
  else if (id === "karst-pts") { p.color = "#7e22ce"; p.popup = `<div class="popup-title">${KARST_FEATURE[p.feature] || "Karst feature"}${p.name ? ": " + escapeHtml(p.name) : ""}</div><div class="popup-sub">${escapeHtml(p.feat_label || "")}${p.first_bdrk ? " · bedrock " + escapeHtml(p.first_bdrk) : ""}${p.depth2bdrk != null ? " · depth to bedrock " + p.depth2bdrk + " ft" : ""}${p.elevation ? " · el. " + p.elevation + " " + escapeHtml(p.vert_datum || "") : ""}${p.field_check_date ? " · checked " + new Date(p.field_check_date).getFullYear() : ""}</div>`; }
  else if (id === "springs") { p.color = "#06b6d4"; p.popup = `<div class="popup-title">Spring${p.name ? ": " + escapeHtml(p.name) : ""}</div><div class="popup-sub">${escapeHtml(p.spring_type || p.feature || "")}${p.lithology ? " · " + escapeHtml(p.lithology) : ""}${p.flow ? " · " + p.flow + " " + escapeHtml(p.flow_units || "") : ""}${p.temp_c != null ? " · " + p.temp_c + " °C" : ""}${p.flowing ? " · " + escapeHtml(p.flowing) : ""}</div>`; }
}
async function refresh(k) {
  const L = LAYERS[k]; const z = map.getZoom(); const b = map.getBounds();
  if (z < L.minZoom) { for (const s of L.sources) setOverlay(s.id, { type: "FeatureCollection", features: [] }); lastKey[k] = null; note(k, `${L.label}: zoom in (${L.minZoom}+) to load`); return; }
  const pad = 0.15;
  const bbox = [b.getWest() - (b.getEast() - b.getWest()) * pad, b.getSouth() - (b.getNorth() - b.getSouth()) * pad, b.getEast() + (b.getEast() - b.getWest()) * pad, b.getNorth() + (b.getNorth() - b.getSouth()) * pad];
  const key = bbox.map((v) => v.toFixed(3)).join(",");
  if (key === lastKey[k]) return; lastKey[k] = key;
  note(k, `${L.label}: loading…`);
  const mine = (inflight[k] = Promise.allSettled(L.sources.map((s) => fetchSrc(s, bbox))));
  track(L.label.replace(/ \(.*\)| &.*$/, ""), mine);
  const res = await mine; if (inflight[k] !== mine || !enabled[k]) return;
  let n = 0, exceeded = false; const errs = [];
  res.forEach((r, i) => { const s = L.sources[i]; if (r.status === "fulfilled") { setOverlay(s.id, r.value.fc); n += r.value.fc.features.length; exceeded ||= r.value.exceeded; } else errs.push(r.reason?.message || String(r.reason)); });
  const snap = res.map((r) => r.value?.fetched).find(Boolean);
  const base = `${L.label}: ${n} features${snap ? ` (snapshot ${snap})` : ""}${exceeded ? " (limit hit, zoom in)" : ""}${errs.length ? " · failed: " + errs.join("; ") + " · toggle the layer to retry" : ""}`;
  note(k, base);
  const snapSrcs = L.sources.filter((s, i) => res[i].value?.fetched);
  if (snapSrcs.length) revalidate(k, bbox, key, snapSrcs, base);
}
// Stale-while-revalidate: the snapshot is drawn at once, then MnGeo is asked for the current features in the
// background and swaps them in when (if) it answers. A failed or timed-out check keeps the snapshot and backs off
// for a few minutes so a slow MnGeo day doesn't pile up 90 s requests on every pan.
const liveCtl = {}, liveBackoffUntil = {};
async function revalidate(k, bbox, key, srcs, base) {
  const L = LAYERS[k];
  if (Date.now() < (liveBackoffUntil[k] || 0)) { note(k, `${base} · MnGeo was not answering, live check paused a few minutes`); return; }
  liveCtl[k]?.abort(); const ctl = (liveCtl[k] = new AbortController());
  note(k, `${base} · checking MnGeo for newer data…`);
  const p = Promise.allSettled(srcs.map((s) => fetchLive(s, bbox, ctl.signal)));
  track(`${L.label.replace(/ \(.*\)| &.*$/, "")} live check`, p);
  const res = await p; if (ctl.signal.aborted || lastKey[k] !== key || !enabled[k]) return;
  let n = 0, ok = 0, exceeded = false;
  res.forEach((r, i) => { if (r.status === "fulfilled") { setOverlay(srcs[i].id, r.value.fc); n += r.value.fc.features.length; exceeded ||= r.value.exceeded; ok++; } });
  const at = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (ok === srcs.length) note(k, `${L.label}: ${n} features (live from MnGeo, ${at})${exceeded ? " (limit hit, zoom in)" : ""}`);
  else if (ok) note(k, `${L.label}: partly live (${at}), rest from snapshot`);
  else { liveBackoffUntil[k] = Date.now() + 5 * 60 * 1000; note(k, `${base} · MnGeo not answering (${at}), showing snapshot`); }
}
// Wetlands intersecting a point (for the Point panel)
export async function wetlandsAt(lon, lat) {
  const q = new URLSearchParams({ geometry: `${lon.toFixed(6)},${lat.toFixed(6)}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "attribute,wetland_type,acres,circ39_class,hgm_desc,spcc_desc,cow_class1", returnGeometry: "false", f: "json" });
  const r = await fetch(`${B}/water_nat_wetlands_inv_2009_2014/FeatureServer/0/query?${q}`); const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return (d.features || []).map((f) => f.attributes);
}
export async function renderWetlandAt(container, lon, lat) {
  container.innerHTML = "";
  try {
    const rows = await wetlandsAt(lon, lat);
    if (!rows.length) return;
    container.innerHTML = `<h3>Wetland at this point · MN NWI update</h3>
      ${rows.map((w) => `<div><b style="color:${WETLAND_COLORS[w.wetland_type] || "#bdbdbd"}">${escapeHtml(w.wetland_type || "Wetland")}</b> · Cowardin <b>${escapeHtml(w.attribute || "")}</b> · ${fmt(w.acres, 2)} ac</div>
        <div class="small">${escapeHtml(circ39(w.circ39_class))}${w.spcc_desc ? " · " + escapeHtml(w.spcc_desc) : ""}${w.hgm_desc ? " · HGM: " + escapeHtml(w.hgm_desc) : ""}</div>`).join("")}
      <div class="small">Inventory-level mapping from 2009–2014 imagery; a WCA jurisdictional boundary needs a field delineation. <a href="https://arcgis.dnr.state.mn.us/ewr/wetlandfinder/" target="_blank" rel="noopener">MN Wetland Finder</a> · <a href="https://fwsprimary.wim.usgs.gov/wetlands/apps/wetlands-mapper/?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&zoom=15" target="_blank" rel="noopener">USFWS Wetlands Mapper here</a> · <a href="https://www.dnr.state.mn.us/eco/wetlands/nwi_proj.html" target="_blank" rel="noopener">About the MN NWI update</a></div>`;
  } catch (e) { console.warn("wetlands lookup failed", e); }
}
export function dnrLegendHtml(k) { const L = LAYERS[k]; return `<h4>${L.label} (MN DNR)</h4>${L.legend}<div class="small">${L.note} <span id="${k}-note"></span></div>`; }
