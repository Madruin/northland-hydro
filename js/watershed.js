// Watershed section for the Point panel: StreamStats delineation, basin characteristics, regression flows,
// and TSA3 regional-curve bankfull dimensions. User-initiated (button), results cached per point,
// and savable to a team project (Supabase) so a design basis is reproducible later.
import { $, escapeHtml, fmt, fmtNum, fmtDateTime } from "./util.js";
import * as ss from "./api/streamstats.js";
import * as db from "./api/supabase.js";
import { setBasin, setPin } from "./map.js";
import { loadCurves, renderRegional, suggestCurve, compute, curves } from "./regional.js";
import { authState } from "./projects.js";

const cache = new Map(); // key lon,lat → state
let curveChoice = null;

export function renderWatershed(container, lon, lat) {
  const key = `${lon.toFixed(5)},${lat.toFixed(5)}`;
  const st = cache.get(key);
  container.innerHTML = `<h3>Watershed · USGS StreamStats + TSA3 regional curves</h3>
    <div class="actions">
      <button class="btn primary" id="ws-run">${st ? "Re-run" : "Delineate watershed"}</button>
      <label class="ctl-inline">or drainage area, mi² <input id="ws-da" type="number" step="0.01" min="0.01" style="width:90px" value="${st?.da ?? ""}" /></label>
      <button class="btn" id="ws-da-go">Curves only</button>
      <a class="btn" href="${ss.streamstatsUrl(lat, lon)}" target="_blank" rel="noopener">Open in StreamStats</a>
    </div>
    <label class="chk" title="Move the point to the nearest StreamStats stream-grid cell within 200 m before delineating (what the StreamStats app does). Uncheck to delineate exactly where you clicked."><input type="checkbox" id="ws-snap" ${snapPref() ? "checked" : ""}/> snap to nearest mapped stream before delineating</label>
    <div id="ws-body">${st ? "" : `<div class="small">Delineation calls USGS servers (about 15 s total) and draws the basin on the map. Use the drainage-area box to run the regional curves without delineating.</div>`}</div>`;
  $("ws-run").onclick = () => run(container, lon, lat, key);
  $("ws-snap").onchange = (e) => { try { localStorage.setItem("nh-snap", e.target.checked ? "1" : "0"); } catch {} };
  $("ws-da-go").onclick = () => { const da = Number($("ws-da").value); if (da > 0) { cache.set(key, { ...(cache.get(key) || {}), da, manual: true }); renderLive(container, lon, lat, key); } };
  if (st) renderLive(container, lon, lat, key);
}

