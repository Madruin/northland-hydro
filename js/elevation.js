// Ground elevation from the MnTOPO lidar ImageServers: point identify and line profiles (getSamples).
// Values come back in metres NAVD88 (2nd generation, 0.5 m, 2021–24; 1st generation 1 m as fallback).
const DEM2 = "https://enterprise.gisdata.mn.gov/agsimg/rest/services/MnTopo/2nd_Generation_Seamless_Lidar_DEM/ImageServer";
const DEM1 = "https://enterprise.gisdata.mn.gov/agsimg/rest/services/MnTopo/1st_Generation_DEM_Data/ImageServer";
const FT = 3937 / 1200;
const cache = new Map();

export async function pointElevation(lon, lat) {
  const key = `${lon.toFixed(5)},${lat.toFixed(5)}`; if (cache.has(key)) return cache.get(key);
  const g = JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } });
  for (const [base, src] of [[DEM2, "0.5 m lidar 2021–24"], [DEM1, "1 m lidar 2008–12"]]) {
    try {
      const r = await fetch(`${base}/identify?${new URLSearchParams({ geometry: g, geometryType: "esriGeometryPoint", returnGeometry: "false", returnCatalogItems: "false", f: "json" })}`);
      const d = await r.json(); const v = Number(d.value);
      if (isFinite(v) && d.value !== "NoData") { const out = { m: v, ft: v * FT, src }; cache.set(key, out); return out; }
    } catch (e) { console.warn("elevation", src, e); }
  }
  cache.set(key, null); return null;
}

// Elevation samples along a lon/lat polyline. Returns [{d: metres along, ft: elevation ft, lon, lat}], evenly spaced.
export async function profile(coords, sampleCount = 200) {
  const g = JSON.stringify({ paths: [coords], spatialReference: { wkid: 4326 } });
  let samples = null, src = "0.5 m lidar 2021–24";
  for (const [base, s] of [[DEM2, "0.5 m lidar 2021–24"], [DEM1, "1 m lidar 2008–12"]]) {
    try {
      const r = await fetch(`${base}/getSamples?${new URLSearchParams({ geometry: g, geometryType: "esriGeometryPolyline", sampleCount: String(sampleCount), returnFirstValueOnly: "true", f: "json" })}`);
      const d = await r.json(); if (d.error) throw new Error(d.error.message);
      const ok = (d.samples || []).filter((x) => x.value !== "NoData" && isFinite(Number(x.value)));
      if (ok.length > 2) { samples = ok; src = s; break; }
    } catch (e) { console.warn("profile", s, e); }
  }
  if (!samples) return null;
  const toUtm = (lon, lat) => proj4("EPSG:4326", "+proj=utm +zone=15 +datum=NAD83 +units=m +no_defs", [lon, lat]);
  let d = 0, prev = null; const out = [];
  for (const s of samples) {
    const lon = s.location.x, lat = s.location.y; const u = toUtm(lon, lat);
    if (prev) d += Math.hypot(u[0] - prev[0], u[1] - prev[1]); prev = u;
    out.push({ d, ft: Number(s.value) * FT, m: Number(s.value), lon, lat });
  }
  return { samples: out, src };
}
