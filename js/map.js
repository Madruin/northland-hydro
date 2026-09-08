// MapLibre map, basemaps, county outlines, QPE raster overlay and point layers.
import { BASEMAPS, COUNTIES, ENDPOINTS, HOME, QPE_LAYERS, REGION_BBOX } from "./config.js";
import { getJSON, emit } from "./util.js";
import { addTerrainLayers, setTerrainVisible as _stv, setTerrainOpacity as _sto } from "./terrain.js";

export let map = null;
let countiesGeo = null;
let currentBasemap = "light";
let overlaysReady = false;
const sources = { stations: { type: "FeatureCollection", features: [] }, gauges: { type: "FeatureCollection", features: [] }, projects: { type: "FeatureCollection", features: [] } };
let pickCallback = null;
let rect = null; // { cb, onFirst, a: [lon,lat] | null }
const visibility = { stations: true, gauges: true, qpe: false };
let terrainVis = {}; let terrainOpacity = 0.6;
let qpeWindow = "24h";
let pinLngLat = null;

export function initMap({ center = HOME.center, zoom = HOME.zoom, basemap = "light" } = {}) {
  currentBasemap = BASEMAPS[basemap] ? basemap : "light";
  map = new maplibregl.Map({
    container: "map", style: BASEMAPS[currentBasemap].style, center, zoom, minZoom: 5, maxZoom: 16,
    attributionControl: { compact: true }, hash: false,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-left");
  map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-right");
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), "top-left");
  map.on("style.load", () => addOverlays());
  map.on("moveend", () => emit("map:moveend", { center: map.getCenter(), zoom: map.getZoom() }));
  map.on("click", (e) => {
    if (rect) {
      if (!rect.a) { rect.a = [e.lngLat.lng, e.lngLat.lat]; rect.onFirst?.(); return; }
      const a = rect.a, b = [e.lngLat.lng, e.lngLat.lat]; const cb = rect.cb; endRect();
      cb([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
      return;
    }
    if (pickCallback) { const cb = pickCallback; pickCallback = null; map.getCanvas().style.cursor = ""; cb({ lon: e.lngLat.lng, lat: e.lngLat.lat }); return; }
    const feats = map.queryRenderedFeatures(e.point, { layers: ["projects-symbol", "stations-circle", "gauges-circle"].filter((l) => map.getLayer(l)) });
    if (feats.length) {
      const f = feats[0];
      if (f.layer.id === "stations-circle") emit("select:station", f.properties);
      else if (f.layer.id === "projects-symbol") emit("select:project", f.properties);
      else emit("select:gauge", f.properties);
    } else {
      emit("select:point", { lon: e.lngLat.lng, lat: e.lngLat.lat });
    }
  });
  for (const layer of ["stations-circle", "gauges-circle", "projects-symbol"]) {
    map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
  }
  map.on("mousemove", (e) => { if (rect?.a) setAoiPreview([rect.a, [e.lngLat.lng, e.lngLat.lat]]); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && rect) { const cb = rect.cb; endRect(); setAoi(null); cb(null); } });
  setupHover();
  return map;
}
function endRect() { rect = null; map.getCanvas().style.cursor = ""; map.dragPan.enable(); }
export function startRectDraw(cb, onFirst) { rect = { cb, onFirst, a: null }; map.getCanvas().style.cursor = "crosshair"; }
function setAoiPreview([a, b]) {
  const ring = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [a[0], a[1]]];
  setAoi({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} });
}
let aoiFeature = null;
export function setAoi(f) { aoiFeature = f; if (map && map.getSource("aoi")) map.getSource("aoi").setData({ type: "FeatureCollection", features: f ? [f] : [] }); }

export function setBasemap(id) {
  if (!BASEMAPS[id] || id === currentBasemap) return;
  currentBasemap = id;
  overlaysReady = false;
  map.setStyle(BASEMAPS[id].style, { diff: false });
}
export const getBasemap = () => currentBasemap;

async function loadCounties() {
  if (countiesGeo) return countiesGeo;
  const topo = await getJSON(ENDPOINTS.counties, { ttl: 86400e3 });
  const all = topojson.feature(topo, topo.objects.counties);
  const wanted = new Map(COUNTIES.map((c) => [c.fips, c]));
  countiesGeo = { type: "FeatureCollection", features: all.features.filter((f) => wanted.has(f.id)).map((f) => ({ ...f, properties: { ...f.properties, fips: f.id, tsa3: !!wanted.get(f.id).tsa3, name: wanted.get(f.id).name } })) };
  return countiesGeo;
}

function qpeTileUrl(win) {
  const layer = QPE_LAYERS[win] ?? QPE_LAYERS["24h"];
  return `${ENDPOINTS.rfcQpe}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&layers=show:${layer}&format=png32&transparent=true&f=image&_t=${Math.floor(Date.now() / 600000)}`;
}