async function run(container, lon, lat, key) {
  const body = $("ws-body");
  const state = ss.STATE_FOR(lon, lat);
  body.innerHTML = `<div class="spinner">Delineating (StreamStats ${state})…</div>`;
  try {
    // Snap to the stream grid first, as the StreamStats app does; an off-stream click otherwise delineates a sliver.
    let snapNote = "";
    if ($("ws-snap")?.checked) {
      body.innerHTML = `<div class="spinner">Snapping to the nearest mapped stream…</div>`;
      try {
        const sn = await ss.snapToStreamGrid(state, lat, lon, 200);
        if (sn.snapped && sn.distM > 2) { snapNote = `Point snapped ${Math.round(sn.distM * 3.28084)} ft to the nearest mapped stream cell.`; lat = sn.lat; lon = sn.lon; setPin([lon, lat]); }
        else if (!sn.snapped) snapNote = "No mapped stream within 200 m of the click; delineating at the click itself.";
      } catch (e) { console.warn("snap failed", e); snapNote = "Stream-grid snap unavailable (service error); delineating at the click itself."; }
      body.innerHTML = `<div class="spinner">Delineating (StreamStats ${state})…</div>`;
    }
    const [del] = await Promise.all([ss.delineate(state, lat, lon), loadCurves()]);
    if (!del.basin) throw new Error("No basin returned. The point may be off the stream network or in an exclusion area; try clicking on the blue line.");
    setBasin(del.basin, del.pourpoint);
    body.innerHTML = `<div class="spinner">Basin drawn. Computing basin characteristics (~8 s)…</div>`;
    const [bc, regions, scn] = await Promise.all([ss.basinCharacteristics(state, lat, lon), ss.regressionRegionsAt(state, lat, lon).catch(() => []), ss.scenarios(state).catch(() => [])]);
    const bcByCode = Object.fromEntries(bc.map((b) => [b.code, b.value]));
    const da = bcByCode.DRNAREA;
    let flows = null, missing = [], matched = [];
    if (regions.length && scn.length) {
      matched = ss.matchRegions(regions, scn);
      if (matched.length) {
        body.innerHTML = `<div class="spinner">Estimating regression flows…</div>`;
        try { const est = await ss.estimate(state, matched, bcByCode); flows = est.result; missing = est.missing; } catch (e) { console.warn("NSS estimate failed", e); }
      }
    }
    const warnings = [];
    if (snapNote) warnings.push(snapNote);
    if (del.areaSqMi < 0.02) warnings.push("The delineated area is a tiny sliver: this point is not on a mapped stream cell. Zoom in and click on the stream line, then re-run.");
    else if (da > 0.5 && Math.abs(del.areaSqMi - da) / da > 0.05) warnings.push(`Drawn basin (${del.areaSqMi.toFixed(1)} mi²) and computed drainage area (${da.toFixed(1)} mi²) differ by more than 5%; the computed value is authoritative.`);
    cache.set(key, { basin: del.basin, huc: del.huc, bc, bcByCode, da, flows, missing, regions, state, manual: false, retrievedAt: new Date().toISOString(), pour: { lat, lon }, warnings });
    $("ws-da").value = da != null ? da.toFixed(2) : "";
    renderLive(container, lon, lat, key);
  } catch (e) {
    body.innerHTML = `<div class="notice">StreamStats failed: ${escapeHtml(e.message)}</div>`;
  }
}

function renderLive(container, lon, lat, key) {
  const st = cache.get(key);
  const curveId = curveChoice || suggestCurve({ huc: st.huc, lat, lon });
  renderResultsInto($("ws-body"), st, lon, lat, {
    curveId,
    onChangeCurve: (id) => { curveChoice = id; renderLive(container, lon, lat, key); },
    saveUI: !st.manual,
  });
}

// Shared renderer for live results and saved analyses.
function renderResultsInto(body, st, lon, lat, { curveId, onChangeCurve, saveUI = false, saved = null } = {}) {
  const da = st.da;
  const bcByCode = st.bcByCode || Object.fromEntries((st.bc || []).map((b) => [b.code, b.value]));
  const auth = authState();
  body.innerHTML = `
    ${saveUI && auth.member && !saved ? `<div class="save-row">
      <span class="small">Save to project</span>
      <select class="ws-save-project">${auth.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}</select>
      <input class="ws-save-label" placeholder="label (optional), e.g. Alt 2 culvert site" />
      <button class="btn primary ws-save">Save</button><span class="small ws-save-msg"></span></div>` : saveUI && !auth.user ? `<div class="small">Sign in on the Projects tab to save this analysis to a project.</div>` : ""}
    ${saved ? `<div class="notice">Saved analysis from ${fmtDateTime(saved.created_at)} by ${escapeHtml(saved.created_by || "?")}${saved.label ? ` · ${escapeHtml(saved.label)}` : ""}. Numbers below are as retrieved then; re-run at the point for current values.</div>` : ""}
    ${(st.warnings || []).map((w) => `<div class="notice">⚠ ${escapeHtml(w)}</div>`).join("")}
    ${st.manual ? `<div class="notice">Drainage area entered manually (${fmt(da, 2)} mi²); no delineation. Regional-curve suggestion is based on location only.</div>` : `
    <div class="stat-row">
      <div class="stat"><div class="v">${fmt(da, 2)}</div><div class="l">drainage area, mi²</div><div class="s">HUC ${escapeHtml(st.huc || "?")}</div></div>
      <div class="stat"><div class="v">${fmt(bcByCode.BSLDEM10M, 1)}%</div><div class="l">mean basin slope</div></div>
      <div class="stat"><div class="v">${fmt(bcByCode.CSL10_85, 1)}</div><div class="l">channel slope 10-85, ft/mi</div></div>
      <div class="stat"><div class="v">${fmt(bcByCode.LAKEAREA, 1)}%</div><div class="l">lakes & ponds</div><div class="s">storage NWI ${fmt(bcByCode.STORNWI, 1)}%</div></div>
    </div>
    <details><summary class="small" style="cursor:pointer">All basin characteristics (${(st.bc || []).length})</summary>
      <table class="data"><tbody>${(st.bc || []).map((b) => `<tr><td title="${escapeHtml(b.description || "")}">${escapeHtml(b.name)} <span class="small">${b.code}</span></td><td class="num">${fmtNum(b.value, 3)}</td><td class="small">${escapeHtml(b.unit || "")}</td></tr>`).join("")}</tbody></table></details>
    ${flowsHtml(st)}`}
    <h3>Bankfull channel dimensions · TSA3 regional curves</h3>
    <div class="ws-regional"></div>
`;
  loadCurves().then(() => renderRegional(body.querySelector(".ws-regional"), { da, huc: st.huc, lat, lon, curveId, onChangeCurve }));
  const saveBtn = body.querySelector(".ws-save");
  if (saveBtn) saveBtn.onclick = async () => {
    const msg = body.querySelector(".ws-save-msg");
    const projectId = body.querySelector(".ws-save-project").value;
    if (!projectId) { msg.textContent = "Pick a project."; return; }
    msg.textContent = "Saving…";
    try {
      await db.insertAnalysis(toRecord(st, lon, lat, curveId, projectId, body.querySelector(".ws-save-label").value.trim() || null));
      msg.textContent = "Saved. It's listed under the project.";
    } catch (e) { msg.textContent = "Save failed: " + e.message; }
  };
}

