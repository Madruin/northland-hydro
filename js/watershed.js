// Watershed section for the Point panel: StreamStats delineation, basin characteristics, regression flows,
// and TSA3 regional-curve bankfull dimensions. User-initiated (button), results cached per point.
import { $, escapeHtml, fmt, fmtNum, emit } from "./util.js";
import * as ss from "./api/streamstats.js";
import { setBasin } from "./map.js";
import { loadCurves, renderRegional, suggestCurve } from "./regional.js";

const cache = new Map(); // key lon,lat → { basin, bc, flows, huc }
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
    <div id="ws-body">${st ? "" : `<div class="small">Delineation calls USGS servers (about 15 s total) and draws the basin on the map. Use the drainage-area box to run the regional curves without delineating.</div>`}</div>`;
  $("ws-run").onclick = () => run(container, lon, lat, key);
  $("ws-da-go").onclick = () => { const da = Number($("ws-da").value); if (da > 0) { cache.set(key, { ...(cache.get(key) || {}), da, manual: true }); renderResults(container, lon, lat, key); } };
  if (st) renderResults(container, lon, lat, key);
}

async function run(container, lon, lat, key) {
  const body = $("ws-body");
  const state = ss.STATE_FOR(lon, lat);
  body.innerHTML = `<div class="spinner">Delineating (StreamStats ${state})…</div>`;
  try {
    const [del, curvesLoaded] = await Promise.all([ss.delineate(state, lat, lon), loadCurves()]);
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
    cache.set(key, { basin: del.basin, huc: del.huc, bc, bcByCode, da, flows, missing, matched, regions, state, manual: false });
    $("ws-da").value = da != null ? da.toFixed(2) : "";
    renderResults(container, lon, lat, key);
  } catch (e) {
    body.innerHTML = `<div class="notice">StreamStats failed: ${escapeHtml(e.message)}</div>`;
  }
}

function renderResults(container, lon, lat, key) {
  const st = cache.get(key);
  const body = $("ws-body");
  const da = st.da;
  const curveId = curveChoice || suggestCurve({ huc: st.huc, lat, lon });
  body.innerHTML = `
    ${st.manual ? `<div class="notice">Drainage area entered manually (${fmt(da, 2)} mi²); no delineation. Regional-curve suggestion is based on location only.</div>` : `
    <div class="stat-row">
      <div class="stat"><div class="v">${fmt(da, 2)}</div><div class="l">drainage area, mi²</div><div class="s">HUC ${escapeHtml(st.huc || "?")}</div></div>
      <div class="stat"><div class="v">${fmt(st.bcByCode.BSLDEM10M, 1)}%</div><div class="l">mean basin slope</div></div>
      <div class="stat"><div class="v">${fmt(st.bcByCode.CSL10_85, 1)}</div><div class="l">channel slope 10-85, ft/mi</div></div>
      <div class="stat"><div class="v">${fmt(st.bcByCode.LAKEAREA, 1)}%</div><div class="l">lakes & ponds</div><div class="s">storage NWI ${fmt(st.bcByCode.STORNWI, 1)}%</div></div>
    </div>
    <details><summary class="small" style="cursor:pointer">All basin characteristics (${st.bc.length})</summary>
      <table class="data"><tbody>${st.bc.map((b) => `<tr><td title="${escapeHtml(b.description || "")}">${escapeHtml(b.name)} <span class="small">${b.code}</span></td><td class="num">${fmtNum(b.value, 3)}</td><td class="small">${escapeHtml(b.unit || "")}</td></tr>`).join("")}</tbody></table></details>
    ${flowsHtml(st)}`}
    <h3>Bankfull channel dimensions · TSA3 regional curves</h3>
    <div id="ws-regional"></div>`;
  loadCurves().then(() => renderRegional($("ws-regional"), { da, huc: st.huc, lat, lon, curveId, onChangeCurve: (id) => { curveChoice = id; renderResults(container, lon, lat, key); } }));
}

function flowsHtml(st) {
  if (!st.flows) return `<div class="notice">Regression flow statistics unavailable for this point${st.regions?.length ? "" : " (no NSS regression region found here)"}.</div>`;
  const groups = st.flows;
  const sec = groups.map((sg) => {
    const rows = sg.regressionRegions.flatMap((rr) => (rr.results || []).map((r) => ({ ...r, region: rr.name })));
    if (!rows.length) return "";
    const cite = sg.regressionRegions[0]?.name?.match(/(\d{4})_(\d{4})/) ? `USGS SIR ${sg.regressionRegions[0].name.match(/(\d{4})_(\d{4})/).slice(1).join("-")}` : "";
    const oor = rows.some((r) => (r.errors || []).length === 0);
    return `<h3>${escapeHtml(sg.statisticGroupName)} <span class="small">${escapeHtml(sg.regressionRegions.map((r) => r.name).join(", "))}${cite ? " · " + cite : ""}</span></h3>
      <table class="data"><thead><tr><th>Statistic</th><th class="num">Value</th><th class="num">PI low</th><th class="num">PI high</th><th class="num">SEp %</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${escapeHtml(r.name)} <span class="small">${escapeHtml(r.code)}</span></td><td class="num">${fmtNum(r.value, r.value < 10 ? 2 : 0)}</td><td class="num">${r.intervalBounds ? fmtNum(r.intervalBounds.lower, 0) : "–"}</td><td class="num">${r.intervalBounds ? fmtNum(r.intervalBounds.upper, 0) : "–"}</td><td class="num">${fmt((r.errors || []).find((e) => /prediction/i.test(e.name))?.value, 0)}</td></tr>`).join("")}</tbody></table>`;
  }).join("");
  const warn = [];
  if (st.missing?.length) warn.push(`Missing basin characteristics for some equations: ${st.missing.join(", ")}.`);
  const outOfRange = [];
  for (const sg of groups) for (const rr of sg.regressionRegions) for (const p of rr.parameters || []) if (p.limits && (p.value < p.limits.min || p.value > p.limits.max)) outOfRange.push(`${p.code} = ${fmtNum(p.value, 2)} (equation range ${fmtNum(p.limits.min, 2)}–${fmtNum(p.limits.max, 2)})`);
  if (outOfRange.length) warn.push(`Outside the regression's applicable range: ${outOfRange.join("; ")}.`);
  return sec + (warn.length ? `<div class="small">⚠ ${warn.map(escapeHtml).join(" ")}</div>` : "") + `<div class="small">Units: ft³/s. PI = 90% prediction interval; SEp = average standard error of prediction. Regression region taken from the StreamStats region layer at the pour point (not area-weighted). Values match the StreamStats web application's "Peak-Flow Statistics" for the same point.</div>`;
}

export function clearBasin() { setBasin(null); }
