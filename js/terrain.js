// MnTOPO lidar layers: 1 m first-generation (2008–2012) cached tiles, 0.5 m second-generation (2021–2024)
// hillshade rendered by MnGeo's ImageServer, and 2 ft / 10 ft contours. All from enterprise.gisdata.mn.gov (CORS).
const AGHOST = "https://enterprise.gisdata.mn.gov/aghost/rest/services";
const AGSIMG = "https://enterprise.gisdata.mn.gov/agsimg/rest/services/MnTopo";

// Cached MapServers number their levels from their coarsest LOD, not from web-mercator zoom 0.
const LOD = {
  hillshade: { path: `${AGHOST}/1st_Generation_Hillshade/MapServer/tile`, offset: 6, max: 12 },
  dem: { path: `${AGHOST}/elevation_mn_1mDEM_cache/MapServer/tile`, offset: 7, max: 11 },
  c10: { path: `${AGHOST}/1st_Generation_10ft_Contours/MapServer/tile`, offset: 14, max: 5 },
};
const EMPTY_PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)).buffer;

export function registerProtocol() {
  if (registerProtocol.done) return;
  registerProtocol.done = true;
  maplibregl.addProtocol("mnlod", async (params, abort) => {
    const m = params.url.match(/^mnlod:\/\/(\w+)\/(\d+)\/(\d+)\/(\d+)$/);
    if (!m) throw new Error("bad mnlod url " + params.url);
    const svc = LOD[m[1]]; const z = +m[2], y = +m[3], x = +m[4];
    const level = z - svc.offset;
    if (!svc || level < 0 || level > svc.max) return { data: EMPTY_PNG };
    const r = await fetch(`${svc.path}/${level}/${y}/${x}`, { signal: abort?.signal });
    if (r.status === 404 || r.status === 422) return { data: EMPTY_PNG };
    if (!r.ok) throw new Error(`tile ${r.status}`);
    return { data: await r.arrayBuffer() };
  });
}

export const TERRAIN = {
  hs1: { label: "Hillshade, 1 m (2008–12 lidar)", kind: "raster", source: { type: "raster", tiles: ["mnlod://hillshade/{z}/{y}/{x}"], tileSize: 256, minzoom: 6, maxzoom: 18, attribution: "MnGeo/MnTOPO lidar" }, opacity: 0.6, note: "First-generation statewide lidar, cached tiles. Fast; good default." },
  hs05: { label: "Hillshade, 0.5 m (2021–24 lidar)", kind: "raster", source: { type: "raster", tiles: [`${AGSIMG}/2nd_Generation_Seamless_Lidar_DEM/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=png&transparent=true&renderingRule=%7B%22rasterFunction%22%3A%22Hillshade%22%2C%22rasterFunctionArguments%22%3A%7B%22Azimuth%22%3A315%2C%22Altitude%22%3A45%2C%22ZFactor%22%3A1%7D%7D&f=image`], tileSize: 512, minzoom: 12, maxzoom: 19, attribution: "MnGeo/MnTOPO 2nd-gen lidar" }, opacity: 0.6, note: "Second-generation 3DEP lidar rendered on demand by MnGeo's image service. Zoom in past 12; each view is a live request." },
  dem1: { label: "Elevation color ramp, 1 m", kind: "raster", source: { type: "raster", tiles: ["mnlod://dem/{z}/{y}/{x}"], tileSize: 256, minzoom: 7, maxzoom: 18, attribution: "MnGeo/MnTOPO lidar" }, opacity: 0.55, note: "Statewide color-ramped DEM (first generation)." },
  c2: { label: "Contours, 2 ft", kind: "vector", source: { type: "vector", tiles: [`${AGHOST}/MnTopo/1st_Generation_2ft_Contours/VectorTileServer/tile/{z}/{y}/{x}.pbf`], minzoom: 12, maxzoom: 16, attribution: "MnGeo/MnTOPO lidar" }, note: "First-generation lidar contours as vector tiles; index (10 ft) heavier, labels from zoom 14." },
  c10: { label: "Contours, 10 ft (raster)", kind: "raster", source: { type: "raster", tiles: ["mnlod://c10/{z}/{y}/{x}"], tileSize: 256, minzoom: 14, maxzoom: 19, attribution: "MnGeo/MnTOPO lidar" }, opacity: 0.9, note: "Pre-rendered 10 ft contours with labels, visible from zoom 14." },
};

