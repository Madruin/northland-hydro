// TSA3 regional curves: bankfull channel dimensions from drainage area, reproducing the office spreadsheets.
// Data: data/regional_curves.json built by tools/build_regional_curves.py from the S:\ workbooks.
import { $, escapeHtml, fmt, getJSON, plotlyLayout } from "./util.js";

let DATA = null;
export async function loadCurves() {
  if (!DATA) DATA = await getJSON("data/regional_curves.json", { ttl: 86400e3 });
  return DATA;
}
export const curves = () => DATA?.curves || [];
export const curveById = (id) => curves().find((c) => c.id === id);

const pow = (eq, da) => eq.a * Math.pow(da, eq.b);
const poly = (coefs, x) => coefs.reduce((acc, c) => acc * x + c, 0);

// Suggest a curve from the HUC8 of the delineated basin, else from position.
export function suggestCurve({ huc, lat, lon }) {
  const h8 = (huc || "").slice(0, 8);
  if (["04010101", "04010102"].includes(h8)) return "north_shore";
  if (["04010201", "04010202", "04010301"].includes(h8)) return "cloquet_st_louis";
  if (h8.startsWith("0703") || h8 === "07010207") return "eastern_mn";
  if (lat != null && lat < 46.45 && lon < -92.3) return "eastern_mn";
  if (lat != null && lon < -92.15 && lat < 47.6) return "cloquet_st_louis";
  return "north_shore";
}

// Compute dimensions for one curve at drainage area `da` (mi²). Returns { rows: [{type,label,area,width,depth,wd,q,v,notes}], warnings[] }
export function compute(curveId, da, { useRefit = false } = {}) {
  const c = curveById(curveId);
  if (!c || !(da > 0)) return null;
  const rows = [], warnings = [];
  if (c.id === "north_shore") {
    for (const [t, spec] of Object.entries(c.types)) {
      const eq = spec.equations, rf = spec.refit;
      const A = useRefit && rf.area ? pow(rf.area, da) : pow(eq.area, da);
      const W = useRefit && rf.width ? pow(rf.width, da) : pow(eq.width, da);
      const D = useRefit && rf.depth ? pow(rf.depth, da) : pow(eq.depth, da);
      const Q = useRefit && c.discharge_refit ? pow(c.discharge_refit, da) : pow(eq.discharge, da);
      rows.push({ type: t, label: spec.label, area: A, width: W, depth: D, wd: W / D, q: Q, v: Q / A, n: rf.area?.n, range: [rf.area?.da_min, rf.area?.da_max] });
      if (rf.area && (da < rf.area.da_min || da > rf.area.da_max)) warnings.push(`${t}: ${fmt(da, 1)} mi² is outside the surveyed range (${rf.area.da_min}–${rf.area.da_max} mi²).`);
    }
    warnings.push("Width × depth from the separate regressions will not exactly equal the area regression; the spreadsheet reports all three independently.");
  } else if (c.id === "cloquet_st_louis") {
    for (const [t, spec] of Object.entries(c.types)) {
      const eq = spec.equations;
      const A = useRefit && c.all_area_refit ? pow(c.all_area_refit, da) : pow(eq.area, da);
      const W = Math.sqrt(A * eq.wd_ratio), D = W / eq.wd_ratio, Q = A * eq.velocity_fps;
      rows.push({ type: t, label: spec.label, area: A, width: W, depth: D, wd: eq.wd_ratio, q: Q, v: eq.velocity_fps, n: c.all_area_refit?.n, range: [c.all_area_refit?.da_min, c.all_area_refit?.da_max] });
    }
    const r = c.all_area_refit;
    if (r && (da < r.da_min || da > r.da_max)) warnings.push(`${fmt(da, 1)} mi² is outside the surveyed range (${r.da_min}–${r.da_max} mi²).`);
    warnings.push("Width and depth are derived from an assumed W/D ratio, not measured; discharge assumes 3.5 ft/s bankfull velocity.");
  } else if (c.id === "eastern_mn") {
    const eq = c.equations;
    const A = da < 5 ? poly(eq.area_lt5.coefs, da) : pow(eq.area_ge5, da);
    const W = pow(eq.width, da), D = pow(eq.depth, da), Q = poly(eq.discharge.coefs, da);
    rows.push({ type: "all", label: "All channel types (no stream-type split)", area: A, width: W, depth: D, wd: W / D, q: Q, v: Q / A, range: [0.1, 1000] });
    if (da < 5) warnings.push("Below 5 mi² the area equation is a cubic polynomial fit to a digitized curve; treat as approximate.");
    if (da > 1000) warnings.push("Beyond the 1,000 mi² extent of the source curves.");
    warnings.push("Least reliable curve: fit to curve-read values, not surveyed sites. Compare with North Shore C and E.");
  }
  return { curve: c, da, rows, warnings };
}

