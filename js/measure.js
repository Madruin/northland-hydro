// Distance / area measuring tool. Click to add vertices, double-click (or Enter) to finish, Esc to clear.
// Lengths and areas are computed on the UTM 15N (NAD83) plane via proj4, which is exact enough for the region.
import { UTM15, toUtm } from "./coords.js";
import { profile } from "./elevation.js";
import { plot } from "./loader.js";
import { plotlyLayout, downloadCSV } from "./util.js";

const M2FT = 3937 / 1200; // metres → US survey feet
const RULER = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17 17 3l4 4L7 21z"/><path d="M14 6l2 2M11 9l2 2M8 12l2 2"/></svg>`;
const AREA = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 6l7-3 9 5-3 12-11-2z"/><circle cx="4" cy="6" r="1.4" fill="currentColor"/><circle cx="11" cy="3" r="1.4" fill="currentColor"/><circle cx="20" cy="8" r="1.4" fill="currentColor"/><circle cx="17" cy="20" r="1.4" fill="currentColor"/><circle cx="6" cy="18" r="1.4" fill="currentColor"/></svg>`;

function fmtLen(m) { const ft = m * M2FT; return ft >= 5280 * 0.75 ? `${(ft / 5280).toFixed(2)} mi (${Math.round(ft).toLocaleString()} ft)` : `${ft < 100 ? ft.toFixed(1) : Math.round(ft).toLocaleString()} ft`; }
function fmtArea(m2) { const ft2 = m2 * M2FT * M2FT, ac = ft2 / 43560; return ac >= 640 * 0.5 ? `${(ac / 640).toFixed(2)} mi² (${Math.round(ac).toLocaleString()} ac)` : ac >= 0.5 ? `${ac.toFixed(2)} ac (${Math.round(ft2).toLocaleString()} ft²)` : `${Math.round(ft2).toLocaleString()} ft² (${ac.toFixed(3)} ac)`; }