async function addOverlays() {
  // Order: qpe raster (under labels if possible) → counties → gauges → stations → pin
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  if (!map.getSource("qpe")) {
    map.addSource("qpe", { type: "raster", tiles: [qpeTileUrl(qpeWindow)], tileSize: 512, attribution: "NWS RFC QPE" });
    map.addLayer({ id: "qpe", type: "raster", source: "qpe", paint: { "raster-opacity": 0.65 }, layout: { visibility: visibility.qpe ? "visible" : "none" } }, firstSymbol);
  }
  try { addTerrainLayers(map, firstSymbol, terrainVis, terrainOpacity); } catch (e) { console.warn("terrain layers failed", e); }
  try {
    const geo = await loadCounties();
    if (!map.getSource("counties")) {
      map.addSource("counties", { type: "geojson", data: geo });
      map.addLayer({ id: "counties-line", type: "line", source: "counties",
        paint: { "line-color": ["case", ["get", "tsa3"], "#f59e0b", "#94a3b8"], "line-width": ["case", ["get", "tsa3"], 1.8, 0.8], "line-opacity": ["case", ["get", "tsa3"], 0.9, 0.5] } }, firstSymbol);
      map.addLayer({ id: "counties-label", type: "symbol", source: "counties", minzoom: 6.5,
        layout: { "text-field": ["get", "name"], "text-size": 11, "text-transform": "uppercase", "text-letter-spacing": 0.1, "text-font": ["Noto Sans Regular"] },
        paint: { "text-color": currentBasemap === "dark" || currentBasemap === "imagery" ? "#fde68a" : "#92400e", "text-halo-color": currentBasemap === "dark" || currentBasemap === "imagery" ? "#000" : "#fff", "text-halo-width": 1.2, "text-opacity": 0.85 } });
    }
  } catch (e) { console.warn("counties failed", e); }

  if (!map.getSource("gauges")) {
    map.addSource("gauges", { type: "geojson", data: sources.gauges });
    map.addLayer({ id: "gauges-circle", type: "symbol", source: "gauges", layout: { visibility: visibility.gauges ? "visible" : "none",
        "icon-image": "gauge-tri", "icon-size": ["interpolate", ["linear"], ["zoom"], 6, 0.55, 10, 0.9], "icon-allow-overlap": true },
      paint: { "icon-opacity": 0.95 } });
  }
  if (!map.hasImage("gauge-tri")) map.addImage("gauge-tri", triangleImage(), { sdf: true });
  map.setLayoutProperty("gauges-circle", "icon-image", "gauge-tri");
  map.setPaintProperty("gauges-circle", "icon-color", ["get", "color"]);
  map.setPaintProperty("gauges-circle", "icon-halo-color", "#0f172a");
  map.setPaintProperty("gauges-circle", "icon-halo-width", 1);

  if (!map.getSource("stations")) {
    map.addSource("stations", { type: "geojson", data: sources.stations });
    map.addLayer({ id: "stations-circle", type: "circle", source: "stations", layout: { visibility: visibility.stations ? "visible" : "none" },
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 9, 7, 12, 10], "circle-color": ["get", "color"],
        "circle-stroke-color": ["case", ["get", "missing"], "#9e9e9e", "#111827"], "circle-stroke-width": ["case", ["get", "missing"], 1.5, 0.8], "circle-opacity": ["case", ["get", "missing"], 0.35, 0.95] } });
    map.addLayer({ id: "stations-label", type: "symbol", source: "stations", minzoom: 9.5, layout: { visibility: visibility.stations ? "visible" : "none",
        "text-field": ["get", "label"], "text-size": 10, "text-offset": [0, 1.1], "text-anchor": "top", "text-font": ["Noto Sans Regular"], "text-allow-overlap": false },
      paint: { "text-color": currentBasemap === "dark" || currentBasemap === "imagery" ? "#fff" : "#111", "text-halo-color": currentBasemap === "dark" || currentBasemap === "imagery" ? "#000" : "#fff", "text-halo-width": 1 } });
  }
  if (!map.getSource("basin")) {
    map.addSource("basin", { type: "geojson", data: basinGeo() });
    map.addLayer({ id: "basin-fill", type: "fill", source: "basin", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#38bdf8", "fill-opacity": 0.18 } }, firstSymbol);
    map.addLayer({ id: "basin-fill-multi", type: "fill", source: "basin", filter: ["==", ["geometry-type"], "MultiPolygon"], paint: { "fill-color": "#38bdf8", "fill-opacity": 0.18 } }, firstSymbol);
    map.addLayer({ id: "basin-line", type: "line", source: "basin", paint: { "line-color": "#0ea5e9", "line-width": 2.2 } });
  }
  if (!map.hasImage("project-star")) map.addImage("project-star", starImage(), { sdf: true });
  if (!map.getSource("projects")) {
    map.addSource("projects", { type: "geojson", data: sources.projects });
    map.addLayer({ id: "projects-symbol", type: "symbol", source: "projects", layout: { "icon-image": "project-star", "icon-size": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 10, 1], "icon-allow-overlap": true,
        "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top", "text-font": ["Noto Sans Bold"], "text-optional": true },
      paint: { "icon-color": ["get", "color"], "icon-halo-color": "#fff", "icon-halo-width": 1.5, "text-color": "#fff", "text-halo-color": "#0f172a", "text-halo-width": 1.4 } });
  }
  if (!map.getSource("aoi")) {
    map.addSource("aoi", { type: "geojson", data: { type: "FeatureCollection", features: aoiFeature ? [aoiFeature] : [] } });
    map.addLayer({ id: "aoi-fill", type: "fill", source: "aoi", paint: { "fill-color": "#f59e0b", "fill-opacity": 0.12 } });
    map.addLayer({ id: "aoi-line", type: "line", source: "aoi", paint: { "line-color": "#f59e0b", "line-width": 2, "line-dasharray": [2, 1.5] } });
  }
  if (!map.getSource("pin")) {
    map.addSource("pin", { type: "geojson", data: pinGeo() });
    map.addLayer({ id: "pin", type: "circle", source: "pin", paint: { "circle-radius": 7, "circle-color": "#38bdf8", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
  }
  overlaysReady = true;
  emit("map:ready");
}

function triangleImage(size = 28) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(size / 2, 2); ctx.lineTo(size - 2, size - 3); ctx.lineTo(2, size - 3); ctx.closePath(); ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}
function starImage(size = 32) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? size * 0.2 : size * 0.47; const a = -Math.PI / 2 + (i * Math.PI) / 5; ctx.lineTo(size / 2 + r * Math.cos(a), size / 2 + r * Math.sin(a)); }
  ctx.closePath(); ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}