// Add all terrain sources/layers to the map (hidden), beneath `beforeId`.
export function addTerrainLayers(map, beforeId, visibility = {}, opacity = 0.6) {
  registerProtocol();
  for (const [id, t] of Object.entries(TERRAIN)) {
    const srcId = `terrain-${id}`;
    if (map.getSource(srcId)) continue;
    map.addSource(srcId, t.source);
    const vis = visibility[id] ? "visible" : "none";
    if (t.kind === "raster") {
      map.addLayer({ id: srcId, type: "raster", source: srcId, layout: { visibility: vis }, paint: { "raster-opacity": Math.min(1, opacity * (t.opacity / 0.6)), "raster-resampling": "linear" } }, beforeId);
    } else {
      const sl = "contours_02_start";
      map.addLayer({ id: `${srcId}-index`, type: "line", source: srcId, "source-layer": sl, filter: ["in", ["get", "_symbol"], ["literal", [0, 2]]], layout: { visibility: vis, "line-join": "round" }, paint: { "line-color": "#9a3412", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.8, 16, 1.6], "line-opacity": 0.9 } }, beforeId);
      map.addLayer({ id: `${srcId}-inter`, type: "line", source: srcId, "source-layer": sl, filter: ["==", ["get", "_symbol"], 1], minzoom: 14, layout: { visibility: vis, "line-join": "round" }, paint: { "line-color": "#c2410c", "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.4, 17, 0.9], "line-opacity": 0.7 } }, beforeId);
      map.addLayer({ id: `${srcId}-depr`, type: "line", source: srcId, "source-layer": sl, filter: ["==", ["get", "_symbol"], 3], minzoom: 14, layout: { visibility: vis, "line-join": "round" }, paint: { "line-color": "#c2410c", "line-width": 0.6, "line-opacity": 0.7, "line-dasharray": [3, 2] } }, beforeId);
      map.addLayer({ id: `${srcId}-label`, type: "symbol", source: srcId, "source-layer": `${sl}/label`, minzoom: 14, layout: { visibility: vis, "symbol-placement": "line", "symbol-spacing": 400, "text-field": ["get", "_name"], "text-size": 10, "text-font": ["Noto Sans Regular"], "text-rotation-alignment": "map", "text-pitch-alignment": "map", "text-max-angle": 30 }, paint: { "text-color": "#7c2d12", "text-halo-color": "#fff", "text-halo-width": 1.3 } }, beforeId);
    }
  }
}
export function terrainLayerIds(id) {
  const srcId = `terrain-${id}`;
  return TERRAIN[id]?.kind === "vector" ? [`${srcId}-index`, `${srcId}-inter`, `${srcId}-depr`, `${srcId}-label`] : [srcId];
}
export function setTerrainVisible(map, id, on) {
  for (const l of terrainLayerIds(id)) if (map.getLayer(l)) map.setLayoutProperty(l, "visibility", on ? "visible" : "none");
}
export function setTerrainOpacity(map, opacity) {
  for (const [id, t] of Object.entries(TERRAIN)) {
    if (t.kind !== "raster") continue;
    const l = `terrain-${id}`;
    if (map.getLayer(l)) map.setPaintProperty(l, "raster-opacity", Math.min(1, opacity * (t.opacity / 0.6)));
  }
}
export function terrainLegendHtml(visible) {
  const on = Object.keys(TERRAIN).filter((id) => visible[id]);
  if (!on.length) return "";
  return `<h4>Terrain (MnTOPO lidar)</h4>${on.map((id) => `<div class="legend-row">${id === "c2" ? '<span class="swatch sq" style="background:#9a3412"></span>' : id === "c10" ? '<span class="swatch sq" style="background:#8b5e3c"></span>' : '<span class="swatch sq" style="background:linear-gradient(135deg,#fff,#666)"></span>'}${TERRAIN[id].label}</div>`).join("")}<div class="small">Elevations NAVD88. 1 m: 2008–12 statewide; 0.5 m: 2021–24 3DEP. <a href="https://mntopo.gis.data.mn.gov/" target="_blank" rel="noopener">MnTOPO</a></div>`;
}
