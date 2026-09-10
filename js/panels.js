// Side-panel renderers: Region summary, Station, Gauge, Point.
import { $, el, escapeHtml, fmt, fmtNum, fmtDate, fmtDateTime, addDays, ago, haversineKm, kmToMi, downloadCSV, plotlyLayout } from "./util.js";
import { stations as precipStations, current as precipWindow, summarize } from "./precip.js";
import { gauges, gaugeById } from "./gauges.js";
import { alertsHtml } from "./alerts.js";
import { renderLakeSection } from "./lake.js";
import * as acis from "./api/acis.js";
import * as usgs from "./api/usgs.js";
import * as dnr from "./api/dnr.js";
import * as nws from "./api/nws.js";
import * as om from "./api/openmeteo.js";
import * as atlas from "./api/atlas14.js";
import { setPin, map } from "./map.js";
import { ENDPOINTS, FLOW_CLASSES, COUNTIES } from "./config.js";
import { renderWatershed } from "./watershed.js";
import { openReport } from "./report.js";
const countyName = (fips) => { const c = COUNTIES.find((x) => x.fips === String(fips)); return c ? c.name.replace(" (WI)", "") + " County" : fips ? "FIPS " + fips : ""; };

const DUR24 = 9, DUR48 = 10, DUR72 = 11; // indexes into Atlas 14 duration list (24-hr, 2-day, 3-day)

export function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => { t.classList.toggle("on", t.dataset.tab === name); if (t.dataset.tab === name) t.disabled = false; });
  document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("on", p.id === "tab-" + name));
  $("panel").classList.add("open");
  if (window.matchMedia("(max-width: 900px)").matches && ($("panel").dataset.sheet || "peek") === "peek") $("panel").dataset.sheet = "half";
}

// ---------------- Region ----------------
export function renderRegion() {
  const c = $("tab-region");
  const s = summarize(precipStations);
  const w = precipWindow;
  const label = w.days === 1 ? `on ${fmtDate(w.endDate)}` : `${w.days} days ending ${fmtDate(w.endDate)}`;
  const hot = gauges.filter((g) => g.flowClass >= 5 && !g.stale).sort((a, b) => b.flowClass - a.flowClass);
  const low = gauges.filter((g) => g.flowClass > 0 && g.flowClass <= 2 && !g.stale);
  c.innerHTML = `
    <h2>Region overview</h2>
    <div class="muted">Precipitation ${label} · ${s.reporting} of ${s.n} stations reporting</div>
    <div class="hint">Click a station dot or gauge triangle for its record, or anywhere else on the map for rainfall, forecast, design storms and watershed tools at that point. Search with <b>/</b>. Press <b>?</b> for help.</div>
    <div class="stat-row">
      <div class="stat"><div class="v">${fmt(s.median)}"</div><div class="l">median station</div></div>
      <div class="stat ${s.max > 2 ? "warn" : ""}"><div class="v">${fmt(s.max)}"</div><div class="l">wettest station</div></div>
      <div class="stat ${s.pctNormal != null && s.pctNormal < 50 ? "bad" : s.pctNormal > 150 ? "warn" : ""}"><div class="v">${s.pctNormal != null ? s.pctNormal + "%" : "–"}</div><div class="l">of normal</div><div class="s">${w.days >= 7 ? "stations with normals, full windows" : "needs a 7-day or longer window"}</div></div>
    </div>
    <h3>Active alerts</h3>
    <div id="region-alerts">${alertsHtml()}</div>
    <h3>Wettest stations</h3>
    <table class="data"><thead><tr><th>Station</th><th>Net</th><th class="num">in</th><th class="num">% nrm</th></tr></thead>
      <tbody>${s.top.map((st) => `<tr class="clickable" data-sid="${escapeHtml(st.sid)}"><td>${escapeHtml(st.name)}</td><td class="small">${st.network === "CoCoRaHS" ? "CoCo" : st.network}</td><td class="num">${fmt(st.total)}${st.partial ? "*" : ""}</td><td class="num">${w.days >= 7 && st.normal ? Math.round((100 * st.total) / st.normal) : "–"}</td></tr>`).join("")}</tbody></table>
    <div class="small">* partial window (missing days). % of normal shown for 7-day and longer windows. Click a row to open the station.</div>
    <h3>Gauges running high ${hot.length ? `<span class="pill">${hot.length}</span>` : ""}</h3>
    ${hot.length ? gaugeTable(hot) : `<div class="notice">No telemetered gauge is above its Q25 (high-flow) threshold right now.</div>`}
    <h3>Gauges running low ${low.length ? `<span class="pill">${low.length}</span>` : ""}</h3>
    ${low.length ? gaugeTable(low) : `<div class="notice">No gauge below its Q75 (low-flow) threshold.</div>`}
    <div id="region-lake"></div>
    <h3>Sources & caveats</h3>
    <div class="small">Station precipitation is the daily observation ending the morning of the date shown (CoCoRaHS/COOP report ~7 AM). Gauge flow classes come from the MN DNR CSG feed and compare today's flow to the site's period-of-record percentiles for this time of year. USGS values are provisional.</div>`;
  c.querySelectorAll("tr[data-sid]").forEach((tr) => tr.addEventListener("click", () => { const st = precipStations.find((x) => x.sid === tr.dataset.sid); if (st) { map.flyTo({ center: [st.lon, st.lat], zoom: Math.max(map.getZoom(), 9.5) }); renderStation(st.sid); } }));
  c.querySelectorAll("tr[data-gid]").forEach((tr) => tr.addEventListener("click", () => { const g = gaugeById(tr.dataset.gid); if (g) { map.flyTo({ center: [g.lon, g.lat], zoom: Math.max(map.getZoom(), 9.5) }); renderGauge(g.id); } }));
  renderLakeSection($("region-lake"));
}
function gaugeTable(list) {
  return `<table class="data"><thead><tr><th>Gauge</th><th>Class</th><th class="num">cfs</th><th class="num">ft</th></tr></thead><tbody>
    ${list.map((g) => `<tr class="clickable" data-gid="${escapeHtml(g.id)}"><td>${escapeHtml(g.name)}</td><td><span class="pill class" style="background:${g.color}">${FLOW_CLASSES[g.flowClass].label.split(" (")[0]}</span></td><td class="num">${fmtNum(g.flow, g.flow < 10 ? 1 : 0)}</td><td class="num">${fmt(g.stage, 2)}</td></tr>`).join("")}</tbody></table>`;
}

