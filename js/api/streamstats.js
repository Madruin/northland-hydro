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

// 1) Delineate. Returns { pourpoint, splitCatchment, basin (Polygon|MultiPolygon), huc12, area_sqmi (from shape if given) }
export async function delineate(state, lat, lon) {
  const fc = await getJSON(`${SSD}/delineate/features/${state}?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`, { ttl: 60 * 60_000 });
  const by = {};
  for (const f of fc.features || []) by[f.properties?.scope] = f;
  const basin = by.adjoint_catchment?.geometry?.coordinates?.length ? by.adjoint_catchment : by.split_catchment;
  return { raw: fc, pourpoint: by.pourpoint, splitCatchment: by.split_catchment, basin, huc: basin?.properties?.HUCID || by.split_catchment?.properties?.HUCID || null };
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