// Render a full section: curve selector, table for the chosen curve, comparison across all curves, log-log chart.
export function renderRegional(container, { da, huc, lat, lon, curveId, onChangeCurve }) {
  if (!DATA) { container.innerHTML = `<div class="notice">Regional curve data not loaded.</div>`; return; }
  const id = curveId || suggestCurve({ huc, lat, lon });
  const res = compute(id, da);
  if (!res) { container.innerHTML = `<div class="notice">Enter a drainage area to compute bankfull dimensions.</div>`; return; }
  const c = res.curve;
  const others = curves().filter((x) => x.id !== id).map((x) => compute(x.id, da)).filter(Boolean);
  container.innerHTML = `
    <div class="row2" style="align-items:end">
      <label class="ctl-inline">Regional curve<select id="rc-curve">${curves().map((x) => `<option value="${x.id}" ${x.id === id ? "selected" : ""}>${escapeHtml(x.name)}</option>`).join("")}</select></label>
      <div class="small">${escapeHtml(c.region)}</div>
    </div>
    <div class="small" style="margin:4px 0 8px">${escapeHtml(c.reliability)}</div>
    <table class="data"><thead><tr><th>Type</th><th class="num">Area ft²</th><th class="num">Width ft</th><th class="num">Depth ft</th><th class="num">W/D</th><th class="num">Q<sub>bkf</sub> cfs</th><th class="num">V ft/s</th></tr></thead><tbody>
      ${res.rows.map((r) => `<tr><td title="${escapeHtml(r.label)}">${escapeHtml(r.type === "all" ? "All" : r.type)}</td><td class="num">${fmt(r.area, 1)}</td><td class="num">${fmt(r.width, 1)}</td><td class="num">${fmt(r.depth, 2)}</td><td class="num">${fmt(r.wd, 1)}</td><td class="num">${fmt(r.q, 0)}</td><td class="num">${fmt(r.v, 1)}</td></tr>`).join("")}
    </tbody></table>
    ${res.warnings.map((w) => `<div class="small">⚠ ${escapeHtml(w)}</div>`).join("")}
    <div id="rc-chart" class="chart tall"></div>
    <h3>Other curves at ${fmt(da, 2)} mi²</h3>
    <table class="data"><thead><tr><th>Curve</th><th>Type</th><th class="num">Area</th><th class="num">Width</th><th class="num">Depth</th><th class="num">Q</th></tr></thead><tbody>
      ${others.flatMap((o) => o.rows.map((r) => `<tr><td>${escapeHtml(o.curve.name.replace(" Regional Curve", ""))}</td><td>${r.type === "all" ? "All" : r.type}</td><td class="num">${fmt(r.area, 1)}</td><td class="num">${fmt(r.width, 1)}</td><td class="num">${fmt(r.depth, 2)}</td><td class="num">${fmt(r.q, 0)}</td></tr>`)).join("")}
    </tbody></table>
    <div class="small">Source: ${escapeHtml(c.source_file)} (modified ${c.source_modified}); equations reproduced from its Prediction Equations sheet. ${c.id === "north_shore" ? "Refitting the power laws to the current survey rows moves coefficients by under 3%; the spreadsheet values are used here." : ""} Bankfull dimensions are planning-level estimates; verify with a field bankfull survey.</div>`;
  container.querySelector("#rc-curve").addEventListener("change", (e) => onChangeCurve?.(e.target.value));
  drawChart(container.querySelector("#rc-chart"), c, da, res);
}