// ---------------- Station ----------------
export async function renderStation(sid) {
  showTab("station");
  const c = $("tab-station");
  const st = precipStations.find((x) => x.sid === sid);
  c.innerHTML = `<h2>${escapeHtml(st?.name || sid)}</h2><div class="spinner">Loading station record…</div>`;
  const endDate = precipWindow.endDate, days = precipWindow.days;
  const sdate = addDays(endDate, -89);
  try {
    const [daily, ctx] = await Promise.all([acis.stationDaily({ sid, sdate, edate: endDate }), acis.stationContext({ sid, endDate })]);
    const m = daily.meta;
    const rows = daily.rows;
    const winRows = rows.filter((r) => r.date >= addDays(endDate, -(days - 1)));
    const max1 = maxRun(winRows, 1), max2 = maxRun(winRows, 2), max3 = maxRun(winRows, 3);
    const lon = m.ll?.[0] ?? st?.lon, lat = m.ll?.[1] ?? st?.lat;
    const a14 = atlas.nearest(lat, lon);
    const rp24 = a14 && max1 ? atlas.returnPeriod(a14, DUR24, max1.sum) : null;
    const rp48 = a14 && max2 ? atlas.returnPeriod(a14, DUR48, max2.sum) : null;
    const rp72 = a14 && max3 ? atlas.returnPeriod(a14, DUR72, max3.sum) : null;
    const ids = acis.stationIds(m.sids || st?.sids || []);
    const coco = ids["10"];
    const total = st?.total ?? sumVals(winRows.map((r) => r.pcpn));
    const pctN = days >= 7 && st?.normal ? Math.round((100 * total) / st.normal) : null;
    c.innerHTML = `
      <h2>${escapeHtml(m.name || st?.name || sid)}</h2>
      <div class="muted">${escapeHtml(acis.stationNetwork(m.sids))}${coco ? ` · CoCoRaHS ${coco}` : ""} · ${ids["6"] || sid}${m.elev ? ` · ${fmtNum(m.elev)} ft` : ""}${m.county ? ` · ${escapeHtml(countyName(m.county))}` : ""}</div>
      <div class="small">Record: ${m.valid_daterange?.[0]?.[0] || "?"} → ${m.valid_daterange?.[0]?.[1] || "?"} · ${fmt(lat, 4)}, ${fmt(lon, 4)}</div>
      <div class="stat-row">
        <div class="stat"><div class="v">${fmt(total)}"</div><div class="l">${days === 1 ? fmtDate(endDate) : days + "-day total"}</div><div class="s">${st?.partial ? st.missing + " day(s) missing" : ""}</div></div>
        <div class="stat ${pctN > 150 ? "warn" : pctN != null && pctN < 50 ? "bad" : ""}"><div class="v">${pctN != null ? pctN + "%" : "–"}</div><div class="l">of normal</div><div class="s">${days < 7 ? "see context table below" : st?.normal ? "normal " + fmt(st.normal) + '"' : "no normals for this station"}</div></div>
        <div class="stat ${rp24?.years >= 10 ? "warn" : ""}"><div class="v">${max1 ? fmt(max1.sum) + '"' : "–"}</div><div class="l">max 1-day</div><div class="s">${max1 ? fmtDate(max1.end) : ""}${rp24 ? " · " + rp24.text : ""}</div></div>
      </div>
      ${days > 1 ? `<div class="stat-row">
        <div class="stat ${rp48?.years >= 10 ? "warn" : ""}"><div class="v">${max2 ? fmt(max2.sum) + '"' : "–"}</div><div class="l">max 2-day</div><div class="s">${max2 ? "ending " + fmtDate(max2.end) : ""}${rp48 ? " · " + rp48.text : ""}</div></div>
        <div class="stat ${rp72?.years >= 10 ? "warn" : ""}"><div class="v">${max3 ? fmt(max3.sum) + '"' : "–"}</div><div class="l">max 3-day</div><div class="s">${max3 ? "ending " + fmtDate(max3.end) : ""}${rp72 ? " · " + rp72.text : ""}</div></div>
      </div>` : ""}
      ${a14 ? `<div class="small">Return periods interpolated from NOAA Atlas 14 at the nearest ${a14.step}° grid node (${fmt(a14.lat, 1)}, ${fmt(a14.lon, 1)}); daily gauge totals are fixed-clock 24 h, which run ~13% under true peak 24 h depths. <a href="${atlas.pfdsUrl(lat, lon)}" target="_blank" rel="noopener">Exact PFDS values</a>.</div>` : ""}
      <div id="stn-chart" class="chart tall"></div>
      <h3>Context (ending ${fmtDate(endDate)})</h3>
      <table class="data"><thead><tr><th>Window</th><th class="num">Observed</th><th class="num">Normal</th><th class="num">% normal</th><th class="num">Missing</th></tr></thead><tbody>
        ${ctx.map((r) => `<tr><td>${r.days} days</td><td class="num">${fmt(r.total)}</td><td class="num">${fmt(r.normal)}</td><td class="num">${r.normal && r.total != null ? Math.round((100 * r.total) / r.normal) + "%" : "–"}</td><td class="num">${r.missing || 0}</td></tr>`).join("")}</tbody></table>
      <div class="actions">
        <button class="btn" id="stn-csv">Download 90-day CSV</button>
        ${coco ? `<a class="btn" href="${ENDPOINTS.cocorahsStation}${coco}" target="_blank" rel="noopener">CoCoRaHS station page</a>` : ""}
        <a class="btn" href="https://www.rcc-acis.org/" target="_blank" rel="noopener">About ACIS</a>
      </div>
      <h3>Daily observations</h3>
      <div style="max-height:260px;overflow:auto"><table class="data"><thead><tr><th>Date</th><th class="num">Precip</th><th class="num">Snow</th><th class="num">Depth</th></tr></thead><tbody>
        ${rows.slice().reverse().map((r) => `<tr><td>${fmtDate(r.date, { month: "short", day: "numeric", year: "2-digit" })}</td><td class="num">${cell(r.pcpn, r.pcpnFlag)}</td><td class="num">${cell(r.snow, r.snowFlag, 1)}</td><td class="num">${cell(r.snwd, r.snwdFlag, 0)}</td></tr>`).join("")}</tbody></table></div>
      <div class="small">T = trace. A = multi-day accumulation ending on that date (preceding S days are included in it). M = missing.</div>`;
    Plotly.newPlot("stn-chart", [
      { x: rows.map((r) => r.date), y: rows.map((r) => r.pcpn ?? 0), type: "bar", name: "Daily precip (in)", marker: { color: rows.map((r) => (r.date >= addDays(endDate, -(days - 1)) ? "#38bdf8" : "#475569")) },
        text: rows.map((r) => (r.pcpnFlag === "A" ? "A" : r.pcpnFlag === "T" ? "T" : "")), textposition: "outside", hovertemplate: "%{x}: %{y:.2f}\"<extra></extra>" },
    ], plotlyLayout({ title: "Last 90 days · highlighted = current window", yaxis: { title: "in" }, showlegend: false }), { displayModeBar: false, responsive: true });
    $("stn-csv").onclick = () => downloadCSV(`${sid}_${sdate}_${endDate}.csv`, [["date", "precip_in", "precip_flag", "snow_in", "snow_flag", "snow_depth_in"], ...rows.map((r) => [r.date, r.pcpn, r.pcpnFlag, r.snow, r.snowFlag, r.snwd])]);
  } catch (e) {
    c.innerHTML += `<div class="notice">Failed: ${escapeHtml(e.message)}</div>`;
  }
}
function cell(v, flag, d = 2) { if (flag === "M") return "M"; if (flag === "T") return "T"; if (flag === "S") return "S"; return v == null ? "–" : fmt(v, d) + (flag === "A" ? "A" : ""); }
function sumVals(a) { return a.reduce((s, v) => s + (v || 0), 0); }
// Max running n-day sum across daily rows (missing treated as 0; skipped if all missing)
function maxRun(rows, n) {
  let best = null;
  for (let i = n - 1; i < rows.length; i++) {
    const win = rows.slice(i - n + 1, i + 1);
    if (win.every((r) => r.pcpn == null)) continue;
    const sum = sumVals(win.map((r) => r.pcpn));
    if (!best || sum > best.sum) best = { sum, end: rows[i].date };
  }
  return best;
}

