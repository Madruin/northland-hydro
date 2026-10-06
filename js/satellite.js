// NASA satellite layers that need no login: GIBS map tiles (gibs.earthdata.nasa.gov, CORS-open) plus CMR granule
// search for the dates of clear 30 m scenes. Five layers, each with its own date or period picker in the Layers menu:
//   hls   Harmonized Landsat Sentinel-2 true color, 30 m, a clear scene every few days (also offered in Compare)
//   daily VIIRS (NOAA-20) true color, 375 m, every day: Lake Superior plumes, ice, smoke, snow
//   snow  VIIRS snow cover (NDSI), 375 m, daily
//   dist  OPERA vegetation disturbance, 30 m, annual summaries (loss of vegetation cover against a multi-year baseline)
//   fire  VIIRS active fire / hot-spot detections (NOAA-20, NOAA-21, Suomi NPP), rendered by GIBS WMS
// GIBS tiles are pictures, not values; nothing here feeds a calculation. See docs/earthdata_audit.md.
import { map } from "./map.js";
import { $, escapeHtml } from "./util.js";

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const WMS = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi";
const CMR = "https://cmr.earthdata.nasa.gov/search/granules.json";
const tileUrl = (layer, date, level, ext) => `${GIBS}/${layer}/default/${date}/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.${ext}`;
const EMPTY_PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)).buffer;
const CREDIT = "NASA GIBS / Earthdata";

// GIBS paints some classes opaque (vegetation "no disturbance" near-black; snow-product water, night and fill).
// nasakey://<key>/<https url without scheme> fetches the tile and makes those colors transparent (or translucent).
const KEYS = {
  dist: { "18,18,18": [0, 0, 0, 0], "0,0,0": [0, 0, 0, 0] },
  snow: { "0,0,255": [0, 0, 0, 0], "35,35,117": [0, 0, 0, 0], "255,255,255": [0, 0, 0, 0], "255,200,255": [0, 0, 0, 0], "189,0,189": [0, 0, 0, 0], "0,255,0": [0, 0, 0, 0],
    "0,191,255": [148, 163, 184, 90], "200,200,200": [148, 163, 184, 90] }, // cloud and "no decision": faint gray, so gaps read as gaps
};
function addProtocol() {
  if (window.__nasakey) return; window.__nasakey = true;
  maplibregl.addProtocol("nasakey", async (params, abort) => {
    const m = params.url.match(/^nasakey:\/\/(\w+)\/(.+)$/); if (!m) throw new Error("bad nasakey url");
    const r = await fetch("https://" + m[2], { signal: abort?.signal });
    if (r.status === 404 || r.status === 400) return { data: EMPTY_PNG };
    if (!r.ok) throw new Error(`NASA tile ${r.status}`);
    const bmp = await createImageBitmap(await r.blob()); const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext("2d");
    x.drawImage(bmp, 0, 0); const img = x.getImageData(0, 0, c.width, c.height); const d = img.data; const key = KEYS[m[1]] || {};
    for (let i = 0; i < d.length; i += 4) { const k = key[`${d[i]},${d[i + 1]},${d[i + 2]}`]; if (k) { d[i] = k[0]; d[i + 1] = k[1]; d[i + 2] = k[2]; d[i + 3] = k[3]; } }
    x.putImageData(img, 0, 0); return { data: await (await c.convertToBlob({ type: "image/png" })).arrayBuffer() };
  });
}

// ---------- dates ----------
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => iso(new Date(Date.now() - n * 864e5));
const nice = (s, opts = { month: "short", day: "numeric" }) => new Date(s + "T12:00:00Z").toLocaleDateString(undefined, opts);
const recentDays = (n) => Array.from({ length: n }, (_, i) => daysAgo(i + 1)); // yesterday first: today's pass is often incomplete

