// Site hydrology summary: gathers everything the site knows about a point (or project) into one
// JSON document with sources and retrieval times, then opens report.html to render it for print.
import { isoDate, addDays, haversineKm, kmToMi } from "./util.js";
import { stations as precipStations, current as precipWindow } from "./precip.js";
import { gauges } from "./gauges.js";
import { alerts } from "./alerts.js";
import { latest as lakeLatest } from "./lake.js";
import * as acis from "./api/acis.js";
import * as nws from "./api/nws.js";
import * as atlas from "./api/atlas14.js";
import { loadCurves, compute, curves, suggestCurve } from "./regional.js";
import { getLiveState, analysisToState } from "./watershed.js";
import { snapshot } from "./map.js";
import { authState } from "./projects.js";
import { APP, ENDPOINTS } from "./config.js";

function maxRun(rows, n) {
  let best = null;
  for (let i = n - 1; i < rows.length; i++) {
    const win = rows.slice(i - n + 1, i + 1);
    if (win.every((r) => r.pcpn == null)) continue;
    const sum = win.reduce((s, r) => s + (r.pcpn || 0), 0);
    if (!best || sum > best.sum) best = { sum, end: rows[i].date };
  }
  return best;
}

// Build the report document. `analysis` (optional) is a saved hydro_project_analyses row; otherwise live watershed state is used if present.
export async function buildReport({ lon, lat, project = null, analysis = null, onStatus = () => {} }) {
  const endDate = precipWindow.endDate, days = precipWindow.days;
  const auth = authState();
  const now = new Date();
  onStatus("Collecting rainfall…");
  const near = precipStations.map((s) => ({ ...s, km: haversineKm(lat, lon, s.lat, s.lon) })).sort((a, b) => a.km - b.km).slice(0, 8);
  const nearG = gauges.map((g) => ({ ...g, km: haversineKm(lat, lon, g.lat, g.lon) })).sort((a, b) => a.km - b.km).slice(0, 4);
  await Promise.all([atlas.loadAtlas14(), loadCurves()]);
  const a14 = atlas.nearest(lat, lon);
  let prism = null, normals = null, wx = null, pointAlerts = [];
  try {
    const sdate = addDays(endDate, -364);
    const [daily, nn] = await Promise.all([acis.gridDaily({ lon, lat, sdate, edate: endDate }), acis.normalsNear({ lon, lat, endDate, days: 30 })]);
    const valid = daily.filter((r) => r.pcpn != null);
    const lastDate = valid.length ? valid[valid.length - 1].date : null;
    const upTo = (d) => daily.filter((r) => r.date <= lastDate && r.date > addDays(lastDate, -d));
    const windows = [7, 30, 60, 90, 180, 365].map((d) => { const ok = upTo(d).filter((r) => r.pcpn != null); return { days: d, total: ok.length ? ok.reduce((s, r) => s + r.pcpn, 0) : null, missing: d - ok.length }; });
    const winRows = daily.filter((r) => r.date >= addDays(endDate, -(days - 1)) && r.date <= endDate);
    const max1 = maxRun(winRows, 1), max2 = maxRun(winRows, 2), max3 = maxRun(winRows, 3);
    prism = { lastDate, windows, winTotal: winRows.filter((r) => r.pcpn != null).reduce((s, r) => s + r.pcpn, 0), max1, max2, max3,
      rp24: a14 && max1 ? atlas.returnPeriod(a14, 9, max1.sum) : null, rp48: a14 && max2 ? atlas.returnPeriod(a14, 10, max2.sum) : null, rp72: a14 && max3 ? atlas.returnPeriod(a14, 11, max3.sum) : null,
      daily90: daily.filter((r) => r.date >= addDays(endDate, -89)) };
    normals = nn.map((s) => ({ ...s, km: haversineKm(lat, lon, s.lat, s.lon) })).filter((s) => s.total != null && s.missing <= 3).sort((a, b) => a.km - b.km)[0] || null;
  } catch (e) { console.warn("report: ACIS grid failed", e); }
  onStatus("Collecting forecast…");
  try {
    const p = await nws.pointInfo(lat, lon);
    const [periods, qpf, al] = await Promise.all([nws.forecast(p), nws.gridQpf(p), nws.activeAlerts({ point: [lat, lon] }).catch(() => [])]);
    const sum = (h) => qpf.values.filter((v) => v.start.getTime() < Date.now() + h * 3600e3 && v.start.getTime() + v.hours * 3600e3 > Date.now()).reduce((s, v) => s + v.inches, 0);
    wx = { office: p.gridId, grid: `${p.gridX},${p.gridY}`, place: p.relativeLocation?.properties?.city, qpf24: sum(24), qpf72: sum(72), qpfUpdated: qpf.updated, periods: periods.slice(0, 6).map((f) => ({ name: f.name, temperature: f.temperature, pop: f.probabilityOfPrecipitation?.value, short: f.shortForecast })) };
    pointAlerts = al;
  } catch (e) { console.warn("report: NWS failed", e); }
  onStatus("Assembling watershed…");
  const ws = analysis ? analysisToState(analysis) : getLiveState(lon, lat);
  let regional = null;
  if (ws?.da) {
    const curveId = ws.curveId || suggestCurve({ huc: ws.huc, lat, lon });
    const strip = (r) => r && { curveId: r.curve.id, curveName: r.curve.name, region: r.curve.region, reliability: r.curve.reliability, method: r.curve.method, sourceFile: r.curve.source_file, sourceModified: r.curve.source_modified, rows: r.rows, warnings: r.warnings };
    regional = { chosen: strip(compute(curveId, ws.da)), others: curves().filter((c) => c.id !== curveId).map((c) => strip(compute(c.id, ws.da))).filter(Boolean) };
  }
  onStatus("Capturing map…");
  const mapImage = await snapshot();
  const sections = captureSections(lon, lat);
  const doc = {
    app: `${APP.name} ${APP.version}`, generatedAt: now.toISOString(), generatedBy: auth.user?.email || null,
    permalink: location.href,
    point: { lat, lon },
    project: project ? { id: project.id, name: project.name, kind: project.kind, status: project.status, county: project.county, swcd: project.swcd, notes: project.notes, location_note: project.location_note } : null,
    window: { endDate, days, startDate: addDays(endDate, -(days - 1)) },
    stations: near.map((s) => ({ name: s.name, network: s.network, id: s.ids?.["10"] ? "CoCoRaHS " + s.ids["10"] : s.sid, mi: kmToMi(s.km), total: s.total, flag: s.totalFlag, missing: s.missing, normal: s.normal, max1: s.max1, max1Date: s.max1Date, lat: s.lat, lon: s.lon })),
    prism, normals: normals ? { name: normals.name, mi: kmToMi(normals.km), total: normals.total, normal: normals.normal } : null,
    gauges: nearG.map((g) => ({ name: g.name, id: g.id, usgs_id: g.usgs_id, dnr_id: g.dnr_id, mi: kmToMi(g.km), flow: g.flow, flowTime: g.flowTime, stage: g.stage, flowClass: g.flowClass, source: g.source, stale: g.stale })),
    atlas14: a14 ? { lat: a14.lat, lon: a14.lon, step: a14.step, durations: a14.durations, aris: a14.aris, q: a14.q, pfdsUrl: atlas.pfdsUrl(lat, lon) } : null,
    weather: wx, alerts: pointAlerts.length ? pointAlerts : alerts.filter((a) => /Duluth/i.test(a.sender || "")),
    lake: lakeLatest,
    watershed: ws ? { da: ws.da, huc: ws.huc, state: ws.state, manual: !!ws.manual, bc: ws.bc || [], flows: ws.flows, regions: ws.regions, retrievedAt: ws.retrievedAt, savedAt: ws.savedAt, savedBy: ws.savedBy, label: ws.label, basin: ws.basin ? { type: ws.basin.geometry?.type, vertices: JSON.stringify(ws.basin.geometry?.coordinates || "").split("],[").length } : null } : null,
    regional,
    mapImage,
    sections,
    sources: {
      acis: { url: ENDPOINTS.acis, note: "RCC-ACIS MultiStnData/StnData (CoCoRaHS, COOP, ASOS) and GridData grid 21 (PRISM)" },
      usgs: { url: ENDPOINTS.usgsIV, note: "USGS NWIS instantaneous values" },
      dnr: { url: "https://www.dnr.state.mn.us/waters/csg/index.html", note: "MN DNR/MPCA Cooperative Stream Gaging telemetry feed" },
      nws: { url: ENDPOINTS.nws, note: "NWS API forecast, gridded QPF, alerts" },
      atlas14: { url: "https://hdsc.nws.noaa.gov/pfds/", note: "NOAA Atlas 14 Vol. 8 PDS depths, precomputed 0.2° grid" },
      streamstats: ws && !ws.manual ? { url: "https://streamstats.usgs.gov/", note: `USGS StreamStats ss-delineate, ss-hydro, NSS services (retrieved ${ws.retrievedAt || "unknown"})` } : null,
      regional: regional ? curves().map((c) => ({ id: c.id, file: c.source_file, modified: c.source_modified })) : null,
      coops: { url: "https://tidesandcurrents.noaa.gov/stationhome.html?id=9099064", note: "NOAA CO-OPS Duluth water level" },
    },
  };
  return doc;
}

