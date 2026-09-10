// Wiring: state, controls, data loads, URL sync.
import { APP, BASEMAPS, COUNTIES, HOME, WINDOWS } from "./config.js";
import { $, isoDate, addDays, on, debounce } from "./util.js";
import { initMap, map, setBasemap, setLayerVisible, setQpeWindow, flyToCounty, setTerrainVisible, setTerrainOpacity } from "./map.js";
import { TERRAIN, terrainLegendHtml } from "./terrain.js";
import { loadPrecip, renderPrecipLegend } from "./precip.js";
import { loadGauges, renderGaugeLegend } from "./gauges.js";
import { loadAlerts } from "./alerts.js";
import { loadLake } from "./lake.js";
import { loadAtlas14 } from "./api/atlas14.js";
import { readUrl, writeUrl } from "./url.js";
import { renderRegion, renderStation, renderGauge, renderPoint, showTab } from "./panels.js";
import { initProjects, openProject } from "./projects.js";
import { track } from "./loader.js";
import { initExport } from "./export.js";
import { initSearch } from "./search.js";
import { setHideUnclassified } from "./gauges.js";
import { setGaugeFilter } from "./map.js";

const state = {
  endDate: isoDate(), days: 1, zoom: HOME.zoom, center: HOME.center, basemap: "light",
  layers: { stations: true, gauges: true, qpe: false, streams: false }, qpeWindow: "24h", selection: null, terrain: {}, terrainOpacity: 0.6,
  ...readUrl(),
};
// Never allow a future end date; default to yesterday before ~9 AM (today's CoCoRaHS reports are still arriving)
if (state.endDate > isoDate()) state.endDate = isoDate();
if (!readUrl().endDate && new Date().getHours() < 9) state.endDate = addDays(isoDate(), -1);

let firstLoadDone = false;
function setStatus(msg, isError = false) { $("status-text").textContent = msg; $("status").classList.toggle("error", isError); }
function syncUrl() { writeUrl(state); }

