// USGS NWIS water services (CORS-enabled). Docs: https://waterservices.usgs.gov/docs/
import { ENDPOINTS } from "../config.js";
import { getJSON, getText } from "../util.js";

const PARAMS = { "00060": "discharge", "00065": "stage", "00045": "precip", "00010": "temp" };

// Latest instantaneous values for all active sites in bbox. Returns map site_no → site
export async function latestInBbox(bbox) {
  const url = `${ENDPOINTS.usgsIV}?bBox=${bbox.map((v) => v.toFixed(3)).join(",")}&parameterCd=00060,00065&format=json&siteStatus=active`;
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 20_000);
  let d; try { d = await getJSON(url, { ttl: 5 * 60_000, signal: ac.signal }); } finally { clearTimeout(timer); }
  const sites = {};
  for (const ts of d.value?.timeSeries || []) {
    const si = ts.sourceInfo;
    const no = si.siteCode[0].value;
    const s = (sites[no] ||= { site_no: no, name: si.siteName, lat: si.geoLocation.geogLocation.latitude, lon: si.geoLocation.geogLocation.longitude, values: {} });
    const code = ts.variable.variableCode[0].value;
    const vals = ts.values?.[0]?.value || [];
    const last = vals[vals.length - 1];
    if (last && Number(last.value) > -999) s.values[PARAMS[code] || code] = { value: Number(last.value), time: last.dateTime, unit: ts.variable.unit?.unitCode };
  }
  return sites;
}

// Instantaneous series for one site over a period (ISO-8601 duration, e.g. P30D)
export async function ivSeries(site, { period = "P30D", params = "00060,00065" } = {}) {
  const url = `${ENDPOINTS.usgsIV}?sites=${site}&parameterCd=${params}&period=${period}&format=json`;
  const d = await getJSON(url, { ttl: 5 * 60_000 });
  const out = {};
  for (const ts of d.value?.timeSeries || []) {
    const code = ts.variable.variableCode[0].value;
    const name = PARAMS[code] || code;
    out[name] = { unit: ts.variable.unit?.unitCode, siteName: ts.sourceInfo.siteName,
      points: (ts.values?.[0]?.value || []).filter((v) => Number(v.value) > -999).map((v) => ({ t: v.dateTime, v: Number(v.value) })) };
  }
  return out;
}

// Daily mean series for long context
export async function dvSeries(site, { period = "P365D", params = "00060" } = {}) {
  const url = `${ENDPOINTS.usgsDV}?sites=${site}&parameterCd=${params}&period=${period}&format=json&statCd=00003`;
  const d = await getJSON(url, { ttl: 30 * 60_000 });
  const ts = d.value?.timeSeries?.[0];
  return (ts?.values?.[0]?.value || []).filter((v) => Number(v.value) > -999).map((v) => ({ t: v.dateTime.slice(0, 10), v: Number(v.value) }));
}

// Daily statistics (percentiles by calendar day) for discharge. Returns { byDay: {"M-D": {...}}, beginYear, endYear }
export async function dailyStats(site, param = "00060") {
  const url = `${ENDPOINTS.usgsStat}?sites=${site}&statReportType=daily&statTypeCd=p10,p25,p50,p75,p90&parameterCd=${param}&format=rdb`;
  const txt = await getText(url);
  const lines = txt.split("\n").filter((l) => l && !l.startsWith("#"));
  if (lines.length < 3) return null;
  const hdr = lines[0].split("\t");
  const idx = (n) => hdr.indexOf(n);
  const out = {}; let begin = null, end = null;
  for (const line of lines.slice(2)) {
    const c = line.split("\t");
    const key = `${Number(c[idx("month_nu")])}-${Number(c[idx("day_nu")])}`;
    const num = (n) => { const v = parseFloat(c[idx(n)]); return isNaN(v) ? null : v; };
    out[key] = { p10: num("p10_va"), p25: num("p25_va"), p50: num("p50_va"), p75: num("p75_va"), p90: num("p90_va"), n: num("count_nu") };
    begin = begin ?? num("begin_yr"); end = Math.max(end ?? 0, num("end_yr") ?? 0);
  }
  return { byDay: out, beginYear: begin, endYear: end };
}

export function usgsPageUrl(site) { return `https://waterdata.usgs.gov/monitoring-location/${site}/`; }
