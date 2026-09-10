// MN DNR lake data: hydrography polygons (DOW number lookup), LakeFinder detail and water levels, dams inventory.
import { getJSON, getText } from "../util.js";

const HYDRO = "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/water_dnr_hydrography/FeatureServer/1";
const DAMS = "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/struc_mn_dams_inventory_pub/FeatureServer/0";
const LF = "https://maps.dnr.state.mn.us/cgi-bin/lakefinder";

// Lake polygon containing a point (DNR Hydro Features All). Returns { props, geometry } or null.
export async function lakeAt(lon, lat) {
  const q = new URLSearchParams({ geometry: `${lon.toFixed(6)},${lat.toFixed(6)}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
    outFields: "dowlknum,pw_basin_name,pw_parent_name,acres,shore_mi,wb_class,lake_class,pwi_class,in_lakefinder,has_hydrograph,cty_name,fw_id,center_utm_x,center_utm_y", outSR: "4326", returnGeometry: "true", f: "geojson" });
  const d = await getJSON(`${HYDRO}/query?${q}`, { ttl: 60 * 60_000 });
  const f = (d.features || []).find((x) => /lake|pond|reservoir/i.test(x.properties?.wb_class || "")) || (d.features || [])[0];
  return f ? { props: f.properties, geometry: f.geometry } : null;
}

// LakeFinder survey detail (morphology, surveys, accesses)
export async function lakeDetail(dow) {
  const d = await getJSON(`${LF}/detail.cgi?type=lake_survey&id=${dow}`, { ttl: 24 * 3600_000 });
  return d.status === "SUCCESS" || d.result ? d.result : null;
}

// Water-level readings CSV: CHR_ID,ELEVATION,READ_DATE,DATUM_ADJ
export async function waterLevels(dow) {
  const txt = await getText(`${LF}/water_levels_export.cgi?format=csv&id=${dow}`);
  const rows = txt.trim().split(/\r?\n/).slice(1).map((l) => l.split(","))
    .filter((c) => c.length >= 3 && !isNaN(parseFloat(c[1])))
    .map((c) => ({ ft: parseFloat(c[1]), date: c[2], datum: c[3] || "" }));
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  return rows;
}

// Summary block from the LakeFinder water-levels page (served with CORS): OHW, datum, period, extremes, benchmarks.
export async function levelSummary(dow) {
  const html = await getText(`https://www.dnr.state.mn.us/lakefind/showlevel.html?downum=${dow}`);
  const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const num = (re) => { const m = text.match(re); return m ? parseFloat(m[1]) : null; };
  const str = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const out = {
    period: str(/Period of record:\s*([\d\/]+\s*to\s*[\d\/]+)/i), readings: num(/#\s*of readings:\s*(\d+)/i),
    highest: num(/Highest recorded:\s*([\d.]+)\s*ft/i), highestDate: str(/Highest recorded:\s*[\d.]+\s*ft\s*\(([^)]+)\)/i),
    lowest: num(/Lowest recorded:\s*([\d.]+)\s*ft/i), lowestDate: str(/Lowest recorded:\s*[\d.]+\s*ft\s*\(([^)]+)\)/i),
    range: num(/Recorded range:\s*([\d.]+)\s*ft/i), last: num(/Last reading:\s*([\d.]+)\s*ft/i), lastDate: str(/Last reading:\s*[\d.]+\s*ft\s*\(([^)]+)\)/i),
    ohw: num(/Ordinary High Water Level \(OHW\) elevation:\s*([\d.]+)\s*ft/i), datum: str(/Datum:\s*([^\[]+?)\s*(?:Download|\[|$)/i),
    benchmarks: null, noData: /no (water )?level data/i.test(text) && !/Highest recorded/i.test(text),
  };
  const bm = text.match(/Benchmarks\s+(.*?)\s+Back to top/i);
  if (bm && !/No benchmark information/i.test(bm[1])) out.benchmarks = bm[1].slice(0, 1500);
  return out;
}

export const hydrographUrl = (dow, name, { years = 10, w = 780, h = 440, all = false } = {}) => {
  const end = new Date(), start = new Date(end.getFullYear() - years, end.getMonth(), end.getDate());
  const fmt = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  return `${LF}/hydrograph_cgi.py?basins=${dow}:${encodeURIComponent(name || "")}${all ? "" : `&startdate=${fmt(start)}&enddate=${fmt(end)}`}&hydrograph_type=time_series&show_ohwl=1&show_legend=1&output_format=png&width=${w}&height=${h}`;
};
export const lakefinderUrl = (dow) => `https://www.dnr.state.mn.us/lakefind/lake.html?id=${dow}`;
export const levelsPageUrl = (dow) => `https://www.dnr.state.mn.us/lakefind/showlevel.html?downum=${dow}`;
export const levelsCsvUrl = (dow) => `${LF}/water_levels_export.cgi?format=csv&id=${dow}`;

// Dams (outlet/control structures) intersecting a bbox (lon/lat), from the DNR dams inventory.
export async function damsInBbox([w, s, e, n]) {
  const q = new URLSearchParams({ geometry: `${w.toFixed(5)},${s.toFixed(5)},${e.toFixed(5)},${n.toFixed(5)}`, geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
    outFields: "dam_name,nid_id,status_of_dam,owner,owner_type,year_completed,present_purpose,top_dam_hgt,top_dam_elev,datum_elev,prin_spill_elev,prin_spill_hgt,max_store,norm_store,drainage_area,hazard,river,comments,year_mod,condition_assessment,last_insp_date", outSR: "4326", returnGeometry: "true", f: "geojson" });
  const d = await getJSON(`${DAMS}/query?${q}`, { ttl: 24 * 3600_000 });
  return (d.features || []).map((f) => ({ ...f.properties, lon: f.geometry?.coordinates?.[0], lat: f.geometry?.coordinates?.[1] }));
}