function buildControls() {
  const win = $("ctl-window");
  WINDOWS.forEach((w) => win.append(new Option(w.label, w.days)));
  win.value = String(state.days);
  $("ctl-date").value = state.endDate; $("ctl-date").max = isoDate();
  const cty = $("ctl-county");
  COUNTIES.filter((c) => c.tsa3).forEach((c) => cty.append(new Option(c.name + " County", c.fips)));
  const bm = $("ctl-basemap");
  Object.entries(BASEMAPS).forEach(([id, b]) => bm.append(new Option(b.label, id)));
  bm.value = state.basemap;
  $("ctl-qpe").value = state.qpeWindow;
  $("tg-precip").classList.toggle("on", state.layers.stations);
  $("tg-gauges").classList.toggle("on", state.layers.gauges);
  $("tg-qpe").classList.toggle("on", state.layers.qpe);
  $("tg-streams").classList.toggle("on", !!state.layers.streams);
  $("tg-streams").addEventListener("click", () => toggleLayer("streams"));

  const stepDate = (n) => { const d = n === 0 ? isoDate() : addDays(state.endDate, n); if (d <= isoDate()) { state.endDate = d; $("ctl-date").value = d; refreshPrecip(); } };
  $("date-prev").addEventListener("click", () => stepDate(-1));
  $("date-next").addEventListener("click", () => stepDate(1));
  $("date-today").addEventListener("click", () => stepDate(0));
  $("btn-share").addEventListener("click", async () => { syncUrl(); try { await navigator.clipboard.writeText(location.href); $("btn-share").textContent = "🔗 Copied"; } catch { prompt("Copy this link:", location.href); } setTimeout(() => ($("btn-share").textContent = "🔗 Link"), 1500); });
  $("btn-help").addEventListener("click", () => ($("help").hidden = false));
  $("help-close").addEventListener("click", () => ($("help").hidden = true));
  $("help").addEventListener("click", (e) => { if (e.target.id === "help") $("help").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("help").hidden = true; if (e.key === "?" && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) $("help").hidden = !$("help").hidden; });
  $("legend").addEventListener("change", (e) => { if (e.target.id === "lg-hide-unclassified") { setHideUnclassified(e.target.checked); setGaugeFilter(e.target.checked); try { localStorage.setItem("nh-hide-unclassified", e.target.checked ? "1" : "0"); } catch {} } });
  try { if (localStorage.getItem("nh-hide-unclassified") === "1") { setHideUnclassified(true); on("map:ready", () => setGaugeFilter(true)); } } catch {}
  $("ctl-date").addEventListener("change", (e) => { if (e.target.value && e.target.value <= isoDate()) { state.endDate = e.target.value; refreshPrecip(); } });
  win.addEventListener("change", (e) => { state.days = Number(e.target.value); refreshPrecip(); });
  cty.addEventListener("change", (e) => { flyToCounty(e.target.value); e.target.value = ""; });
  bm.addEventListener("change", (e) => { state.basemap = e.target.value; setBasemap(state.basemap); syncUrl(); });
  $("ctl-qpe").addEventListener("change", (e) => { state.qpeWindow = e.target.value; setQpeWindow(state.qpeWindow); if (!state.layers.qpe) toggleLayer("qpe", true); syncUrl(); });
  $("tg-precip").addEventListener("click", () => toggleLayer("stations"));
  $("tg-gauges").addEventListener("click", () => toggleLayer("gauges"));
  $("tg-qpe").addEventListener("click", () => toggleLayer("qpe"));
  // Terrain menu
  const tl = $("terrain-list");
  for (const [id, t] of Object.entries(TERRAIN)) {
    const row = document.createElement("label"); row.className = "menu-row";
    row.innerHTML = `<input type="checkbox" data-terrain="${id}" ${state.terrain[id] ? "checked" : ""}/> <span>${t.label}</span>`;
    row.title = t.note; tl.append(row);
  }
  tl.addEventListener("change", (e) => { const id = e.target.dataset.terrain; if (!id) return; state.terrain[id] = e.target.checked; setTerrainVisible(id, e.target.checked); updateTerrainButton(); renderLegend(); syncUrl(); });
  $("terrain-opacity").value = String(Math.round(state.terrainOpacity * 100));
  $("terrain-opacity").addEventListener("input", (e) => { state.terrainOpacity = Number(e.target.value) / 100; setTerrainOpacity(state.terrainOpacity); syncUrl(); });
  $("tg-terrain").addEventListener("click", (e) => { e.stopPropagation(); $("terrain-menu").hidden = !$("terrain-menu").hidden; });
  document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) $("terrain-menu").hidden = true; });
  updateTerrainButton();
  $("panel-toggle").addEventListener("click", () => $("panel").classList.toggle("open"));
  $("legend-toggle").addEventListener("click", () => $("legend").classList.toggle("collapsed"));
  if (window.matchMedia("(max-width: 900px)").matches) $("legend").classList.add("collapsed");
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
  $("btn-alerts").addEventListener("click", () => { showTab("region"); $("region-alerts")?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  $("btn-lake").addEventListener("click", () => { showTab("region"); $("region-lake")?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const d = addDays(state.endDate, e.key === "ArrowLeft" ? -1 : 1);
      if (d <= isoDate()) { state.endDate = d; $("ctl-date").value = d; refreshPrecip(); }
    }
  });
}
function updateTerrainButton() {
  const n = Object.values(state.terrain).filter(Boolean).length;
  $("tg-terrain").classList.toggle("on", n > 0);
  $("tg-terrain").textContent = n ? `Terrain (${n}) ▾` : "Terrain ▾";
}
function toggleLayer(name, force) {
  const on = force ?? !state.layers[name];
  state.layers[name] = on;
  setLayerVisible(name, on);
  const btn = { stations: "tg-precip", gauges: "tg-gauges", qpe: "tg-qpe", streams: "tg-streams" }[name];
  $(btn).classList.toggle("on", on);
  renderLegend(); syncUrl();
}
function renderLegend() {
  const lg = $("legend-body");
  lg.innerHTML = "";
  if (state.layers.stations) renderPrecipLegend(lg, { days: state.days });
  if (state.layers.gauges) renderGaugeLegend(lg);
  if (state.layers.streams) lg.insertAdjacentHTML("beforeend", `<h4>Streams (StreamStats grid)</h4><div class="legend-row"><span class="swatch sq" style="background:#0070ff"></span>Mapped stream cells (zoom 13+)</div><div class="small">The 10 m cells StreamStats delineates on; snap targets these.</div>`);
  lg.insertAdjacentHTML("beforeend", terrainLegendHtml(state.terrain));
  if (state.layers.qpe) lg.insertAdjacentHTML("beforeend", `<h4>Radar QPE (${$("ctl-qpe").selectedOptions[0].text})</h4><div class="small">NWS RFC multi-sensor estimate, inches; colors per NWS scale (light green &lt;0.1 → purple/white &gt;5). <a href="https://water.noaa.gov/precip" target="_blank" rel="noopener">Legend</a></div>`);
}