function toRecord(st, lon, lat, curveId, projectId, label) {
  const chosen = compute(curveId, st.da);
  const others = curves().filter((c) => c.id !== curveId).map((c) => compute(c.id, st.da)).filter(Boolean);
  const strip = (r) => r && { curveId: r.curve.id, curveName: r.curve.name, sourceFile: r.curve.source_file, rows: r.rows.map((x) => ({ type: x.type, area: x.area, width: x.width, depth: x.depth, wd: x.wd, q: x.q, v: x.v })), warnings: r.warnings };
  return {
    project_id: projectId, kind: "watershed", label,
    pour_lat: lat, pour_lon: lon, state: st.state || null, huc: st.huc || null, drainage_area_sqmi: st.da ?? null,
    basin_geojson: st.basin || null, basin_chars: st.bc || null, flows: st.flows || null, regions: st.regions || null,
    regional_curve_id: curveId, regional: { chosen: strip(chosen), others: others.map(strip) },
    sources: {
      retrieved_at: st.retrievedAt || new Date().toISOString(),
      delineate: `https://streamstats.usgs.gov/ss-delineate/v1/delineate/features/${st.state}?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`,
      basin_characteristics: `https://streamstats.usgs.gov/ss-hydro/v1/basin-characteristics/calculate-using-ssdelineate/?region=${st.state}&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`,
      flows: "https://streamstats.usgs.gov/nssservices/scenarios/estimate", streamstats_app: ss.streamstatsUrl(lat, lon),
      regional_curves: curves().map((c) => ({ id: c.id, file: c.source_file, modified: c.source_modified })),
    },
  };
}

// Render a saved analysis (from Supabase) into a container and draw its basin.
export function renderSavedAnalysis(container, a) {
  const st = { basin: a.basin_geojson, huc: a.huc, bc: a.basin_chars || [], da: a.drainage_area_sqmi, flows: a.flows, regions: a.regions, state: a.state, manual: !a.basin_chars, missing: [] };
  if (a.basin_geojson) setBasin(a.basin_geojson);
  renderResultsInto(container, st, a.pour_lon, a.pour_lat, { curveId: a.regional_curve_id, onChangeCurve: (id) => { a.regional_curve_id = id; renderSavedAnalysis(container, a); }, saved: a });
}