function drawChart(el, c, da, res) {
  const traces = [];
  const colors = { B: "#f59e0b", C: "#38bdf8", E: "#22c55e", all: "#a78bfa" };
  const xs = logspace(0.05, 300, 60);
  if (c.id === "north_shore") {
    for (const [t, spec] of Object.entries(c.types)) {
      traces.push({ x: spec.sites.map((s) => s.da), y: spec.sites.map((s) => s.area), mode: "markers", name: `${t} sites (n=${spec.sites.length})`, marker: { color: colors[t], size: 7, opacity: 0.85 }, text: spec.sites.map((s) => `${s.stream} · ${s.type}`), hovertemplate: "%{text}<br>DA %{x} mi² · A %{y} ft²<extra></extra>" });
      traces.push({ x: xs, y: xs.map((x) => spec.equations.area.a * Math.pow(x, spec.equations.area.b)), mode: "lines", name: `${t} fit`, line: { color: colors[t], width: 1.5 }, hoverinfo: "skip" });
    }
  } else if (c.id === "cloquet_st_louis") {
    traces.push({ x: c.all_sites.map((s) => s.da), y: c.all_sites.map((s) => s.area), mode: "markers", name: `Sites (n=${c.all_sites.length})`, marker: { color: colors.C, size: 7 }, text: c.all_sites.map((s) => `${s.stream} · ${s.type}`), hovertemplate: "%{text}<br>DA %{x} mi² · A %{y} ft²<extra></extra>" });
    const eq = c.types.C.equations.area;
    traces.push({ x: xs, y: xs.map((x) => eq.a * Math.pow(x, eq.b)), mode: "lines", name: "All-types fit", line: { color: colors.C, width: 1.5 }, hoverinfo: "skip" });
  } else {
    traces.push({ x: c.tables.area.map((r) => r.da), y: c.tables.area.map((r) => r.v), mode: "markers", name: "Curve-read values", marker: { color: colors.all, size: 6 } });
    traces.push({ x: xs, y: xs.map((x) => (x < 5 ? c.equations.area_lt5.coefs.reduce((a, k) => a * x + k, 0) : c.equations.area_ge5.a * Math.pow(x, c.equations.area_ge5.b))), mode: "lines", name: "Equation", line: { color: colors.all, width: 1.5 }, hoverinfo: "skip" });
  }
  for (const r of res.rows) traces.push({ x: [da], y: [r.area], mode: "markers", name: `This basin (${r.type === "all" ? "all" : r.type})`, marker: { color: colors[r.type] || "#fff", size: 13, symbol: "diamond", line: { color: "#fff", width: 1.5 } }, hovertemplate: `DA ${fmt(da, 2)} mi² → ${fmt(r.area, 1)} ft²<extra></extra>` });
  Plotly.newPlot(el, traces, plotlyLayout({ title: "Bankfull area vs drainage area (log-log)", xaxis: { type: "log", title: "Drainage area, mi²" }, yaxis: { type: "log", title: "Bankfull area, ft²" }, legend: { orientation: "h", y: -0.25, x: 0, font: { size: 10 } }, margin: { l: 48, r: 10, t: 28, b: 40 } }), { displayModeBar: false, responsive: true });
}
function logspace(a, b, n) { const la = Math.log10(a), lb = Math.log10(b); return Array.from({ length: n }, (_, i) => Math.pow(10, la + (i * (lb - la)) / (n - 1))); }
