// USGS StreamStats (current service generation) + NSS regression estimates. All CORS-enabled.
//   ss-delineate : watershed polygon from a point
//   ss-hydro     : basin characteristics for the delineated basin
//   nss/regions  : which regression region(s) the basin falls in (ArcGIS layer)
//   nssservices  : regression flow statistics with prediction intervals
import { getJSON, postJSON } from "../util.js";

const SSD = "https://streamstats.usgs.gov/ss-delineate/v1";
const SSH = "https://streamstats.usgs.gov/ss-hydro/v1";
const NSS = "https://streamstats.usgs.gov/nssservices";
const REGIONS_LAYER = "https://gis.streamstats.usgs.gov/arcgis/rest/services/nss/regions/MapServer";
const REGION_LAYER_ID = { MN: 19, WI: null }; // Minnesota regression-region polygons live in layer 19

export const STATE_FOR = (lon, lat) => (lon > -92.29 && lat < 46.75 && lon > -92.1 ? "WI" : "MN"); // rough: Douglas/Bayfield WI are east of the St. Louis estuary

// 1) Delineate. StreamStats returns the watershed in pieces: split_catchment (local area between the point and the
// nearest catchment divide), adjoint_catchment (everything upstream of that divide) and sometimes upstream_basin
// (already merged). The full basin is the union of the pieces; the drainage area from ss-hydro is independent of this.
export async function delineate(state, lat, lon) {
  const fc = await getJSON(`${SSD}/delineate/features/${state}?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`, { ttl: 60 * 60_000 });
  const by = {};
  for (const f of fc.features || []) by[f.properties?.scope] = f;
  const has = (f) => f?.geometry?.coordinates?.length > 0;
  const pieces = [by.upstream_basin, by.adjoint_catchment, by.split_catchment].filter(has);
  let basin = null;
  if (has(by.upstream_basin)) basin = by.upstream_basin;
  else if (pieces.length > 1) basin = await unionFeatures(pieces);
  else basin = pieces[0] || null;
  const huc = by.adjoint_catchment?.properties?.HUCID || by.split_catchment?.properties?.HUCID || by.upstream_basin?.properties?.HUCID || null;
  return { raw: fc, pourpoint: by.pourpoint, splitCatchment: by.split_catchment, basin, huc, areaSqMi: basin ? approxAreaSqMi(basin.geometry) : 0 };
}
async function unionFeatures(features) {
  await loadScript("https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/dist/polygon-clipping.umd.js", "polygonClipping");
  const geoms = features.map((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates));
  const merged = window.polygonClipping.union(...geoms);
  return { type: "Feature", properties: { scope: "watershed", HUCID: features[0].properties?.HUCID }, geometry: { type: "MultiPolygon", coordinates: merged } };
}
function approxAreaSqMi(g) {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const ring = (r) => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(s) / 2; };
  let a = 0, lat = 47;
  for (const p of polys) { if (!p.length) continue; lat = p[0][0][1]; a += ring(p[0]) - p.slice(1).reduce((s, h) => s + ring(h), 0); }
  return a * 111.32 * Math.cos((lat * Math.PI) / 180) * 110.57 * 0.386102;
}
function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("failed to load " + src)); document.head.appendChild(s); });
}

// 1b) Snap a clicked point onto the stream grid (StreamStats does this before delineating; ~180 m search radius).
export async function snap(state, lat, lon) {
  const d = await getJSON(`https://streamstats.usgs.gov/pourpoint/v1/snap/str900?region=${state}&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`, { ttl: 60 * 60_000 });
  const c = d.output?.coordinates;
  return { snapped: !!d.couldSnap && !!c, lon: c ? c[0] : lon, lat: c ? c[1] : lat };
}

// 2) Basin characteristics (runs its own delineation server-side; ~8 s). Returns [{code,name,value,unit,description}]
export async function basinCharacteristics(state, lat, lon) {
  const url = `${SSH}/basin-characteristics/calculate-using-ssdelineate/?region=${state}&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`;
  const rows = await postJSON(url, {}, { ttl: 60 * 60_000 });
  return (rows || []).filter((r) => typeof r.value === "number" && r.value > -999).map((r) => ({ code: r.code, name: r.name, value: r.value, unit: r.unit, description: r.description }));
}

// 3) Regression regions intersecting a point (peak-flow, low-flow, flow-duration groups keyed by grid_name)
export async function regressionRegionsAt(state, lat, lon) {
  const layer = REGION_LAYER_ID[state];
  if (layer == null) return [];
  const url = `${REGIONS_LAYER}/${layer}/query?geometry=${lon.toFixed(6)},${lat.toFixed(6)}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=NAME,GRIDCODE,grid_name&returnGeometry=false&f=json`;
  const d = await getJSON(url, { ttl: 24 * 3600_000 });
  return (d.features || []).map((f) => ({ name: f.attributes.NAME, gridcode: String(f.attributes.GRIDCODE).toUpperCase(), grid: f.attributes.grid_name }));
}

// 4) Scenarios (statistic groups + regression regions with parameter definitions) for a state
export async function scenarios(state) {
  return getJSON(`${NSS}/regions/${state}/scenarios`, { ttl: 24 * 3600_000 });
}

// Map the polygon layer's region names onto the current NSS regression-region codes.
// The GIS layer still carries older grid codes (e.g. gc1200 "Region_C"); the equations in NSS are the 2023
// Minnesota peak-flow regions GC1928–GC1933 (A–F). We match by the region letter within each statistic group.
export function matchRegions(polyRegions, scn) {
  const out = []; // [{statisticGroupID, statisticGroupName, regressionRegion}]
  for (const sg of scn) {
    for (const rr of sg.regressionRegions) {
      const letter = (rr.name.match(/_([A-F]{1,2})(_|$)/) || [])[1]; // Minnesota_Peakflow_C_2023_5079 → C ; Low_flow_Region_BC_2015_5170 → BC
      const hit = polyRegions.find((p) => p.gridcode === rr.code || (letter && (p.name === `Region_${letter}` || p.name.includes(`Region_${letter}_`))));
      if (hit) out.push({ statisticGroupID: sg.statisticGroupID, statisticGroupName: sg.statisticGroupName, regressionRegion: rr });
    }
  }
  return out;
}

// 5) Estimate flows for the matched regions using basin characteristics. Returns the NSS response (with results per region).
export async function estimate(state, matched, bcByCode) {
  const groups = [...new Set(matched.map((m) => m.statisticGroupID))];
  const regions = [...new Set(matched.map((m) => m.regressionRegion.code))];
  const scn = await getJSON(`${NSS}/regions/${state}/scenarios?statisticgroups=${groups.join(",")}&regressionregions=${regions.join(",")}`, { ttl: 24 * 3600_000 });
  const missing = new Set();
  for (const sg of scn) for (const rr of sg.regressionRegions) for (const p of rr.parameters || []) {
    if (bcByCode[p.code] == null) missing.add(p.code); else p.value = bcByCode[p.code];
  }
  const url = `${NSS}/scenarios/estimate?regions=${state}&statisticgroups=${groups.join(",")}&regressionregions=${regions.join(",")}`;
  const res = await postJSON(url, scn, { ttl: 60 * 60_000 });
  return { result: res, missing: [...missing] };
}

export const streamstatsUrl = (lat, lon) => `https://streamstats.usgs.gov/ss/?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`;
