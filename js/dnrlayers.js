// DNR overlay layers loaded per viewport: designated trout streams, karst (Pine County sandstone karst polygons,
// karst feature points, springs). All from enterprise.gisdata.mn.gov (CORS).
import { $, escapeHtml, fmt, debounce } from "./util.js";
import { map, setOverlay } from "./map.js";

const B = "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr";
const KARST_FEATURE = { D: "Sinkhole", X: "Stream sink / disappearing stream", B: "Karst spring / seep", I: "Karst window", U: "Karst feature (unclassified)" };
const TROUT_FLAG = { 1: "Designated trout stream", 2: "Designated trout stream (tributary reach)" };

export const LAYERS = {
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
function note(k, t) { const el = $(`${k}-note`); if (el) el.textContent = t; }

async function fetchSrc(s, bbox) {
  const q = new URLSearchParams({ geometry: bbox.map((v) => v.toFixed(5)).join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: s.fields, outSR: "4326", geometryPrecision: "5", f: "geojson", resultRecordCount: "2000" });
  const r = await fetch(`${s.url}/query?${q}`); if (!r.ok) throw new Error(`${s.id} ${r.status}`);
  const d = await r.json(); if (d.error) throw new Error(`${s.id}: ${d.error.message}`);
  for (const f of d.features || []) decorate(s.id, f.properties);
  return { fc: { type: "FeatureCollection", features: d.features || [] }, exceeded: !!d.properties?.exceededTransferLimit };
}
function decorate(id, p) {
  if (id === "trout") { p.color = p.trout_flag === 1 ? "#1d4ed8" : "#60a5fa"; p.popup = `<div class="popup-title">${escapeHtml(p.kittle_name || "Unnamed stream")}</div><div class="popup-sub">${TROUT_FLAG[p.trout_flag] || "Trout stream"} · ${escapeHtml(p.kittle_nbr || "")} · ${fmt(p.length_mi, 2)} mi segment</div>`; }
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
  const res = await mine; if (inflight[k] !== mine || !enabled[k]) return;
  let n = 0, exceeded = false; const errs = [];
  res.forEach((r, i) => { const s = L.sources[i]; if (r.status === "fulfilled") { setOverlay(s.id, r.value.fc); n += r.value.fc.features.length; exceeded ||= r.value.exceeded; } else errs.push(r.reason?.message || String(r.reason)); });
  note(k, `${L.label}: ${n} features${exceeded ? " (limit hit, zoom in)" : ""}${errs.length ? " · failed: " + errs.join("; ") : ""}`);
}
export function dnrLegendHtml(k) { const L = LAYERS[k]; return `<h4>${L.label} (MN DNR)</h4>${L.legend}<div class="small">${L.note} <span id="${k}-note"></span></div>`; }
