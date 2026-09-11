// Lake Superior at Duluth: latest level, 30-day hourly trace, monthly means vs long-term average.
import { LAKE_STATION } from "./config.js";
import { latestLevel, hourlyLevels, monthlyMeans } from "./api/coops.js";
import { $, fmt, plotlyLayout } from "./util.js";

export let latest = null;

export async function loadLake() {
  try {
    latest = await latestLevel();
    if ($("lake-level")) $("lake-level").textContent = latest ? `${fmt(latest.ft)} ft` : "n/a";
    if ($("btn-lake")) $("btn-lake").title = latest ? `Lake Superior at Duluth: ${fmt(latest.ft)} ft IGLD85 at ${latest.time} (long-term avg ${LAKE_STATION.lta} ft)` : "Lake level unavailable";
  } catch (e) { if ($("lake-level")) $("lake-level").textContent = "n/a"; console.warn("lake failed", e); }
  return latest;
}

export async function renderLakeSection(container) {
  container.innerHTML = `<h3>Lake Superior at Duluth</h3><div class="spinner">Loading NOAA CO-OPS…</div>`;
  try {
    const [hourly, monthly] = await Promise.all([hourlyLevels(30), monthlyMeans(4)]);
    const last = hourly[hourly.length - 1];
    const dev = last ? last.ft - LAKE_STATION.lta : null;
    const min30 = Math.min(...hourly.map((h) => h.ft)), max30 = Math.max(...hourly.map((h) => h.ft));
    container.innerHTML = `<h3>Lake Superior at Duluth <span class="small">NOAA station ${LAKE_STATION.id}, IGLD85</span></h3>
      <div class="stat-row">
        <div class="stat"><div class="v">${fmt(last?.ft)}</div><div class="l">ft now</div><div class="s">${last?.t ?? ""}</div></div>
        <div class="stat ${dev > 1 ? "warn" : ""}"><div class="v">${dev != null ? (dev >= 0 ? "+" : "") + fmt(dev) : "–"}</div><div class="l">vs long-term avg</div><div class="s">${LAKE_STATION.lta} ft (1918–2023)</div></div>
        <div class="stat"><div class="v">${fmt(max30 - min30)}</div><div class="l">30-day range, ft</div><div class="s">${fmt(min30)}–${fmt(max30)}</div></div>
      </div>
      <div id="lake-hourly" class="chart"></div>
      <div id="lake-monthly" class="chart"></div>
      <div class="small">Short-term swings at Duluth are mostly seiche and wind set-up; use the monthly means for the lake's actual regime. Record high ${LAKE_STATION.recordHigh} ft (1985), record low ${LAKE_STATION.recordLow} ft (1926).</div>`;
    Plotly.newPlot("lake-hourly", [{ x: hourly.map((h) => h.t), y: hourly.map((h) => h.ft), mode: "lines", line: { color: "#38bdf8", width: 1.5 }, name: "Hourly level" },
      { x: [hourly[0]?.t, last?.t], y: [LAKE_STATION.lta, LAKE_STATION.lta], mode: "lines", line: { color: "#f59e0b", dash: "dot", width: 1 }, name: "Long-term avg" }],
      plotlyLayout({ title: "Last 30 days (hourly, ft IGLD85)", yaxis: { title: "ft" } }), { displayModeBar: false, responsive: true });
    const mx = monthly.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}-15`);
    Plotly.newPlot("lake-monthly", [
      { x: mx, y: monthly.map((m) => m.high), mode: "lines", line: { width: 0 }, showlegend: false, hoverinfo: "skip" },
      { x: mx, y: monthly.map((m) => m.low), mode: "lines", line: { width: 0 }, fill: "tonexty", fillcolor: "rgba(56,189,248,.15)", name: "Monthly range" },
      { x: mx, y: monthly.map((m) => m.msl), mode: "lines+markers", line: { color: "#38bdf8" }, marker: { size: 4 }, name: "Monthly mean" },
      { x: [mx[0], mx[mx.length - 1]], y: [LAKE_STATION.lta, LAKE_STATION.lta], mode: "lines", line: { color: "#f59e0b", dash: "dot", width: 1 }, name: "Long-term avg" }],
      plotlyLayout({ title: "Monthly means, last 4 years", yaxis: { title: "ft" } }), { displayModeBar: false, responsive: true });
  } catch (e) {
    container.innerHTML = `<h3>Lake Superior at Duluth</h3><div class="notice">CO-OPS request failed: ${e.message}</div>`;
  }
}
