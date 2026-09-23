// USGS Watershed Boundary Dataset (WBD) HUC-8, HUC-10 and HUC-12 boundaries for the TSA3 region, drawn at every
// zoom from site snapshots (data/layers/huc8|huc10|huc12/all.json, tools/build_static_layers.py). HUC-8 and HUC-10
// load when the layer is turned on; HUC-12 (5 MB) loads from zoom 9 or when a Point panel asks which HUCs it is in.
import { escapeHtml, fmt, fmtNum, debounce, emit } from "./util.js";
import { track } from "./loader.js";
import { map, setOverlay } from "./map.js";

export const HUC_LEVELS = [
  { id: "huc8", code: "huc8", label: "HUC-8 subbasin", color: "#6d28d9", minzoom: 0 },
  { id: "huc10", code: "huc10", label: "HUC-10 watershed", color: "#7c3aed", minzoom: 6.5 },
  { id: "huc12", code: "huc12", label: "HUC-12 subwatershed", color: "#8b5cf6", minzoom: 9 },
];
const data = {};
function load(id) {
  if (!data[id]) {
    const L = HUC_LEVELS.find((l) => l.id === id);
    data[id] = fetch(`data/layers/${id}/all.json`).then(async (r) => {
      if (!r.ok) return null; const fc = await r.json();
      for (const f of fc.features) { const p = f.properties; p.code = p[L.code]; p.popup = `<div class="popup-title">${escapeHtml(p.name || "")}</div><div class="popup-sub">${L.label} ${escapeHtml(p.code || "")} · ${fmtNum(p.areasqkm / 2.58999, p.areasqkm < 260 ? 1 : 0)} mi²</div>`; }
      return fc;
    }).catch(() => { delete data[id]; return null; });
  }
  return data[id];
}
// A label point well inside each polygon: the centroid of the largest ring if it falls inside, else the midpoint of the
// widest horizontal span through the ring's middle latitude (cheap pole-of-inaccessibility stand-in).
function labelPoint(g) {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const ring = polys.map((p) => p[0]).sort((a, b) => b.length - a.length)[0];
  let cx = 0, cy = 0; for (const [x, y] of ring) { cx += x; cy += y; } cx /= ring.length; cy /= ring.length;
  if (inside(ring, cx, cy)) return [cx, cy];
  const xs = []; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [x1, y1] = ring[i], [x2, y2] = ring[j]; if ((y1 > cy) !== (y2 > cy)) xs.push(x1 + ((cy - y1) * (x2 - x1)) / (y2 - y1)); }
  xs.sort((a, b) => a - b); let best = null, w = -1; for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > w) { w = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, cy]; }
  return best || ring[0];
}
function inside(ring, x, y) { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; }
function inGeom(g, x, y) { const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates; return polys.some((p) => inside(p[0], x, y) && !p.slice(1).some((h) => inside(h, x, y))); }

let enabled = false; const shown = {};
async function show(id) {
  if (shown[id]) return; shown[id] = true;
  const p = load(id); track(`Watersheds ${id.toUpperCase()}`, p); const fc = await p;
  if (!fc) { shown[id] = false; return; }
  setOverlay(id, fc);
  setOverlay(id + "-lbl", { type: "FeatureCollection", features: fc.features.map((f) => ({ type: "Feature", geometry: { type: "Point", coordinates: labelPoint(f.geometry) }, properties: { label: f.properties.name } })) });
}
function refresh() { if (!enabled) return; const z = map.getZoom(); for (const L of HUC_LEVELS) if (z >= L.minzoom - 0.5) show(L.id); }
export function initHuc() { map.on("moveend", debounce(refresh, 300)); }
export function setHucEnabled(on) { enabled = on; if (on) refresh(); emit("layer:status", { name: "huc", text: on ? "Watersheds: USGS WBD" : "" }); }

// Which HUC-8/10/12 contain a point (for the Point panel header)
export async function hucsAt(lon, lat) {
  const out = [];
  for (const L of HUC_LEVELS) {
    const fc = await load(L.id); const f = fc?.features.find((f) => inGeom(f.geometry, lon, lat));
    if (f) out.push({ level: L, name: f.properties.name, code: f.properties.code, sqmi: f.properties.areasqkm / 2.58999 });
  }
  return out;
}
export function hucLineHtml(list) {
  if (!list.length) return "";
  return `Watershed: ${list.slice().reverse().map((h) => `<span title="${escapeHtml(h.level.label)} ${escapeHtml(h.code)} · ${fmt(h.sqmi, h.sqmi < 100 ? 1 : 0)} mi²"><b>${escapeHtml(h.name)}</b> <span class="small">HUC-${h.code.length} ${escapeHtml(h.code)}</span></span>`).join(" · ")}`;
}
export function hucLegendHtml() {
  return `<h4>Watersheds (USGS WBD)</h4>${HUC_LEVELS.map((L) => `<div class="legend-row"><span class="swatch sq" style="background:none;border:${L.id === "huc8" ? 2.5 : 1.5}px ${L.id === "huc8" ? "solid" : "dashed"} ${L.color}"></span>${L.label}${L.minzoom ? ` (from zoom ${L.minzoom})` : ""}</div>`).join("")}
    <div class="small">USGS Watershed Boundary Dataset, snapshot kept in the site and refreshed monthly. Click a point to see the HUC-8, HUC-10 and HUC-12 it falls in.</div>`;
}