// 30 m scenes with little cloud over a point (CMR, no login). One entry per day, the lower-cloud sensor wins.
let scenes = [], scenesAt = null, scenesP = null;
export async function hlsScenes(lon = map.getCenter().lng, lat = map.getCenter().lat) {
  if (scenesAt && Math.hypot((lon - scenesAt[0]) * Math.cos((lat * Math.PI) / 180), lat - scenesAt[1]) * 111 < 40) return scenesP || scenes;
  scenesAt = [lon, lat];
  scenesP = (async () => {
    const q = `short_name=HLSS30&short_name=HLSL30&point=${lon.toFixed(4)},${lat.toFixed(4)}&temporal=${daysAgo(150)}T00:00:00Z,&cloud_cover=0,40&sort_key=-start_date&page_size=200`;
    const r = await fetch(`${CMR}?${q}`); if (!r.ok) throw new Error(`NASA CMR ${r.status}`);
    const by = {};
    for (const g of (await r.json()).feed?.entry || []) {
      const date = g.time_start.slice(0, 10), sensor = /\.L30\./.test(g.producer_granule_id) ? "L30" : "S30", cloud = Number(g.cloud_cover ?? 100);
      if (!by[date] || cloud < by[date].cloud) by[date] = { date, sensor, cloud };
    }
    scenes = Object.values(by).sort((a, b) => b.date.localeCompare(a.date)); return scenes;
  })().finally(() => { scenesP = null; });
  return scenesP;
}
const hlsLayer = (s) => (s.sensor === "L30" ? "HLS_L30_Nadir_BRDF_Adjusted_Reflectance" : "HLS_S30_Nadir_BRDF_Adjusted_Reflectance");
const sceneLabel = (s) => `${nice(s.date, { month: "short", day: "numeric", year: "numeric" })} · ${s.sensor === "L30" ? "Landsat" : "Sentinel-2"} · ${Math.round(s.cloud)}% cloud`;
// A style for the Compare control's right-hand map
export function hlsStyle(s) {
  return { version: 8, sources: { hls: { type: "raster", tiles: [tileUrl(hlsLayer(s), s.date, 12, "png")], tileSize: 256, maxzoom: 12, attribution: `NASA HLS ${s.date} via GIBS` } },
    layers: [{ id: "bg", type: "background", paint: { "background-color": "#1f2937" } }, { id: "hls", type: "raster", source: "hls" }] };
}
export const hlsSceneLabel = sceneLabel;