// ---------------- Gauge ----------------
export async function renderGauge(id) {
  showTab("gauge");
  const c = $("tab-gauge");
  const g = gaugeById(id);
  if (!g) { c.innerHTML = `<div class="notice">Unknown gauge ${escapeHtml(id)}</div>`; return; }
  const cls = FLOW_CLASSES[g.flowClass] || FLOW_CLASSES[0];
  c.innerHTML = `
    <h2>${escapeHtml(g.name)}</h2>
    <div class="muted">${escapeHtml(g.source)}${g.usgs_id ? ` · USGS ${g.usgs_id}` : ""}${g.dnr_id ? ` · DNR ${g.dnr_id}` : ""} · ${fmt(g.lat, 4)}, ${fmt(g.lon, 4)}</div>
    <div class="stat-row">
      <div class="stat"><div class="v">${g.flow != null ? fmtNum(g.flow, g.flow < 10 ? 2 : 0) : "–"}</div><div class="l">cfs</div><div class="s">${g.flowTime ? ago(g.flowTime) : ""}</div></div>
      <div class="stat"><div class="v">${fmt(g.stage)}</div><div class="l">stage, ft</div><div class="s">${g.stageTime ? ago(g.stageTime) : ""}</div></div>
      <div class="stat"><div class="v" style="font-size:14px;color:${cls.color}">${cls.label}</div><div class="l">flow class</div><div class="s">DNR CSG, vs period of record</div></div>
    </div>
    <div class="actions">
      ${g.usgs_id ? `<a class="btn" href="${usgs.usgsPageUrl(g.usgs_id)}" target="_blank" rel="noopener">USGS page</a>` : ""}
      ${g.dnr_id ? `<a class="btn" href="${dnr.siteReportUrl(g.dnr_id)}" target="_blank" rel="noopener">DNR site report</a>` : ""}
      ${g.usgs_id ? `<button class="btn" id="gauge-csv">Download 30-day CSV</button>` : ""}
    </div>
    <div id="gauge-body"><div class="spinner">Loading hydrograph…</div></div>`;
  const body = $("gauge-body");
  if (g.usgs_id) {
    try {
      const [iv, stats] = await Promise.all([usgs.ivSeries(g.usgs_id, { period: "P30D" }), usgs.dailyStats(g.usgs_id).catch(() => null)]);
      body.innerHTML = `<div id="gauge-q" class="chart tall"></div><div id="gauge-h" class="chart"></div>
        ${stats ? `<div class="small">Shaded bands are the daily 10–90th (light) and 25–75th (dark) percentiles of discharge for each calendar day, ${stats.beginYear}–${stats.endYear} (USGS statistics service).</div>` : ""}
        <div id="gauge-dv" class="chart"></div>`;
      const q = iv.discharge?.points || [], h = iv.stage?.points || [];
      const traces = [];
      if (stats && q.length) {
        const days = uniqueDays(q.map((p) => p.t));
        const band = (key) => days.map((d) => stats.byDay[`${Number(d.slice(5, 7))}-${Number(d.slice(8, 10))}`]?.[key] ?? null);
        traces.push({ x: days, y: band("p90"), mode: "lines", line: { width: 0 }, hoverinfo: "skip", showlegend: false });
        traces.push({ x: days, y: band("p10"), mode: "lines", line: { width: 0 }, fill: "tonexty", fillcolor: "rgba(148,163,184,.18)", name: "p10–p90", hoverinfo: "skip" });
        traces.push({ x: days, y: band("p75"), mode: "lines", line: { width: 0 }, hoverinfo: "skip", showlegend: false });
        traces.push({ x: days, y: band("p25"), mode: "lines", line: { width: 0 }, fill: "tonexty", fillcolor: "rgba(148,163,184,.3)", name: "p25–p75", hoverinfo: "skip" });
        traces.push({ x: days, y: band("p50"), mode: "lines", line: { color: "#94a3b8", dash: "dot", width: 1 }, name: "median" });
      }
      traces.push({ x: q.map((p) => p.t), y: q.map((p) => p.v), mode: "lines", line: { color: "#38bdf8", width: 1.6 }, name: "Discharge (cfs)" });
      Plotly.newPlot("gauge-q", traces, plotlyLayout({ title: "Discharge, last 30 days", yaxis: { title: "cfs", type: q.length && Math.max(...q.map((p) => p.v)) / Math.max(1e-3, Math.min(...q.map((p) => p.v))) > 50 ? "log" : "linear" } }), { displayModeBar: false, responsive: true });
      if (h.length) Plotly.newPlot("gauge-h", [{ x: h.map((p) => p.t), y: h.map((p) => p.v), mode: "lines", line: { color: "#f59e0b", width: 1.4 }, name: "Gage height (ft)" }], plotlyLayout({ title: "Stage, last 30 days", yaxis: { title: "ft" }, showlegend: false }), { displayModeBar: false, responsive: true });
      else $("gauge-h").remove();
      usgs.dvSeries(g.usgs_id, { period: "P365D" }).then((dv) => {
        if (!dv.length) { $("gauge-dv")?.remove(); return; }
        const tr = [{ x: dv.map((p) => p.t), y: dv.map((p) => p.v), mode: "lines", line: { color: "#38bdf8", width: 1.2 }, name: "Daily mean (cfs)" }];
        if (stats) tr.unshift({ x: dv.map((p) => p.t), y: dv.map((p) => stats.byDay[`${Number(p.t.slice(5, 7))}-${Number(p.t.slice(8, 10))}`]?.p50 ?? null), mode: "lines", line: { color: "#94a3b8", dash: "dot", width: 1 }, name: "median" });
        Plotly.newPlot("gauge-dv", tr, plotlyLayout({ title: "Daily mean discharge, last 365 days", yaxis: { title: "cfs", type: "log" } }), { displayModeBar: false, responsive: true });
      }).catch(() => $("gauge-dv")?.remove());
      const btn = $("gauge-csv");
      if (btn) btn.onclick = () => downloadCSV(`USGS-${g.usgs_id}_iv_30d.csv`, [["time", "discharge_cfs", "stage_ft"], ...mergeSeries(q, h)]);
    } catch (e) { body.innerHTML = `<div class="notice">USGS request failed: ${escapeHtml(e.message)}</div>`; }
  } else if (g.dnr_id) {
    const end = new Date(), start = new Date(Date.now() - 30 * 86400e3);
    const iso = (d) => d.toISOString().slice(0, 10);
    body.innerHTML = `<h3>Discharge, last 30 days</h3><img class="hydro-img" alt="DNR discharge hydrograph" src="${dnr.hydrographPng(g.dnr_id, 262, iso(start), iso(end))}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'notice',textContent:'No discharge hydrograph available.'}))" />
      <h3>Stage, last 30 days</h3><img class="hydro-img" alt="DNR stage hydrograph" src="${dnr.hydrographPng(g.dnr_id, 232, iso(start), iso(end))}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'notice',textContent:'No stage hydrograph available.'}))" />
      <div class="small">The DNR CSG service publishes hydrograph images only; tabular data is available on the DNR site report (Data tab). Telemetry ${g.telRange?.[0]?.slice(0, 10) || "?"} → ${g.telRange?.[1]?.slice(0, 10) || "?"}${g.arcRange?.[0] ? `; archive from ${g.arcRange[0].slice(0, 10)}` : ""}.</div>`;
  }
}
function uniqueDays(ts) { const s = new Set(ts.map((t) => t.slice(0, 10))); return [...s].sort(); }
function mergeSeries(q, h) {
  const m = new Map();
  q.forEach((p) => m.set(p.t, [p.t, p.v, null]));
  h.forEach((p) => { const r = m.get(p.t); if (r) r[2] = p.v; else m.set(p.t, [p.t, null, p.v]); });
  return [...m.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

// ---------------- Point ----------------
export async function renderPoint(lon, lat) {
  showTab("point");
  setPin([lon, lat]);
  const c = $("tab-point");
  const endDate = precipWindow.endDate, days = precipWindow.days;
  c.innerHTML = `<h2>Point ${fmt(lat, 4)}, ${fmt(lon, 4)}</h2><div class="muted">Anything that isn't a station or gauge: gridded precip, nearby observers, forecast, soil moisture, design storms.</div>
    <div class="actions"><button class="btn" id="pt-report">🖨 Print site report</button><span id="pt-report-msg" class="small"></span></div>
    <div id="pt-watershed"></div>
    <div id="pt-precip"><div class="spinner">PRISM + station normals…</div></div>
    <div id="pt-nearby"></div>
    <div id="pt-wx"><div class="spinner">NWS forecast…</div></div>
    <div id="pt-soil"><div class="spinner">Open-Meteo…</div></div>
    <div id="pt-a14"></div>`;

  renderWatershed($("pt-watershed"), lon, lat);
  $("pt-report").onclick = async () => { const m = $("pt-report-msg"); try { await openReport({ lon, lat, onStatus: (t) => (m.textContent = t) }); m.textContent = ""; } catch (e) { m.textContent = "Report failed: " + e.message; } };

  // Nearby observers (from the already-loaded station layer)
  const near = precipStations.map((s) => ({ ...s, km: haversineKm(lat, lon, s.lat, s.lon) })).sort((a, b) => a.km - b.km).slice(0, 8);
  const nearG = gauges.map((g) => ({ ...g, km: haversineKm(lat, lon, g.lat, g.lon) })).sort((a, b) => a.km - b.km).slice(0, 5);
  $("pt-nearby").innerHTML = `<h3>Nearest observers (${days === 1 ? fmtDate(endDate) : days + "-day totals"})</h3>
    <table class="data"><thead><tr><th>Station</th><th class="num">mi</th><th class="num">in</th><th class="num">% nrm</th></tr></thead><tbody>
    ${near.map((s) => `<tr class="clickable" data-sid="${escapeHtml(s.sid)}"><td>${escapeHtml(s.name)}</td><td class="num">${fmt(kmToMi(s.km), 1)}</td><td class="num">${s.missingAll ? "–" : fmt(s.total)}</td><td class="num">${days >= 7 && s.normal && s.total != null ? Math.round((100 * s.total) / s.normal) : "–"}</td></tr>`).join("")}</tbody></table>
    <h3>Nearest gauges</h3>
    <table class="data"><thead><tr><th>Gauge</th><th class="num">mi</th><th class="num">cfs</th><th>Class</th></tr></thead><tbody>
    ${nearG.map((g) => `<tr class="clickable" data-gid="${escapeHtml(g.id)}"><td>${escapeHtml(g.name)}</td><td class="num">${fmt(kmToMi(g.km), 1)}</td><td class="num">${fmtNum(g.flow, g.flow < 10 ? 1 : 0)}</td><td><span class="pill class" style="background:${g.color}">${FLOW_CLASSES[g.flowClass].label.split(" (")[0]}</span></td></tr>`).join("")}</tbody></table>`;
  $("pt-nearby").querySelectorAll("tr[data-sid]").forEach((tr) => tr.addEventListener("click", () => renderStation(tr.dataset.sid)));
  $("pt-nearby").querySelectorAll("tr[data-gid]").forEach((tr) => tr.addEventListener("click", () => renderGauge(tr.dataset.gid)));

  // PRISM daily series (365 d) → window totals from the last date PRISM has, plus nearest station normals
  (async () => {
    try {
      const sdate = addDays(endDate, -364);
      const [normals, dailyAll] = await Promise.all([acis.normalsNear({ lon, lat, endDate, days: 30 }), acis.gridDaily({ lon, lat, sdate, edate: endDate })]);
      const valid = dailyAll.filter((r) => r.pcpn != null);
      const lastDate = valid.length ? valid[valid.length - 1].date : null;
      const lag = lastDate ? Math.round((new Date(endDate) - new Date(lastDate)) / 86400e3) : null;
      const upTo = (d) => dailyAll.filter((r) => r.date <= lastDate && r.date > addDays(lastDate, -d));
      const windows = [7, 30, 60, 90, 180, 365];
      const totals = windows.map((d) => { const rows = upTo(d); const ok = rows.filter((r) => r.pcpn != null); return { days: d, total: ok.length ? sumVals(ok.map((r) => r.pcpn)) : null, missing: d - ok.length }; });
      const nn = normals.map((s) => ({ ...s, km: haversineKm(lat, lon, s.lat, s.lon) })).filter((s) => s.total != null && s.missing <= 3).sort((a, b) => a.km - b.km)[0];
      const t30 = totals.find((t) => t.days === 30)?.total;
      const pctN = nn && t30 != null ? Math.round((100 * t30) / nn.normal) : null;
      const daily = dailyAll.filter((r) => r.date >= addDays(endDate, -89));
      const winRows = dailyAll.filter((r) => r.date >= addDays(endDate, -(days - 1)) && r.date <= endDate);
      const max1 = maxRun(winRows, 1), max2 = maxRun(winRows, 2);
      const a14 = atlas.nearest(lat, lon);
      const rp24 = a14 && max1 ? atlas.returnPeriod(a14, DUR24, max1.sum) : null;
      const rp48 = a14 && max2 ? atlas.returnPeriod(a14, DUR48, max2.sum) : null;
      const winValid = winRows.filter((r) => r.pcpn != null);
      const winTotal = winValid.length ? sumVals(winValid.map((r) => r.pcpn)) : null;
      $("pt-precip").innerHTML = `<h3>Gridded precipitation (PRISM 4 km via ACIS)</h3>
        ${lag > 0 ? `<div class="notice">PRISM's latest grid here is ${fmtDate(lastDate)} (${lag} day${lag > 1 ? "s" : ""} behind the selected date). Windows below end on that date; use the nearest observers for the last ${lag} day${lag > 1 ? "s" : ""}.</div>` : ""}
        <div class="stat-row">
          <div class="stat"><div class="v">${winTotal != null ? fmt(winTotal) + '"' : "–"}</div><div class="l">${days === 1 ? fmtDate(endDate) : days + "-day total"}</div><div class="s">${winValid.length < winRows.length ? `${winRows.length - winValid.length} day(s) not yet gridded` : ""}</div></div>
          <div class="stat ${pctN > 150 ? "warn" : pctN != null && pctN < 50 ? "bad" : ""}"><div class="v">${pctN != null ? pctN + "%" : "–"}</div><div class="l">30-day % of normal</div><div class="s">${nn ? `normal from ${escapeHtml(nn.name)} (${fmt(kmToMi(nn.km), 0)} mi)` : "no normals nearby"}</div></div>
          <div class="stat ${rp24?.years >= 10 ? "warn" : ""}"><div class="v">${max1 ? fmt(max1.sum) + '"' : "–"}</div><div class="l">max 1-day in window</div><div class="s">${max1 ? fmtDate(max1.end) : ""}${rp24 ? " · " + rp24.text : ""}${rp48 && days > 1 ? ` · 2-day ${fmt(max2.sum)}" ${rp48.text}` : ""}</div></div>
        </div>
        <div id="pt-daily" class="chart"></div>
        <table class="data"><thead><tr><th>Window</th>${totals.map((t) => `<th class="num">${t.days}d</th>`).join("")}</tr></thead><tbody><tr><td>PRISM, in</td>${totals.map((t) => `<td class="num">${fmt(t.total)}${t.missing ? "*" : ""}</td>`).join("")}</tr></tbody></table>
        <div class="small">Windows end ${lastDate ? fmtDate(lastDate) : "–"}; * = some days not gridded. PRISM is a modeled grid (gauge + radar + terrain) and can differ from the nearest gauge. Percent of normal uses the nearest station with 1991–2020 normals.</div>`;
      Plotly.newPlot("pt-daily", [{ x: daily.map((r) => r.date), y: daily.map((r) => r.pcpn ?? 0), type: "bar", marker: { color: daily.map((r) => (r.date >= addDays(endDate, -(days - 1)) ? "#38bdf8" : "#475569")) }, hovertemplate: "%{x}: %{y:.2f}\"<extra></extra>" }],
        plotlyLayout({ title: "PRISM daily precip, last 90 days", yaxis: { title: "in" }, showlegend: false }), { displayModeBar: false, responsive: true });
    } catch (e) { $("pt-precip").innerHTML = `<div class="notice">ACIS grid request failed: ${escapeHtml(e.message)}</div>`; }
  })();

  // NWS forecast + QPF
  (async () => {
    try {
      const p = await nws.pointInfo(lat, lon);
      const [periods, qpf, stns, alerts] = await Promise.all([nws.forecast(p), nws.gridQpf(p), nws.nearestStations(p, 1), nws.activeAlerts({ point: [lat, lon] }).catch(() => [])]);
      let obs = null; try { obs = stns[0] ? await nws.latestObs(stns[0].id) : null; } catch {}
      const next72 = qpf.values.filter((v) => v.start.getTime() < Date.now() + 72 * 3600e3 && v.start.getTime() + v.hours * 3600e3 > Date.now()).reduce((s, v) => s + v.inches, 0);
      const next24 = qpf.values.filter((v) => v.start.getTime() < Date.now() + 24 * 3600e3 && v.start.getTime() + v.hours * 3600e3 > Date.now()).reduce((s, v) => s + v.inches, 0);
      $("pt-wx").innerHTML = `<h3>NWS forecast · ${escapeHtml(p.relativeLocation?.properties?.city || "")}, grid ${p.gridId} ${p.gridX},${p.gridY}</h3>
        ${alerts.length ? alertsHtml(alerts) : ""}
        <div class="stat-row">
          <div class="stat ${next24 > 1 ? "warn" : ""}"><div class="v">${fmt(next24)}"</div><div class="l">QPF next 24 h</div></div>
          <div class="stat ${next72 > 2 ? "warn" : ""}"><div class="v">${fmt(next72)}"</div><div class="l">QPF next 72 h</div></div>
          ${obs ? `<div class="stat"><div class="v">${obs.tempF != null ? Math.round(obs.tempF) + "°" : "–"}</div><div class="l">${escapeHtml(stns[0].id)} now</div><div class="s">${escapeHtml(obs.text || "")}${obs.precip1hIn ? ` · ${fmt(obs.precip1hIn)}" last hr` : ""}</div></div>` : ""}
        </div>
        <div id="pt-qpf" class="chart"></div>
        <div class="forecast-row">${periods.slice(0, 8).map((f) => `<div class="fc"><div class="n">${escapeHtml(f.name)}</div><div class="t">${f.temperature}°</div><div class="p">${f.probabilityOfPrecipitation?.value != null ? f.probabilityOfPrecipitation.value + "% precip" : ""}</div><div class="d">${escapeHtml(f.shortForecast)}</div></div>`).join("")}</div>
        <div class="small">QPF = forecast quantitative precipitation from the NWS gridded forecast (updated ${qpf.updated ? fmtDateTime(qpf.updated) : "?"}). <a href="https://forecast.weather.gov/MapClick.php?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}" target="_blank" rel="noopener">Full forecast</a> · <a href="https://radar.weather.gov/station/${p.radarStation}/standard" target="_blank" rel="noopener">${p.radarStation} radar</a></div>`;
      const q = qpf.values.slice(0, 40);
      Plotly.newPlot("pt-qpf", [{ x: q.map((v) => v.start), y: q.map((v) => v.inches), type: "bar", width: q.map((v) => v.hours * 3600e3 * 0.9), marker: { color: "#38bdf8" }, hovertemplate: "%{x}: %{y:.2f}\" / %{customdata} h<extra></extra>", customdata: q.map((v) => v.hours) }],
        plotlyLayout({ title: "Forecast precipitation by period (in)", yaxis: { title: "in" }, showlegend: false }), { displayModeBar: false, responsive: true });
    } catch (e) { $("pt-wx").innerHTML = `<div class="notice">NWS request failed: ${escapeHtml(e.message)}</div>`; }
  })();

  // Open-Meteo soil moisture & hourly precip (past 7 d + next 7 d)
  (async () => {
    try {
      const w = await om.pointWeather(lat, lon);
      const h = w.hourly;
      const nowIdx = h.time.findIndex((t) => new Date(t) > new Date());
      $("pt-soil").innerHTML = `<h3>Model soil moisture & hourly precip (Open-Meteo)</h3><div id="pt-om" class="chart tall"></div>
        <div class="small">Soil moisture is volumetric (m³/m³) from the model's land surface, not a measurement; treat it as a wetness index for runoff potential. Past 7 days + 7-day forecast; the dashed line is now.</div>`;
      Plotly.newPlot("pt-om", [
        { x: h.time, y: h.precipitation, type: "bar", name: "Precip (in/h)", marker: { color: "#38bdf8" }, yaxis: "y2", opacity: 0.8 },
        { x: h.time, y: h.soil_moisture_0_to_7cm, mode: "lines", name: "Soil 0–7 cm", line: { color: "#f59e0b", width: 1.4 } },
        { x: h.time, y: h.soil_moisture_7_to_28cm, mode: "lines", name: "Soil 7–28 cm", line: { color: "#fb923c", width: 1.2 } },
        { x: h.time, y: h.soil_moisture_28_to_100cm, mode: "lines", name: "Soil 28–100 cm", line: { color: "#a16207", width: 1.2 } },
      ], plotlyLayout({ yaxis: { title: "m³/m³", range: [0, 0.6] }, yaxis2: { title: "in/h", overlaying: "y", side: "right", gridcolor: "rgba(0,0,0,0)", rangemode: "tozero" },
        shapes: nowIdx > 0 ? [{ type: "line", x0: h.time[nowIdx], x1: h.time[nowIdx], y0: 0, y1: 1, yref: "paper", line: { color: "#94a3b8", dash: "dash", width: 1 } }] : [] }), { displayModeBar: false, responsive: true });
    } catch (e) { $("pt-soil").innerHTML = `<div class="notice">Open-Meteo request failed: ${escapeHtml(e.message)}</div>`; }
  })();

  // Atlas 14 table
  const a14 = atlas.nearest(lat, lon);
  if (a14) {
    const durs = [4, 5, 6, 7, 8, 9, 10, 11, 13]; // 60-min … 7-day
    const aris = [1, 2, 3, 4, 5, 6]; // 1,2,5,10,25,50,100 → indexes
    const arisIdx = [0, 1, 2, 3, 4, 5, 6];
    $("pt-a14").innerHTML = `<h3>Design storms · NOAA Atlas 14 (PDS depth, in)</h3>
      <div style="overflow-x:auto"><table class="data"><thead><tr><th>Duration</th>${arisIdx.map((i) => `<th class="num">${a14.aris[i]}-yr</th>`).join("")}</tr></thead><tbody>
      ${durs.map((d) => `<tr><td>${a14.durations[d]}</td>${arisIdx.map((i) => `<td class="num">${fmt(a14.q[d][i])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <div class="small">Nearest precomputed grid node (${fmt(a14.lat, 1)}, ${fmt(a14.lon, 1)}; ${a14.step}° spacing ≈ ${Math.round(a14.step * 111 * 0.62)} mi). For submittals use the <a href="${atlas.pfdsUrl(lat, lon)}" target="_blank" rel="noopener">official PFDS point query</a>.</div>`;
  } else {
    $("pt-a14").innerHTML = `<h3>Design storms</h3><div class="notice">No Atlas 14 grid node here (outside the precomputed region or over water). <a href="${atlas.pfdsUrl(lat, lon)}" target="_blank" rel="noopener">Query PFDS directly</a>.</div>`;
  }
}