let basinFeatures = [];
function basinGeo() { return { type: "FeatureCollection", features: basinFeatures }; }
export function setBasin(polygonFeature, pourpointFeature) {
  basinFeatures = polygonFeature ? [polygonFeature] : [];
  if (map && map.getSource("basin")) map.getSource("basin").setData(basinGeo());
  if (polygonFeature) {
    const coords = polygonFeature.geometry.type === "Polygon" ? polygonFeature.geometry.coordinates.flat() : polygonFeature.geometry.coordinates.flat(2);
    const xs = coords.map((c) => c[0]), ys = coords.map((c) => c[1]);
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 13 });
  }
}
export function snapshot() {
  return new Promise((resolve) => {
    if (!map) return resolve(null);
    map.once("render", () => { try { resolve(map.getCanvas().toDataURL("image/jpeg", 0.85)); } catch (e) { resolve(null); } });
    map.triggerRepaint();
  });
}
export function setPickMode(cb) { pickCallback = cb; map.getCanvas().style.cursor = cb ? "crosshair" : ""; }
export function setProjects(fc) { sources.projects = fc; if (map && map.getSource("projects")) map.getSource("projects").setData(fc); }
function pinGeo() { return { type: "FeatureCollection", features: pinLngLat ? [{ type: "Feature", geometry: { type: "Point", coordinates: pinLngLat }, properties: {} }] : [] }; }
export function setPin(lngLat) { pinLngLat = lngLat; if (map.getSource("pin")) map.getSource("pin").setData(pinGeo()); }

export function setStations(fc) { sources.stations = fc; if (map.getSource("stations")) map.getSource("stations").setData(fc); }
export function setGauges(fc) { sources.gauges = fc; if (map.getSource("gauges")) map.getSource("gauges").setData(fc); }

export function setLayerVisible(name, on) {
  visibility[name] = on;
  if (!overlaysReady) return;
  const ids = { stations: ["stations-circle", "stations-label"], gauges: ["gauges-circle"], qpe: ["qpe"] }[name] || [];
  for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}
export function setTerrainVisible(id, on) { terrainVis[id] = on; if (overlaysReady) _stv(map, id, on); }
export function setTerrainOpacity(v) { terrainOpacity = v; if (overlaysReady) _sto(map, v); }
export function setQpeWindow(win) {
  qpeWindow = win;
  if (!overlaysReady || !map.getSource("qpe")) return;
  // MapLibre raster sources accept setTiles in v3+
  map.getSource("qpe").setTiles([qpeTileUrl(win)]);
}
export function flyToCounty(fips) {
  const c = COUNTIES.find((x) => x.fips === fips);
  if (!c) { map.fitBounds([[REGION_BBOX[0], REGION_BBOX[1]], [REGION_BBOX[2], REGION_BBOX[3]]], { padding: 20 }); return; }
  if (c.center) map.flyTo({ center: c.center, zoom: c.zoom || 8.5 });
}
export function getBbox() {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

// Hover popups
function setupHover() {
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, maxWidth: "280px" });
  map.on("mousemove", (e) => {
    const layers = ["projects-symbol", "stations-circle", "gauges-circle"].filter((l) => map.getLayer(l));
    if (!layers.length) return;
    const feats = map.queryRenderedFeatures(e.point, { layers });
    if (!feats.length) { popup.remove(); return; }
    const p = feats[0].properties;
    popup.setLngLat(feats[0].geometry.coordinates).setHTML(p.popup || p.name).addTo(map);
  });
  map.on("mouseout", () => popup.remove());
}