// ---------- layers ----------
const DEFS = {
  hls: { label: "Satellite imagery, 30 m", opacity: 1, below: true },
  daily: { label: "Daily satellite, 375 m", opacity: 1, below: true },
  snow: { label: "Snow cover", opacity: 0.8, below: true },
  dist: { label: "Vegetation loss", opacity: 0.9, below: true },
  fire: { label: "Fire detections", opacity: 1, below: false },
};
const st = { hls: { on: false, date: null }, daily: { on: false, date: null }, snow: { on: false, date: null }, dist: { on: false, year: "2025" }, fire: { on: false, days: 1 } };
let onChange = () => {};
function sources(k) { // [ [sourceId, sourceSpec], ... ]
  const s = st[k];
  if (k === "hls") { const sc = scenes.find((x) => x.date === s.date); return sc ? [["sat-hls", { type: "raster", tiles: [tileUrl(hlsLayer(sc), sc.date, 12, "png")], tileSize: 256, maxzoom: 12, attribution: `NASA HLS (Landsat/Sentinel-2) via GIBS` }]] : []; }
  if (k === "daily") return [["sat-daily", { type: "raster", tiles: [tileUrl("VIIRS_NOAA20_CorrectedReflectance_TrueColor", s.date || daysAgo(1), 9, "jpg")], tileSize: 256, maxzoom: 9, attribution: `NASA VIIRS (NOAA-20) via GIBS` }]];
  if (k === "snow") return [["sat-snow", { type: "raster", tiles: ["nasakey://snow/" + tileUrl("VIIRS_NOAA20_NDSI_Snow_Cover", s.date || daysAgo(1), 8, "png").replace("https://", "")], tileSize: 256, maxzoom: 8, attribution: `NASA VIIRS snow cover via GIBS` }]];
  if (k === "dist") return [["sat-dist", { type: "raster", tiles: ["nasakey://dist/" + tileUrl("OPERA_L3_DIST-ANN-HLS_Color_Index", `${s.year}-01-01`, 12, "png").replace("https://", "")], tileSize: 256, maxzoom: 12, attribution: `NASA/JPL OPERA DIST via GIBS` }]];
  if (k === "fire") { // one WMS image per UTC day (GIBS does not merge a date range); today's partial day included
    const days = Array.from({ length: s.days + 1 }, (_, i) => daysAgo(i));
    return days.map((d, i) => [`sat-fire-${i}`, { type: "raster", tileSize: 256, attribution: "NASA FIRMS VIIRS via GIBS",
      tiles: [`${WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=VIIRS_NOAA20_Thermal_Anomalies_375m_All,VIIRS_NOAA21_Thermal_Anomalies_375m_All,VIIRS_SNPP_Thermal_Anomalies_375m_All&STYLES=&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&TIME=${d}`] }]);
  }
  return [];
}
function beforeId(k) {
  if (!DEFS[k].below) return undefined;
  const L = map.getStyle().layers; const ids = new Set(L.map((l) => l.id));
  for (const id of ["qpe", "landcover"]) if (ids.has(id)) return id; // under radar and land cover
  return L.find((l) => l.type === "symbol")?.id;
}
function clear(k) { for (const l of [...map.getStyle().layers]) if (l.id === `sat-${k}` || l.id.startsWith(`sat-${k}-`)) map.removeLayer(l.id); for (const id of Object.keys(map.getStyle().sources)) if (id === `sat-${k}` || id.startsWith(`sat-${k}-`)) map.removeSource(id); }
function apply(k) {
  if (!map?.getStyle()) return;
  clear(k); if (!st[k].on) return;
  const b = beforeId(k);
  for (const [id, spec] of sources(k)) { map.addSource(id, spec); map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": DEFS[k].opacity, "raster-fade-duration": 0 } }, b); }
}
const applyAll = () => { for (const k of Object.keys(st)) apply(k); };

// ---------- menu rows ----------
function fillSelect(k) {
  const sel = $(`sat-${k}-sel`); if (!sel) return; const s = st[k];
  if (k === "hls") sel.innerHTML = scenes.length ? scenes.map((x) => `<option value="${x.date}" ${x.date === s.date ? "selected" : ""}>${escapeHtml(sceneLabel(x))}</option>`).join("") : `<option value="">${scenesP ? "Finding clear scenes…" : "Turn on to find clear scenes here"}</option>`;
  if (k === "daily" || k === "snow") sel.innerHTML = recentDays(14).map((d) => `<option value="${d}" ${d === (s.date || daysAgo(1)) ? "selected" : ""}>${nice(d, { weekday: "short", month: "short", day: "numeric" })}</option>`).join("");
  if (k === "dist") sel.innerHTML = ["2025", "2024", "2023"].map((y) => `<option value="${y}" ${y === s.year ? "selected" : ""}>${y} annual</option>`).join("");
  if (k === "fire") sel.innerHTML = [[1, "Last 24 h"], [3, "Last 3 days"], [7, "Last 7 days"]].map(([v, t]) => `<option value="${v}" ${v === s.days ? "selected" : ""}>${t}</option>`).join("");
}
async function refreshScenes() {
  const before = st.hls.date; fillSelect("hls");
  try { await hlsScenes(); } catch (e) { const sel = $("sat-hls-sel"); if (sel) sel.innerHTML = `<option value="">Scene search failed: ${escapeHtml(e.message)}</option>`; return; }
  if (!scenes.some((x) => x.date === st.hls.date)) st.hls.date = scenes[0]?.date || null;
  fillSelect("hls");
  if (st.hls.date !== before || !map.getLayer("sat-hls")) { apply("hls"); onChange(); } // a pan within the same scene changes nothing
}
function setOn(k, on) {
  st[k].on = on; $(`tg-sat-${k}`)?.classList.toggle("on", on);
  if (k === "hls" && on) refreshScenes(); else apply(k);
  save(); onChange();
}
const save = () => { try { localStorage.setItem("nh-sat", JSON.stringify({ on: Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v.on])), dist: st.dist.year, fire: st.fire.days })); } catch {} };
export const satCount = () => Object.values(st).filter((s) => s.on).length;