const refreshPrecip = debounce(async () => {
  setStatus(`Loading precipitation (${state.days === 1 ? state.endDate : state.days + " days to " + state.endDate})…`);
  syncUrl();
  try {
    const list = await track("stations", loadPrecip({ endDate: state.endDate, days: state.days }));
    setStatus(`${list.filter((s) => !s.missingAll).length} stations reporting · ${state.days === 1 ? state.endDate : state.days + "-day window ending " + state.endDate}`);
    if (!firstLoadDone) { firstLoadDone = true; try { if (localStorage.getItem("nh-visited") !== "1") { localStorage.setItem("nh-visited", "1"); $("help").hidden = false; } } catch {} }
    renderLegend();
    if (!state.selection || state.selection.type === "region") renderRegion();
    else if (state.selection.type === "station") renderStation(state.selection.id);
    else if (state.selection.type === "point") { const [lon, lat] = state.selection.id.split(",").map(Number); renderPoint(lon, lat); }
    else renderRegion();
  } catch (e) { setStatus("Precipitation load failed: " + e.message, true); console.error(e); }
}, 150);

async function boot() {
  buildControls();
  initMap({ center: state.center, zoom: state.zoom, basemap: state.basemap });
  setLayerVisible("stations", state.layers.stations); setLayerVisible("gauges", state.layers.gauges); setLayerVisible("qpe", state.layers.qpe); setLayerVisible("streams", !!state.layers.streams);
  setQpeWindow(state.qpeWindow);
  for (const [id, on] of Object.entries(state.terrain)) setTerrainVisible(id, on);
  setTerrainOpacity(state.terrainOpacity);
  renderLegend();
  track("map", new Promise((res) => on("map:ready", res)));
  track("design storms", loadAtlas14());
  track("alerts", loadAlerts()).catch((e) => { $("alerts-count").textContent = "n/a"; console.warn(e); });
  track("lake level", loadLake());
  const gaugesP = track("gauges", loadGauges()).catch((e) => { console.warn(e); return []; });
  await refreshPrecip();
  await gaugesP;
  if (!state.selection || state.selection.type === "region") renderRegion();
  else if (state.selection.type === "gauge") renderGauge(state.selection.id);
  else if (state.selection.type === "station") renderStation(state.selection.id);
  else if (state.selection.type === "point") { const [lon, lat] = state.selection.id.split(",").map(Number); renderPoint(lon, lat); }

  track("projects", initProjects());
  initExport();
  initSearch();
  on("map:moveend", ({ center, zoom }) => { state.center = [center.lng, center.lat]; state.zoom = zoom; syncUrl(); });
  on("select:station", (p) => { state.selection = { type: "station", id: p.sid }; syncUrl(); renderStation(p.sid); });
  on("select:gauge", (p) => { state.selection = { type: "gauge", id: p.id }; syncUrl(); renderGauge(p.id); });
  on("select:project", (p) => { state.selection = { type: "project", id: p.id }; syncUrl(); });
  on("select:point", ({ lon, lat }) => { state.selection = { type: "point", id: `${lon.toFixed(4)},${lat.toFixed(4)}` }; syncUrl(); renderPoint(lon, lat); });
  // refresh live layers every 10 min
  setInterval(() => { track("gauges", loadGauges()).catch(() => {}); track("alerts", loadAlerts()).catch(() => {}); track("lake level", loadLake()); }, 10 * 60_000);
  window.__nh = { state, map };
  console.info(`${APP.name} ${APP.version} ready`);
}

boot().catch((e) => { setStatus("Startup failed: " + e.message, true); console.error(e); });
