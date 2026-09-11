// Lake section for the Point panel: DNR LakeFinder levels, OHW, hydrograph, outlet/control structures.
import { plot } from "./loader.js";
import { $, escapeHtml, fmt, fmtNum, fmtDate, haversineKm, kmToMi, plotlyLayout } from "./util.js";
import * as dnr from "./api/dnrlakes.js";
import { setLake } from "./map.js";

export async function renderLakeAt(container, lon, lat) {
  container.innerHTML = "";
  let lake = null;
  try { lake = await dnr.lakeAt(lon, lat); } catch (e) { console.warn("lake lookup failed", e); return; }
  if (!lake) { setLake(null); return; }
  const p = lake.props;
  const dow = p.dowlknum;
  const name = p.pw_basin_name || p.pw_parent_name || "Unnamed basin";
  setLake({ type: "Feature", geometry: lake.geometry, properties: { name } });
  container.innerHTML = `<h3>Lake · MN DNR LakeFinder</h3>
    <div><b>${escapeHtml(name)}</b> <span class="small">· DOW ${escapeHtml(dow)} · ${escapeHtml(p.cty_name || "")} County · ${escapeHtml(p.wb_class || "")}${p.pwi_class ? " · PWI " + escapeHtml(p.pwi_class) : ""}</span></div>
    <div class="small">${fmtNum(p.acres, 0)} ac · ${fmt(p.shore_mi, 1)} mi shoreline${p.in_lakefinder !== "Y" ? " · not in LakeFinder" : ""}</div>
    <div id="lk-levels"><div class="spinner">Water levels…</div></div>
    <div id="lk-outlet"><div class="spinner">Outlet / control structures…</div></div>
    <div id="lk-morph"></div>
    <div class="actions"><a class="btn" href="${dnr.lakefinderUrl(dow)}" target="_blank" rel="noopener">LakeFinder</a><a class="btn" href="${dnr.levelsPageUrl(dow)}" target="_blank" rel="noopener">Water levels page</a><a class="btn" href="${dnr.levelsCsvUrl(dow)}" target="_blank" rel="noopener">Levels CSV</a></div>`;

  // Water levels: summary from the page (OHW, datum, extremes) + readings CSV → chart
  (async () => {
    const box = $("lk-levels");
    if (!box) return;
    try {
      const [sum, rows] = await Promise.all([dnr.levelSummary(dow).catch(() => null), dnr.waterLevels(dow).catch(() => [])]);
      if (!box.isConnected) return;
      if ((!rows || !rows.length) && (!sum || sum.noData || sum.ohw == null)) { box.innerHTML = `<div class="notice">No DNR water-level record or OHW for this basin.</div>`; return; }
      const last = rows[rows.length - 1];
      const datum = sum?.datum || last?.datum || "";
      const ohw = sum?.ohw;
      box.innerHTML = `
        <div class="stat-row">
          <div class="stat"><div class="v">${ohw != null ? fmt(ohw, 2) : "–"}</div><div class="l">OHW elevation, ft</div><div class="s">${escapeHtml(datum)}</div></div>
          <div class="stat ${ohw != null && last && last.ft > ohw ? "warn" : ""}"><div class="v">${last ? fmt(last.ft, 2) : "–"}</div><div class="l">last reading, ft</div><div class="s">${last ? fmtDate(last.date) : ""}${ohw != null && last ? ` · ${last.ft >= ohw ? "+" : ""}${fmt(last.ft - ohw, 2)} vs OHW` : ""}</div></div>
          <div class="stat"><div class="v">${sum?.range != null ? fmt(sum.range, 2) : rows.length ? fmt(Math.max(...rows.map((r) => r.ft)) - Math.min(...rows.map((r) => r.ft)), 2) : "–"}</div><div class="l">recorded range, ft</div><div class="s">${sum?.highest != null ? `high ${fmt(sum.highest, 2)} (${escapeHtml(sum.highestDate || "")})` : ""}${sum?.lowest != null ? ` · low ${fmt(sum.lowest, 2)} (${escapeHtml(sum.lowestDate || "")})` : ""}</div></div>
        </div>
        <div class="small">${sum?.period ? `Period of record ${escapeHtml(sum.period)}, ${sum.readings ?? rows.length} readings.` : `${rows.length} readings.`} OHW is the DNR's regulatory Ordinary High Water Level; elevations are in the datum shown, which is often a local or MSL 1912 datum rather than NAVD88. Check the benchmarks before using with lidar.</div>
        ${rows.length ? `<div id="lk-chart" class="chart"></div>` : `<img class="hydro-img" alt="DNR hydrograph" src="${dnr.hydrographUrl(dow, name, { all: true })}" />`}
        ${sum?.benchmarks ? `<details><summary class="small" style="cursor:pointer">Benchmarks</summary><div class="small">${escapeHtml(sum.benchmarks)}</div></details>` : ""}`;
      if (rows.length) {
        const traces = [{ x: rows.map((r) => r.date), y: rows.map((r) => r.ft), mode: rows.length > 400 ? "lines" : "lines+markers", marker: { size: 4 }, line: { color: "#38bdf8", width: 1.4 }, name: "Level (ft)" }];
        if (ohw != null) traces.push({ x: [rows[0].date, last.date], y: [ohw, ohw], mode: "lines", line: { color: "#f59e0b", dash: "dot", width: 1.4 }, name: `OHW ${fmt(ohw, 1)}` });
        plot("lk-chart", traces, plotlyLayout({ title: `Water level, ${escapeHtml(datum)}`, yaxis: { title: "ft" } }), { displayModeBar: false, responsive: true });
      }
    } catch (e) { box.innerHTML = `<div class="notice">Water levels unavailable: ${escapeHtml(e.message)}</div>`; }
  })();

  // Outlet / control structures: DNR dams inventory within the lake's envelope plus a margin
  (async () => {
    const box = $("lk-outlet");
    if (!box) return;
    try {
      const bb = envelope(lake.geometry);
      const pad = 0.006; // ~0.5 km
      const dams = await dnr.damsInBbox([bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad]);
      if (!box.isConnected) return;
      const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
      const rows = dams.map((d) => ({ ...d, km: haversineKm(cy, cx, d.lat, d.lon) })).sort((a, b) => a.km - b.km);
      if (!rows.length) { box.innerHTML = `<h3>Outlet</h3><div class="small">No dam or control structure in the DNR dams inventory within about 0.5 km of this basin. Treat the outlet as uncontrolled unless local records say otherwise; the OHW determination file (DNR Area Hydrologist) usually describes the natural outlet control.</div>`; return; }
      box.innerHTML = `<h3>Outlet / control structures (DNR dams inventory)</h3>
        <table class="data"><thead><tr><th>Structure</th><th>Purpose · owner</th><th class="num">Spillway el.</th><th class="num">Top of dam</th><th class="num">Height ft</th><th>Datum</th><th>Hazard</th></tr></thead><tbody>
        ${rows.map((d) => `<tr><td><b>${escapeHtml(d.dam_name || "")}</b><div class="small">${escapeHtml(d.nid_id || "")} · ${escapeHtml(d.river || "")}${d.year_completed ? " · built " + d.year_completed : ""}${d.year_mod ? ", mod. " + escapeHtml(String(d.year_mod)) : ""}</div></td><td>${escapeHtml(d.present_purpose || "")}<div class="small">${escapeHtml(d.owner || "")}</div></td><td class="num">${d.prin_spill_elev != null ? fmt(d.prin_spill_elev, 1) : "–"}</td><td class="num">${d.top_dam_elev != null ? fmt(d.top_dam_elev, 1) : "–"}</td><td class="num">${d.top_dam_hgt != null ? fmt(d.top_dam_hgt, 1) : "–"}</td><td class="small">${escapeHtml(d.datum_elev || "")}</td><td>${escapeHtml(d.hazard || "")}${d.condition_assessment ? `<div class="small">${escapeHtml(d.condition_assessment)}</div>` : ""}</td></tr>`).join("")}
        </tbody></table>
        ${rows.some((d) => d.comments) ? `<div class="small">${rows.filter((d) => d.comments).map((d) => `<b>${escapeHtml(d.dam_name)}:</b> ${escapeHtml(d.comments)}`).join("<br>")}</div>` : ""}
        <div class="small">Spillway el. = principal spillway (outlet crest) elevation as recorded by DNR Dam Safety; "Project/Local" datum means it is not tied to a geodetic datum.</div>`;
    } catch (e) { box.innerHTML = `<div class="notice">Dams inventory unavailable: ${escapeHtml(e.message)}</div>`; }
  })();

  // Morphology from LakeFinder
  (async () => {
    try {
      const d = await dnr.lakeDetail(dow);
      if (!d || !$("lk-morph")) return;
      $("lk-morph").innerHTML = `<div class="small">LakeFinder: ${d.areaAcres ? fmtNum(d.areaAcres) + " ac" : ""}${d.littoralAcres ? ` · littoral ${fmtNum(d.littoralAcres)} ac` : ""}${d.maxDepthFeet ? ` · max depth ${d.maxDepthFeet} ft` : ""}${d.meanDepthFeet ? ` · mean depth ${d.meanDepthFeet} ft` : ""}${d.averageWaterClarity ? ` · clarity ${d.averageWaterClarity} ft` : ""}${d.surveys?.length ? ` · last fisheries survey ${d.surveys[0].surveyDate}` : ""}</div>`;
    } catch {}
  })();
}

function envelope(g) {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  let w = 180, s = 90, e = -180, n = -90;
  for (const p of polys) for (const pt of p[0]) { if (pt[0] < w) w = pt[0]; if (pt[0] > e) e = pt[0]; if (pt[1] < s) s = pt[1]; if (pt[1] > n) n = pt[1]; }
  return [w, s, e, n];
}
