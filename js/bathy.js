// Lake depth from MN DNR bathymetric surveys (MnGeo us_mn_state_dnr/water_lake_bathymetry): depth contours drawn on the
// map (colored by depth, labeled), and in the Lake section the depth at the clicked spot, the deepest surveyed contour,
// and "depth along a line": click two points (a fetch line) for its length, mean and max depth and a depth profile,
// for fetch and wave run-up calculations. Depths are feet below the lake surface at survey time.
import { $, escapeHtml, fmt, fmtNum, haversineKm, plotlyLayout } from "./util.js";
import { map, setPickMode, isTiled } from "./map.js";
import { plot } from "./loader.js";

const B = "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/water_lake_bathymetry/MapServer";
const MINZOOM = 11;
let on = false, onChange = () => {};
const feats = new Map(); // objectid → contour feature
const empty = { type: "FeatureCollection", features: [] };

// ---------- point and line sampling ----------
export async function depthAt(lon, lat) {
  const q = new URLSearchParams({ geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryPoint", sr: "4326", layers: "all:3", tolerance: "1",
    mapExtent: `${lon - 0.01},${lat - 0.01},${lon + 0.01},${lat + 0.01}`, imageDisplay: "400,400,96", returnGeometry: "false", f: "json" });
  const r = await fetch(`${B}/identify?${q}`); if (!r.ok) throw new Error(`DNR bathymetry ${r.status}`);
  const v = Number((await r.json()).results?.[0]?.attributes?.["Stretch.Pixel Value"]);
  return Number.isFinite(v) ? Math.max(0, -v) : null; // the model stores depth as a negative number of feet
}
async function lakeSurvey(dow) {
  const q = (layer, fields) => fetch(`${B}/${layer}/query?${new URLSearchParams({ where: `dowlknum='${dow.replace(/'/g, "")}'`, outFields: fields, returnGeometry: "false", f: "json" })}`).then((r) => r.json());
  const [c, m] = await Promise.all([q(0, "abs_depth"), q(2, "lake_name,fldw_end,data_src")]);
  const depths = (c.features || []).map((f) => f.attributes.abs_depth).filter((v) => v != null);
  return { max: depths.length ? Math.max(...depths) : null, interval: depths.length ? Math.min(...depths.filter((d) => d > 0)) : null, meta: m.features?.[0]?.attributes || null };
}

// ---------- Lake section ----------
export async function renderLakeDepth(box, { lon, lat, dow }) {
  if (!box) return;
  if (!dow) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="spinner">Lake depth (DNR bathymetry)…</div>`;
  let s, here;
  try { [s, here] = await Promise.all([lakeSurvey(dow), depthAt(lon, lat).catch(() => null)]); } catch (e) { box.innerHTML = `<div class="small">Lake depth unavailable: ${escapeHtml(e.message)}</div>`; return; }
  if (!box.isConnected) return;
  if (s.max == null) { box.innerHTML = `<h3>Lake depth</h3><div class="small">No DNR bathymetric survey for this lake.</div>`; return; }
  const yr = String(s.meta?.fldw_end || "").match(/(19|20)\d\d/)?.[0] || null; // the field is free text ("9/9/", "1987", ...)
  box.innerHTML = `<h3>Lake depth · DNR bathymetric survey</h3>
    <div class="stat-row">
      <div class="stat"><div class="v">${here != null ? fmt(here, 1) : "–"}</div><div class="l">depth here, ft</div><div class="s">${here == null ? "outside the surveyed area" : "from the survey's depth model"}</div></div>
      <div class="stat"><div class="v">${fmtNum(s.max, 0)}</div><div class="l">deepest contour, ft</div><div class="s">${s.interval ? `${fmtNum(s.interval, 0)} ft contours` : ""}</div></div>
    </div>
    <div class="actions"><button class="btn" id="bz-line" title="Click two points on the lake; reports the line's length and its mean and maximum depth, for fetch and wave run-up">📏 Depth along a line</button> <button class="btn" id="bz-layer">${on ? "Hide" : "Show"} depth contours</button></div>
    <div id="bz-out"></div>
    <div class="small">Depths are feet below the lake surface when surveyed${yr ? ` (${yr})` : ""}${s.meta?.data_src ? ` (source: ${escapeHtml(String(s.meta.data_src).toLowerCase())})` : ""}. Add the difference between today's level and the survey level before design use.</div>`;
  $("bz-layer").onclick = () => { setBathy(!on); $("bz-layer").textContent = `${on ? "Hide" : "Show"} depth contours`; };
  $("bz-line").onclick = () => drawLine($("bz-out"));
}