// The Point panel's site-condition sections, as rendered (charts, buttons and spinners stripped), for the printed report.
const REPORT_SECTIONS = ["pt-lake", "pt-crossing", "pt-fema", "pt-wetland", "pt-parcel", "pt-soils", "pt-wells"];
function captureSections(lon, lat) {
  const c = document.getElementById("tab-point");
  if (!c || c.dataset.pt !== `${lon.toFixed(5)},${lat.toFixed(5)}`) return [];
  const out = [];
  for (const id of REPORT_SECTIONS) {
    const el = document.getElementById(id);
    if (!el || !el.textContent.trim() || el.querySelector(".spinner")) continue;
    const n = el.cloneNode(true);
    n.querySelectorAll(".js-plotly-plot, .chart, button, input, select, .actions, .spinner").forEach((x) => x.remove());
    n.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
    n.querySelectorAll("[id]").forEach((x) => x.removeAttribute("id"));
    if (n.textContent.trim()) out.push({ id, html: n.innerHTML });
  }
  return out;
}

export async function openReport(args) {
  const doc = await buildReport(args);
  try { localStorage.setItem("nh-report", JSON.stringify(doc)); } catch (e) { alert("Report too large for this browser's storage: " + e.message); return; }
  window.open("report.html", "_blank");
}