export class MeasureControl {
  constructor() { this.mode = null; this.pts = []; this.hover = null; }
  onAdd(map) {
    this.map = map;
    const c = document.createElement("div"); c.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this.bLine = this.mkBtn(c, RULER, "Measure distance (click points, double-click to finish, Esc to clear)", "line");
    this.bArea = this.mkBtn(c, AREA, "Measure area (click corners, double-click to finish, Esc to clear)", "area");
    this.container = c;
    this.box = document.createElement("div"); this.box.id = "measure-box"; this.box.className = "floating"; this.box.hidden = true;
    document.getElementById("map-wrap").append(this.box);
    map.on("style.load", () => this.ensureLayers());
    map.on("click", (e) => this.onClick(e));
    map.on("dblclick", (e) => { if (this.mode) { e.preventDefault(); this.finish(); } });
    map.on("mousemove", (e) => { if (this.mode && this.pts.length && !this.done) { this.hover = [e.lngLat.lng, e.lngLat.lat]; this.draw(); } });
    document.addEventListener("keydown", (e) => { if (!this.mode) return; if (e.key === "Escape") this.clear(); else if (e.key === "Enter") this.finish(); });
    return c;
  }
  onRemove() { this.container.remove(); this.box.remove(); }
  mkBtn(c, icon, title, mode) { const b = document.createElement("button"); b.type = "button"; b.title = title; b.setAttribute("aria-label", title); b.innerHTML = icon; b.addEventListener("click", () => this.toggle(mode)); c.append(b); return b; }
  toggle(mode) { if (this.mode === mode) { this.exit(); return; } this.exit(); this.mode = mode; this.pts = []; this.done = false; document.body.classList.add("measuring"); (mode === "line" ? this.bLine : this.bArea).classList.add("active"); this.map.doubleClickZoom.disable(); this.map.getCanvas().style.cursor = "crosshair"; this.ensureLayers(); this.showBox(); }
  exit() { const pb = document.getElementById("profile-box"); if (pb) pb.hidden = true; this.clearData(); this.mode = null; document.body.classList.remove("measuring"); this.bLine.classList.remove("active"); this.bArea.classList.remove("active"); this.map.doubleClickZoom.enable(); this.map.getCanvas().style.cursor = ""; this.box.hidden = true; }
  clear() { this.pts = []; this.hover = null; this.done = false; this.draw(); this.showBox(); }
  clearData() { this.pts = []; this.hover = null; this.done = false; if (this.map.getSource("measure")) this.map.getSource("measure").setData({ type: "FeatureCollection", features: [] }); }
  onClick(e) { if (!this.mode) return; if (this.done) { this.pts = []; this.done = false; } this.pts.push([e.lngLat.lng, e.lngLat.lat]); this.hover = null; this.draw(); this.showBox(); }
  finish() { if (this.pts.length < 2) return; this.done = true; this.hover = null; this.draw(); this.showBox(); }
  async showProfile() {
    if (this.pts.length < 2) return; if (!this.done) this.finish();
    let pb = document.getElementById("profile-box");
    if (!pb) { pb = document.createElement("div"); pb.id = "profile-box"; pb.className = "floating"; document.getElementById("map-wrap").append(pb); }
    pb.hidden = false; pb.innerHTML = `<div class="mb-title">Elevation profile <button class="mb-x" title="Close">✕</button></div><div class="spinner">Sampling lidar…</div>`;
    pb.querySelector(".mb-x").addEventListener("click", () => (pb.hidden = true));
    const res = await profile(this.pts, 300);
    if (!res) { pb.innerHTML = `<div class="mb-title">Elevation profile <button class="mb-x">✕</button></div><div class="notice">No lidar coverage along this line.</div>`; pb.querySelector(".mb-x").addEventListener("click", () => (pb.hidden = true)); return; }
    const s = res.samples; const ft = (m) => m * 3937 / 1200;
    const zs = s.map((p) => p.ft); const zmin = Math.min(...zs), zmax = Math.max(...zs); const L = s[s.length - 1].d;
    let rise = 0, fall = 0; for (let i = 1; i < s.length; i++) { const dz = s[i].ft - s[i - 1].ft; if (dz > 0) rise += dz; else fall -= dz; }
    const slope = L ? ((s[s.length - 1].ft - s[0].ft) / ft(L)) * 100 : 0;
    pb.innerHTML = `<div class="mb-title">Elevation profile <span class="small">${res.src} · NAVD88</span> <button class="mb-x" title="Close">✕</button></div>
      <div class="pf-stats small">length ${Math.round(ft(L)).toLocaleString()} ft · start ${s[0].ft.toFixed(1)} → end ${s[s.length - 1].ft.toFixed(1)} ft (${slope >= 0 ? "+" : ""}${slope.toFixed(2)}%) · low ${zmin.toFixed(1)} · high ${zmax.toFixed(1)} · rise ${rise.toFixed(1)} / fall ${fall.toFixed(1)} ft</div>
      <div id="profile-chart" class="pf-chart"></div>
      <div class="mb-actions"><button class="btn" id="pf-csv">Download CSV</button><span class="small">Station (ft), elevation (ft), lat, lon; 0.5 m samples, first-return-free ground DEM.</span></div>`;
    pb.querySelector(".mb-x").addEventListener("click", () => (pb.hidden = true));
    document.getElementById("pf-csv").addEventListener("click", () => downloadCSV(`profile_${new Date().toISOString().slice(0, 10)}.csv`, [["station_ft", "elev_ft_navd88", "lat", "lon"], ...s.map((p) => [ft(p.d).toFixed(1), p.ft.toFixed(2), p.lat.toFixed(6), p.lon.toFixed(6)])]));
    plot("profile-chart", [{ x: s.map((p) => ft(p.d)), y: zs, mode: "lines", fill: "tozeroy", line: { color: "#f59e0b", width: 2 }, fillcolor: "rgba(245,158,11,.15)", name: "ground", hovertemplate: "%{x:.0f} ft · %{y:.1f} ft<extra></extra>" }],
      plotlyLayout({ showlegend: false, margin: { l: 48, r: 8, t: 6, b: 30 }, xaxis: { title: "station, ft" }, yaxis: { title: "ft NAVD88", range: [zmin - (zmax - zmin) * 0.1 - 1, zmax + (zmax - zmin) * 0.1 + 1] } }), { displayModeBar: false, responsive: true });
  }
  ensureLayers() {
    const m = this.map; if (!m.getStyle()) return;
    if (m.getSource("measure")) return;
    m.addSource("measure", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addLayer({ id: "measure-fill", type: "fill", source: "measure", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#f59e0b", "fill-opacity": 0.18 } });
    m.addLayer({ id: "measure-line", type: "line", source: "measure", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#f59e0b", "line-width": 2.5 } });
    m.addLayer({ id: "measure-pts", type: "circle", source: "measure", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 4, "circle-color": "#fff", "circle-stroke-color": "#f59e0b", "circle-stroke-width": 2 } });
    m.addLayer({ id: "measure-labels", type: "symbol", source: "measure", filter: ["has", "label"], layout: { "text-field": ["get", "label"], "text-size": 11, "text-font": ["Noto Sans Bold"], "text-offset": [0, -1], "text-allow-overlap": true }, paint: { "text-color": "#7c2d12", "text-halo-color": "#fff", "text-halo-width": 1.5 } });
  }
  stats() {
    const pts = this.hover && !this.done ? [...this.pts, this.hover] : this.pts;
    const u = pts.map((p) => toUtm(p[0], p[1]));
    let len = 0; const segs = [];
    for (let i = 1; i < u.length; i++) { const d = Math.hypot(u[i][0] - u[i - 1][0], u[i][1] - u[i - 1][1]); len += d; segs.push(d); }
    let area = 0, perim = len;
    if (this.mode === "area" && u.length >= 3) { for (let i = 0; i < u.length; i++) { const a = u[i], b = u[(i + 1) % u.length]; area += a[0] * b[1] - b[0] * a[1]; } area = Math.abs(area) / 2; perim += Math.hypot(u[0][0] - u[u.length - 1][0], u[0][1] - u[u.length - 1][1]); }
    return { pts, len, segs, area, perim };
  }
  draw() {
    if (!this.map.getSource("measure")) this.ensureLayers();
    const { pts, segs, area } = this.stats();
    const feats = pts.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} }));
    if (pts.length >= 2) {
      feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: this.mode === "area" && pts.length >= 3 ? [...pts, pts[0]] : pts }, properties: {} });
      for (let i = 1; i < pts.length; i++) feats.push({ type: "Feature", geometry: { type: "Point", coordinates: [(pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2] }, properties: { label: fmtLen(segs[i - 1]) } });
    }
    if (this.mode === "area" && pts.length >= 3) feats.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] }, properties: { area } });
    this.map.getSource("measure").setData({ type: "FeatureCollection", features: feats });
  }
  showBox() {
    const { len, area, perim } = this.stats(); const n = this.pts.length;
    const touch = window.matchMedia("(pointer: coarse)").matches; const tap = touch ? "Tap" : "Click";
    const help = n === 0 ? `${tap} the map to start ${this.mode === "area" ? "an area" : "a distance"}.` : this.done ? `${tap} the map to start a new measurement.` : touch ? "Keep tapping corners, then Finish." : "Double-click or Enter to finish · Esc clears · or use the buttons.";
    this.box.hidden = false;
    this.box.innerHTML = `<div class="mb-title">${this.mode === "area" ? "Area" : "Distance"} <button class="mb-x" title="Close">✕</button></div>
      ${n ? (this.mode === "area" ? `<div class="mb-v">${n >= 3 ? fmtArea(area) : "–"}</div><div class="small">perimeter ${fmtLen(perim)} · ${n} corners</div>` : `<div class="mb-v">${fmtLen(len)}</div><div class="small">${n} points</div>`) : ""}
      <div class="small">${help}</div>
      ${n ? `<div class="mb-actions">${!this.done && n >= (this.mode === "area" ? 3 : 2) ? `<button class="btn primary" data-a="finish">Finish</button>` : ""}${this.mode === "line" && n >= 2 ? `<button class="btn ${this.done ? "primary" : ""}" data-a="profile" title="Elevation profile along this line from the lidar">Profile</button>` : ""}<button class="btn" data-a="clear">Clear</button></div>` : ""}`;
    this.box.querySelector(".mb-x").addEventListener("click", () => this.exit());
    this.box.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => (b.dataset.a === "finish" ? this.finish() : b.dataset.a === "profile" ? this.showProfile() : this.clear())));
  }
}