// Two clicks → sampled depth profile
function drawLine(out) {
  const pts = [];
  out.innerHTML = `<div class="notice">Click the start of the line on the map.</div>`;
  const pick = () => setPickMode(async ({ lon, lat }) => {
    pts.push([lon, lat]); showLine(pts);
    if (pts.length < 2) { out.innerHTML = `<div class="notice">Now click the end of the line.</div>`; pick(); return; }
    await profile(out, pts[0], pts[1]);
  });
  pick();
}
function showLine(pts) {
  const fc = { type: "FeatureCollection", features: [...pts.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} })), ...(pts.length > 1 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: pts }, properties: {} }] : [])] };
  if (!map.getSource("bathy-line")) {
    map.addSource("bathy-line", { type: "geojson", data: fc });
    map.addLayer({ id: "bathy-line", type: "line", source: "bathy-line", paint: { "line-color": "#f43f5e", "line-width": 2.5 } });
    map.addLayer({ id: "bathy-line-pts", type: "circle", source: "bathy-line", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-color": "#f43f5e", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
  } else map.getSource("bathy-line").setData(fc);
}
async function profile(out, a, b) {
  const km = haversineKm(a[1], a[0], b[1], b[0]); const ft = km * 3280.84;
  const n = Math.max(12, Math.min(60, Math.round(ft / 50)));
  out.innerHTML = `<div class="spinner">Sampling depth at ${n} points along ${fmtNum(ft, 0)} ft…</div>`;
  const samples = Array.from({ length: n + 1 }, (_, i) => ({ t: i / n, lon: a[0] + ((b[0] - a[0]) * i) / n, lat: a[1] + ((b[1] - a[1]) * i) / n, d: null }));
  for (let i = 0; i < samples.length; i += 8) await Promise.all(samples.slice(i, i + 8).map(async (s) => { s.d = await depthAt(s.lon, s.lat).catch(() => null); }));
  if (!out.isConnected) return;
  const wet = samples.filter((s) => s.d != null);
  if (!wet.length) { out.innerHTML = `<div class="notice">No surveyed lake depth along that line.</div>`; return; }
  const mean = wet.reduce((x, s) => x + s.d, 0) / wet.length, max = Math.max(...wet.map((s) => s.d));
  const id = "bz-chart-" + Math.random().toString(36).slice(2, 7);
  out.innerHTML = `<div class="stat-row">
      <div class="stat"><div class="v">${ft >= 5280 ? fmt(ft / 5280, 2) : fmtNum(ft, 0)}</div><div class="l">line length, ${ft >= 5280 ? "mi" : "ft"}</div><div class="s">${ft >= 5280 ? `${fmtNum(ft, 0)} ft` : `${fmt(ft / 5280, 2)} mi`}</div></div>
      <div class="stat"><div class="v">${fmt(mean, 1)}</div><div class="l">mean depth along it, ft</div><div class="s">${wet.length} of ${samples.length} samples on surveyed water</div></div>
      <div class="stat"><div class="v">${fmt(max, 1)}</div><div class="l">max depth, ft</div></div>
    </div><div id="${id}" class="chart"></div>
    <div class="small">Mean depth is the average of the samples on surveyed water (points on land or outside the survey are left out). For a fetch, draw the line across open water to the shore the wind blows toward.</div>
    <div class="actions"><button class="btn" id="bz-again">Draw another line</button></div>`;
  plot(id, [{ x: samples.map((s) => (s.t * ft).toFixed(0)), y: samples.map((s) => (s.d == null ? null : -s.d)), type: "scatter", mode: "lines", fill: "tozeroy", line: { color: "#38bdf8" }, connectgaps: false, hovertemplate: "%{x} ft: %{y:.1f} ft<extra></extra>" }],
    plotlyLayout({ title: "Depth along the line (ft below the surface)", xaxis: { title: "ft from start" }, yaxis: { title: "ft" }, showlegend: false }), { displayModeBar: false, responsive: true });
  $("bz-again").onclick = () => drawLine(out);
}

// ---------- map layer: depth contours ----------
// From the site's vector tiles at every zoom (tools/build_tiles.py group "bathy", built monthly on Railway); without
// them, the contours in view are queried live from zoom 11.
const COLOR = ["interpolate", ["linear"], ["get", "abs_depth"], 0, "#7dd3fc", 10, "#38bdf8", 20, "#0ea5e9", 40, "#0369a1", 80, "#0c4a6e"];
const tiled = () => isTiled("bathy");
function ensureLayers() {
  if (!map?.getStyle() || map.getSource("bathy")) return;
  const vis = { visibility: on ? "visible" : "none" };
  if (tiled()) map.addSource("bathy", { type: "vector", url: "pmtiles://" + new URL("data/tiles/bathy.pmtiles", location.href).href, attribution: "MN DNR lake bathymetry" });
  else map.addSource("bathy", { type: "geojson", data: on ? { type: "FeatureCollection", features: [...feats.values()] } : empty, attribution: "MN DNR lake bathymetry" });
  const sl = tiled() ? { "source-layer": "bathy" } : {};
  map.addLayer({ id: "bathy-contours", type: "line", source: "bathy", ...sl, minzoom: tiled() ? 0 : MINZOOM, layout: vis, paint: { "line-color": COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.5, 11, 0.9, 15, 1.6] } });
  map.addLayer({ id: "bathy-labels", type: "symbol", source: "bathy", ...sl, minzoom: 13, filter: [">", ["get", "abs_depth"], 0], layout: { ...vis, "symbol-placement": "line", "text-field": ["concat", ["to-string", ["get", "abs_depth"]], "'"], "text-size": 10.5, "text-font": ["Noto Sans Regular"], "symbol-spacing": 280 }, paint: { "text-color": "#0c4a6e", "text-halo-color": "#fff", "text-halo-width": 1.3 } });
}
let loading = null;
async function load() {
  if (!on || !map || tiled() || map.getZoom() < MINZOOM - 0.01) return;
  const b = map.getBounds(); const z = map.getZoom();
  const q = new URLSearchParams({ geometry: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(5)).join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects",
    outFields: "objectid,abs_depth,lake_name", returnGeometry: "true", geometryPrecision: "6", maxAllowableOffset: String(z >= 14 ? 0.00002 : z >= 12 ? 0.00008 : 0.0002), resultRecordCount: "2000", f: "geojson" });
  const p = (loading = fetch(`${B}/0/query?${q}`).then((r) => r.json()));
  try { const d = await p; if (p !== loading) return; for (const f of d.features || []) feats.set(f.properties.objectid ?? f.id, f); if (feats.size > 30000) [...feats.keys()].slice(0, feats.size - 30000).forEach((k) => feats.delete(k)); map.getSource("bathy")?.setData({ type: "FeatureCollection", features: [...feats.values()] }); }
  catch (e) { console.warn("bathymetry contours", e); }
}
export function setBathy(v) {
  on = !!v; try { localStorage.setItem("nh-bathy", on ? "1" : "0"); } catch {}
  $("tg-bathy")?.classList.toggle("on", on);
  for (const id of ["bathy-contours", "bathy-labels"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  if (!tiled()) map.getSource("bathy")?.setData(on ? { type: "FeatureCollection", features: [...feats.values()] } : empty);
  if (on) load(); onChange();
}
export const bathyOn = () => on;
export function bathyLegendHtml() {
  if (!on) return "";
  return `<h4>Lake depth (DNR survey)</h4><div class="legend-row"><span class="swatch sq" style="background:linear-gradient(90deg,#7dd3fc,#0ea5e9,#0369a1,#0c4a6e)"></span>shallow → 80+ ft contours</div><div class="small">${tiled() ? "Every zoom; labels" : `From zoom ${MINZOOM}; labels`} from zoom 13, in ft below the surface at survey time.${!tiled() && map && map.getZoom() < MINZOOM ? ` Zoom in to see them.` : ""}</div>`;
}
export function initBathy({ onChange: cb } = {}) {
  onChange = cb || onChange;
  try { on = localStorage.getItem("nh-bathy") === "1"; } catch {}
  $("tg-bathy")?.classList.toggle("on", on);
  $("tg-bathy")?.addEventListener("click", () => setBathy(!on));
  map.on("style.load", () => { ensureLayers(); }); map.once("idle", ensureLayers); try { ensureLayers(); } catch {}
  let t = null; map.on("moveend", () => { clearTimeout(t); t = setTimeout(load, 300); });
  if (on) load();
  onChange(); // legend and the Layers count when it was left on last visit
}
