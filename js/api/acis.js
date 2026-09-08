// RCC-ACIS (NOAA Regional Climate Centers Applied Climate Information System).
// Serves CoCoRaHS, COOP, ASOS and other daily observations with CORS.
// Docs: https://www.rcc-acis.org/docs_webservices.html
import { ENDPOINTS } from "../config.js";
import { postJSON, parseAcisValue } from "../util.js";

// Network from sid type codes. 10 = CoCoRaHS, 2 = COOP, 1 = WBAN (ASOS), 3 = FAA, 6 = GHCN
export function stationNetwork(sids = []) {
  const types = new Set(sids.map((s) => s.split(" ")[1]));
  if (types.has("10")) return "CoCoRaHS";
  if (types.has("1") || types.has("3") || types.has("5")) return "ASOS/AWOS";
  if (types.has("2")) return "COOP";
  return "Other";
}
export function stationIds(sids = []) {
  const out = {};
  for (const s of sids) { const [id, t] = s.split(" "); out[t] = id; }
  return out; // e.g. {"10":"MNSL0018","6":"US1MNSL0018","2":"212248"}
}
// Preferred id for StnData calls (GHCN id is the most stable)
export function primarySid(sids = []) {
  const ids = stationIds(sids);
  return ids["6"] || ids["2"] || ids["10"] || ids["1"] || (sids[0] || "").split(" ")[0];
}

// Precip totals over a window ending on `endDate` for every station in bbox.
export async function windowTotals({ bbox, endDate, days }) {
  const body = {
    bbox: bbox.join(","),
    date: endDate,
    elems: [
      { name: "pcpn", interval: "dly", duration: days, reduce: { reduce: "sum", add: "mcnt" } },
      { name: "pcpn", interval: "dly", duration: days, reduce: "sum", normal: "1" },
      { name: "snow", interval: "dly", duration: days, reduce: { reduce: "sum", add: "mcnt" } },
      { name: "pcpn", interval: "dly", duration: days, reduce: { reduce: "max", add: "date" } },
    ],
    meta: ["name", "sids", "ll", "elev", "valid_daterange"],
  };
  const r = await postJSON(`${ENDPOINTS.acis}/MultiStnData`, body, { ttl: 5 * 60_000 });
  const out = [];
  for (const s of r.data || []) {
    const m = s.meta || {};
    if (!m.ll) continue;
    const [sum, normal, snow, mx] = s.data || [];
    const [sumV, mcnt] = Array.isArray(sum) ? sum : [sum, 0];
    const [snowV, smcnt] = Array.isArray(snow) ? snow : [snow, 0];
    const [maxV, maxDate] = Array.isArray(mx) ? mx : [mx, null];
    const total = parseAcisValue(sumV);
    const nrm = parseAcisValue(normal);
    const sn = parseAcisValue(snowV);
    const m1 = parseAcisValue(maxV);
    out.push({
      name: m.name, sids: m.sids || [], sid: primarySid(m.sids), ids: stationIds(m.sids), network: stationNetwork(m.sids),
      lon: m.ll[0], lat: m.ll[1], elev: m.elev, por: m.valid_daterange,
      total: total.value, totalFlag: total.flag, missing: Number(mcnt) || 0,
      normal: nrm.value, snow: sn.value, snowMissing: Number(smcnt) || 0,
      max1: m1.value, max1Date: maxDate,
    });
  }
  return out;
}

// Daily series for one station.
export async function stationDaily({ sid, sdate, edate, elems = ["pcpn", "snow", "snwd"] }) {
  const body = { sid, sdate, edate, elems: elems.map((name) => ({ name })), meta: ["name", "sids", "ll", "elev", "valid_daterange", "state", "county"] };
  const r = await postJSON(`${ENDPOINTS.acis}/StnData`, body, { ttl: 5 * 60_000 });
  const rows = (r.data || []).map((row) => {
    const o = { date: row[0] };
    elems.forEach((e, i) => { const p = parseAcisValue(row[i + 1]); o[e] = p.value; o[e + "Flag"] = p.flag; });
    return o;
  });
  return { meta: r.meta || {}, rows };
}

// Window totals + normals for one station over several windows.
export async function stationContext({ sid, endDate, windows = [7, 30, 60, 90, 180, 365] }) {
  const elems = [];
  for (const d of windows) {
    elems.push({ name: "pcpn", interval: "dly", duration: d, reduce: { reduce: "sum", add: "mcnt" } });
    elems.push({ name: "pcpn", interval: "dly", duration: d, reduce: "sum", normal: "1" });
  }
  const r = await postJSON(`${ENDPOINTS.acis}/StnData`, { sid, date: endDate, elems, meta: ["name", "sids", "ll"] }, { ttl: 5 * 60_000 });
  const row = (r.data && r.data[0]) || [];
  return windows.map((d, i) => {
    const cell = row[1 + i * 2];
    const [sum, mcnt] = Array.isArray(cell) ? cell : [cell, 0];
    return { days: d, total: parseAcisValue(sum).value, missing: Number(mcnt) || 0, normal: parseAcisValue(row[2 + i * 2]).value };
  });
}

// PRISM (grid 21) point totals for several windows. Gridded normals are not exposed by this API.
export async function gridTotals({ lon, lat, endDate, windows = [7, 30, 60, 90, 180, 365] }) {
  const elems = windows.map((d) => ({ name: "pcpn", interval: "dly", duration: d, reduce: "sum" }));
  const r = await postJSON(`${ENDPOINTS.acis}/GridData`, { loc: `${lon},${lat}`, date: endDate, grid: "21", elems }, { ttl: 10 * 60_000 });
  const row = (r.data && r.data[0]) || [];
  return windows.map((d, i) => ({ days: d, total: typeof row[1 + i] === "number" && row[1 + i] >= 0 ? row[1 + i] : null }));
}

// PRISM daily series at a point
export async function gridDaily({ lon, lat, sdate, edate }) {
  const r = await postJSON(`${ENDPOINTS.acis}/GridData`, { loc: `${lon},${lat}`, sdate, edate, grid: "21", elems: [{ name: "pcpn" }] }, { ttl: 10 * 60_000 });
  return (r.data || []).map(([date, v]) => ({ date, pcpn: typeof v === "number" && v >= 0 ? v : null }));
}

// Stations near a point that carry normals, with window sum + normal (for "% of normal").
export async function normalsNear({ lon, lat, endDate, days, radiusDeg = 0.6 }) {
  const bbox = [lon - radiusDeg, lat - radiusDeg, lon + radiusDeg, lat + radiusDeg].map((v) => v.toFixed(3)).join(",");
  const body = { bbox, date: endDate, elems: [
    { name: "pcpn", interval: "dly", duration: days, reduce: { reduce: "sum", add: "mcnt" } },
    { name: "pcpn", interval: "dly", duration: days, reduce: "sum", normal: "1" } ], meta: ["name", "sids", "ll"] };
  const r = await postJSON(`${ENDPOINTS.acis}/MultiStnData`, body, { ttl: 5 * 60_000 });
  return (r.data || []).map((s) => {
    const [sum, normal] = s.data || [];
    const [sumV, mcnt] = Array.isArray(sum) ? sum : [sum, 0];
    return { name: s.meta.name, sids: s.meta.sids, lon: s.meta.ll?.[0], lat: s.meta.ll?.[1],
      total: parseAcisValue(sumV).value, missing: Number(mcnt) || 0, normal: parseAcisValue(normal).value };
  }).filter((s) => s.normal != null && s.lon != null);
}