// Short summary for lists: DA, Q1%, curve
export function summarizeAnalysis(a) {
  let q100 = null;
  for (const sg of a.flows || []) for (const rr of sg.regressionRegions || []) for (const r of rr.results || []) if (r.code === "PK1AEP") q100 = r.value;
  const c = a.regional?.chosen;
  const cRow = c?.rows?.find((r) => r.type === "C") || c?.rows?.[0];
  return { q100, curveName: c?.curveName?.replace(" Regional Curve", "") || a.regional_curve_id, width: cRow?.width, area: cRow?.area };
}

function flowsHtml(st) {
  if (!st.flows) return `<div class="notice">Regression flow statistics unavailable for this point${st.regions?.length ? "" : " (no NSS regression region found here)"}.</div>`;
  const groups = st.flows;
  const sec = groups.map((sg) => {
    const rows = sg.regressionRegions.flatMap((rr) => (rr.results || []).map((r) => ({ ...r, region: rr.name })));
    if (!rows.length) return "";
    const m = sg.regressionRegions[0]?.name?.match(/(\d{4})_(\d{4})/);
    const cite = m ? `USGS SIR ${m[1]}-${m[2]}` : "";
    return `<h3>${escapeHtml(sg.statisticGroupName)} <span class="small">${escapeHtml(sg.regressionRegions.map((r) => r.name).join(", "))}${cite ? " · " + cite : ""}</span></h3>
      <table class="data"><thead><tr><th>Statistic</th><th class="num">Value</th><th class="num">PI low</th><th class="num">PI high</th><th class="num">SEp %</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${escapeHtml(r.name)} <span class="small">${escapeHtml(r.code)}</span></td><td class="num">${fmtNum(r.value, r.value < 10 ? 2 : 0)}</td><td class="num">${r.intervalBounds ? fmtNum(r.intervalBounds.lower, 0) : "–"}</td><td class="num">${r.intervalBounds ? fmtNum(r.intervalBounds.upper, 0) : "–"}</td><td class="num">${fmt((r.errors || []).find((e) => /prediction/i.test(e.name))?.value, 0)}</td></tr>`).join("")}</tbody></table>`;
  }).join("");
  const warn = [];
  if (st.missing?.length) warn.push(`Missing basin characteristics for some equations: ${st.missing.join(", ")}.`);
  const outOfRange = [];
  for (const sg of groups) for (const rr of sg.regressionRegions) for (const p of rr.parameters || []) if (p.limits && (p.value < p.limits.min || p.value > p.limits.max)) outOfRange.push(`${p.code} = ${fmtNum(p.value, 2)} (equation range ${fmtNum(p.limits.min, 2)}–${fmtNum(p.limits.max, 2)})`);
  if (outOfRange.length) warn.push(`Outside the regression's applicable range: ${outOfRange.join("; ")}.`);
  return sec + (warn.length ? `<div class="small">⚠ ${warn.map(escapeHtml).join(" ")}</div>` : "") + `<div class="small">Units: cfs (ft³/s). PI = 90% prediction interval; SEp = average standard error of prediction. Regression region taken from the StreamStats region layer at the pour point (not area-weighted). Values match the StreamStats web application's "Peak-Flow Statistics" for the same point.</div>`;
}

export function clearBasin() { setBasin(null); }
function snapPref() { try { return localStorage.getItem("nh-snap") !== "0"; } catch { return true; } }
function haversineM(lat1, lon1, lat2, lon2) { const R = 6371000, r = Math.PI / 180; const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)); }
export function getLiveState(lon, lat) { return cache.get(`${lon.toFixed(5)},${lat.toFixed(5)}`) || null; }
export function analysisToState(a) { return { basin: a.basin_geojson, huc: a.huc, bc: a.basin_chars || [], da: a.drainage_area_sqmi, flows: a.flows, regions: a.regions, state: a.state, manual: !a.basin_chars, missing: [], retrievedAt: a.sources?.retrieved_at || a.created_at, savedAt: a.created_at, savedBy: a.created_by, label: a.label, curveId: a.regional_curve_id }; }