export function satLegendHtml() {
  const out = [];
  if (st.hls.on) { const sc = scenes.find((x) => x.date === st.hls.date); out.push(`<h4>Satellite 30 m${sc ? ` · ${escapeHtml(sceneLabel(sc))}` : ""}</h4><div class="small">NASA Harmonized Landsat Sentinel-2 true color. 30 m pixels: for change (washouts, plumes, clearing, new ponds), not measurement. Cloud % is for the whole 110 km scene. Swipe two dates in Compare (⇔).</div>`); }
  if (st.daily.on) out.push(`<h4>Daily satellite · ${nice(st.daily.date || daysAgo(1), { month: "short", day: "numeric", year: "numeric" })}</h4><div class="small">NASA VIIRS (NOAA-20) true color, 375 m, one afternoon pass a day: sediment plumes, lake ice, smoke, snow. White is cloud.</div>`);
  if (st.snow.on) out.push(`<h4>Snow cover · ${nice(st.snow.date || daysAgo(1), { month: "short", day: "numeric" })}</h4><div class="legend-row"><span class="swatch sq" style="background:linear-gradient(90deg,rgb(240,240,137),rgb(240,180,137),rgb(240,128,129))"></span>Snow, light → full cover</div><div class="legend-row"><span class="swatch sq" style="background:rgba(148,163,184,.5)"></span>Cloud (no reading)</div><div class="small">NASA VIIRS NDSI snow cover, 375 m. Clear means no snow seen.</div>`);
  if (st.dist.on) out.push(`<h4>Vegetation loss · ${st.dist.year}</h4><div class="legend-row"><span class="swatch sq" style="background:rgb(224,27,7)"></span>Confirmed loss, ≥ 50% of cover</div><div class="legend-row"><span class="swatch sq" style="background:rgb(222,224,67)"></span>Confirmed loss, &lt; 50%</div><div class="legend-row"><span class="swatch sq" style="background:rgb(221,221,221)"></span><span class="swatch sq" style="background:rgb(119,119,119)"></span>Loss that ended (≥ / &lt; 50%)</div><div class="small">NASA/JPL OPERA DIST, 30 m: vegetation cover below its multi-year baseline during the year (logging, blowdown, fire, beaver flooding, construction).</div>`);
  if (st.fire.on) out.push(`<h4>Fire detections · ${st.fire.days === 1 ? "last 24 h" : `last ${st.fire.days} days`}</h4><div class="legend-row"><span class="swatch" style="background:#ef4444"></span>VIIRS hot spot (375 m)</div><div class="small">NASA FIRMS, NOAA-20, NOAA-21 and Suomi NPP passes; posted within hours. Includes industrial heat and prescribed burns.</div>`);
  return out.join("");
}

export function initSatellite({ onChange: cb } = {}) {
  onChange = cb || onChange; addProtocol();
  try { const v = JSON.parse(localStorage.getItem("nh-sat") || "null"); if (v) { for (const k of Object.keys(st)) st[k].on = !!v.on?.[k]; if (v.dist) st.dist.year = v.dist; if (v.fire) st.fire.days = +v.fire; } } catch {}
  for (const k of Object.keys(st)) {
    fillSelect(k); $(`tg-sat-${k}`)?.classList.toggle("on", st[k].on);
    $(`tg-sat-${k}`)?.addEventListener("click", () => setOn(k, !st[k].on));
    $(`sat-${k}-sel`)?.addEventListener("change", (e) => {
      const v = e.target.value; if (k === "dist") st.dist.year = v; else if (k === "fire") st.fire.days = +v; else st[k].date = v || null;
      if (!st[k].on) setOn(k, true); else { apply(k); save(); onChange(); }
    });
  }
  map.on("style.load", applyAll); map.once("idle", applyAll); try { applyAll(); } catch {} // the load event may already have passed
  if (st.hls.on) refreshScenes();
  map.on("moveend", () => { if (st.hls.on) refreshScenes(); }); // scenes are per 110 km tile; re-searched after a long pan
}
