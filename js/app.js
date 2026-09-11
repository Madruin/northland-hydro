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
import { initSoils, setSoilsEnabled, soilsLegendHtml } from "./soils.js";
import { initParcels, setParcelsEnabled, parcelsLegendHtml } from "./parcels.js";
import { initNav, watchTooltips } from "./nav.js";
import { initDnrLayers, setDnrLayerEnabled, dnrLegendHtml } from "./dnrlayers.js";
import { initFema, setFemaEnabled, femaLegendHtml } from "./fema.js";
import { initCrossings, setCrossingsEnabled, crossingsLegendHtml } from "./crossings.js";
import { initWells, setWellsEnabled, wellsLegendHtml } from "./wells.js";
import { setHideUnclassified } from "./gauges.js";
import { setGaugeFilter } from "./map.js";

const state = {
  endDate: isoDate(), days: 1, zoom: HOME.zoom, center: HOME.center, basemap: "light",
  layers: { stations: true, gauges: true, qpe: false, streams: false, soils: false, parcels: false, trout: false, karst: false, wetlands: false, fema: false, crossings: false, wells: false }, qpeWindow: "24h", selection: null, terrain: {}, terrainOpacity: 0.6,
  ...readUrl(),
};
// Never allow a future end date; default to yesterday before ~9 AM (today's CoCoRaHS reports are still arriving)
if (state.endDate > isoDate()) state.endDate = isoDate();
if (!readUrl().endDate && new Date().getHours() < 9) state.endDate = addDays(isoDate(), -1);

let firstLoadDone = false;
let normalStatus = "", zoomHint = null;
function setStatus(msg, isError = false, hint = false) { if (!hint) { normalStatus = msg; zoomHint = null; } $("status-text").textContent = msg; $("status").classList.toggle("error", isError); }
const whenMap = (fn) => (map ? fn() : on("map:ready", fn));
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
  $("tg-soils").classList.toggle("on", !!state.layers.soils);
  $("tg-soils").addEventListener("click", () => toggleLayer("soils"));
  $("tg-parcels").classList.toggle("on", !!state.layers.parcels);
  $("tg-parcels").addEventListener("click", () => toggleLayer("parcels"));
  for (const k of ["wetlands", "trout", "karst", "fema", "crossings", "wells"]) { $("tg-" + k).classList.toggle("on", !!state.layers[k]); $("tg-" + k).addEventListener("click", () => toggleLayer(k)); }

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
  $("tg-terrain").addEventListener("click", (e) => { e.stopPropagation(); const open = $("terrain-menu").hidden; closeMenus(); $("terrain-menu").hidden = !open; });
  $("btn-layers").addEventListener("click", (e) => { e.stopPropagation(); const open = $("layers-menu").hidden; closeMenus(); $("layers-menu").hidden = !open; updateLayerRows(); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) closeMenus(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); });
  whenMap(() => {
    map.on("moveend", () => { if (!$("layers-menu").hidden) updateLayerRows(); if (zoomHint && map.getZoom() >= zoomHint.mz - 0.01) setStatus(normalStatus); });
    map.on("click", () => dismissHint());
  });
  updateTerrainButton(); updateLayersButton();
  // first-visit hint: click the map
  $("map-hint-x").addEventListener("click", () => dismissHint());
  ["select:point", "select:station", "select:gauge"].forEach((ev) => on(ev, () => dismissHint()));
  const mobile = () => window.matchMedia("(max-width: 900px)").matches;
  const sheet = (st) => { $("panel").dataset.sheet = st; $("panel").style.height = ""; $("panel").classList.toggle("open", st !== "peek"); };
  // desktop: drag the panel's left edge to resize; remembered
  try { const w = localStorage.getItem("nh-panel-w"); if (w) document.documentElement.style.setProperty("--panel-w", w.trim()); } catch {}
  const rs = $("panel-resize"); let drag = null;
  rs.addEventListener("pointerdown", (e) => { if (mobile()) return; drag = { x: e.clientX, w: $("panel").getBoundingClientRect().width }; $("panel").classList.add("resizing"); rs.setPointerCapture(e.pointerId); e.preventDefault(); });
  rs.addEventListener("pointermove", (e) => { if (!drag) return; const w = Math.round(Math.max(300, Math.min(window.innerWidth * 0.7, drag.w + (drag.x - e.clientX)))); document.documentElement.style.setProperty("--panel-w", w + "px"); });
  const endDrag = () => { if (!drag) return; drag = null; $("panel").classList.remove("resizing"); try { localStorage.setItem("nh-panel-w", document.documentElement.style.getPropertyValue("--panel-w")); } catch {} map?.resize(); };
  rs.addEventListener("pointerup", endDrag); rs.addEventListener("pointercancel", endDrag);
  // phones: drag the sheet's top edge (its header) up or down to any height
  const head = document.querySelector(".panel-head"); let sd = null, suppressUntil = 0;
  head.addEventListener("pointerdown", (e) => { if (!mobile() || e.target.closest("#panel-toggle, .fs")) return; sd = { y: e.clientY, h: $("panel").getBoundingClientRect().height, moved: false }; });
  head.addEventListener("pointermove", (e) => {
    if (!sd) return; const dy = sd.y - e.clientY;
    if (!sd.moved) { if (Math.abs(dy) < 8) return; sd.moved = true; try { head.setPointerCapture(e.pointerId); } catch {} $("panel").classList.add("resizing"); }
    const h = Math.round(Math.max(44, Math.min(window.innerHeight - 60, sd.h + dy)));
    $("panel").dataset.sheet = "custom"; $("panel").style.height = h + "px"; $("panel").classList.toggle("open", h > 60);
  });
  const endSheet = () => { if (!sd) return; if (sd.moved) { suppressUntil = Date.now() + 400; map?.resize(); } sd = null; $("panel").classList.remove("resizing"); };
  head.addEventListener("pointerup", endSheet); head.addEventListener("pointercancel", endSheet);
  head.addEventListener("click", (e) => { if (suppressUntil > Date.now()) { e.stopPropagation(); e.preventDefault(); } }, true);
  // panel text size, remembered
  let pz = 1; try { pz = Number(localStorage.getItem("nh-panel-zoom")) || 1; } catch {}
  const applyPz = () => { document.querySelector(".panel-body").style.zoom = String(pz); try { localStorage.setItem("nh-panel-zoom", String(pz)); } catch {} };
  $("fs-dec").addEventListener("click", () => { pz = Math.max(0.8, +(pz - 0.1).toFixed(2)); applyPz(); });
  $("fs-inc").addEventListener("click", () => { pz = Math.min(1.5, +(pz + 0.1).toFixed(2)); applyPz(); });
  applyPz();
  $("panel-toggle").addEventListener("click", () => {
    if (!mobile()) { $("panel").classList.toggle("open"); return; }
    const cur = $("panel").dataset.sheet || "peek";
    sheet(cur === "peek" ? "half" : cur === "half" ? "full" : "peek");
  });
  if (mobile()) sheet("peek");
  window.addEventListener("resize", () => { if (mobile()) { if (!$("panel").dataset.sheet) sheet("peek"); } else { delete $("panel").dataset.sheet; $("panel").classList.add("open"); } });
  // any selection or tab tap opens the sheet to half height on phones
  const openSheet = () => { if (mobile() && ($("panel").dataset.sheet || "peek") === "peek") sheet("half"); };
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", openSheet));
  ["select:station", "select:gauge", "select:point", "select:project"].forEach((e) => on(e, openSheet));
  // menus are position:fixed on phones; place them under their button
  const placeMenu = (btn, menu) => { if (!mobile()) return; const r = btn.getBoundingClientRect(); menu.style.top = `${Math.round(r.bottom + 6)}px`; };
  $("tg-terrain").addEventListener("click", () => placeMenu($("tg-terrain"), $("terrain-menu")));
  $("btn-layers").addEventListener("click", () => placeMenu($("btn-layers"), $("layers-menu")));
  $("ctl-search").addEventListener("focus", () => { $("ctl-search").classList.add("open"); placeMenu($("ctl-search"), $("search-results")); });
  $("ctl-search").addEventListener("pointerdown", () => { $("ctl-search").classList.add("open"); placeMenu($("ctl-search"), $("search-results")); });
  $("ctl-search").addEventListener("blur", () => { if (!$("ctl-search").value) $("ctl-search").classList.remove("open"); });
  $("legend-toggle").addEventListener("click", () => $("legend").classList.toggle("collapsed"));
  if (window.matchMedia("(max-width: 900px)").matches) $("legend").classList.add("collapsed");
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
  $("btn-alerts").addEventListener("click", () => { showTab("region"); $("region-alerts")?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const d = addDays(state.endDate, e.key === "ArrowLeft" ? -1 : 1);
      if (d <= isoDate()) { state.endDate = d; $("ctl-date").value = d; refreshPrecip(); }
    }
  });
}
const MENU_LAYERS = ["streams", "crossings", "trout", "soils", "parcels", "wetlands", "fema", "karst", "wells"];
function closeMenus() { document.querySelectorAll(".menu-wrap .menu").forEach((m) => { m.hidden = true; }); }
function updateLayersButton() {
  const n = MENU_LAYERS.filter((k) => state.layers[k]).length;
  $("btn-layers").classList.toggle("on", n > 0);
  $("btn-layers").textContent = n ? `Layers (${n}) ▾` : "Layers ▾";
}
function updateLayerRows() {
  const z = map?.getZoom?.() ?? 99;
  document.querySelectorAll(".layer-row[data-minzoom]").forEach((r) => r.classList.toggle("far", z < Number(r.dataset.minzoom) - 0.01));
}
let hintShown = false;
function showHintOnce() {
  try { if (localStorage.getItem("nh-hint") === "1") return; } catch {}
  if (hintShown) return; hintShown = true;
  setTimeout(() => { if ($("help").hidden) $("map-hint").hidden = false; else $("help-close").addEventListener("click", () => ($("map-hint").hidden = false), { once: true }); }, 400);
}
function dismissHint() { $("map-hint").hidden = true; try { localStorage.setItem("nh-hint", "1"); } catch {} }
function updateTerrainButton() {
  const n = Object.values(state.terrain).filter(Boolean).length;
  $("tg-terrain").classList.toggle("on", n > 0);
  $("tg-terrain").textContent = n ? `Terrain (${n}) ▾` : "Terrain ▾";
}
function toggleLayer(name, force) {
  const on = force ?? !state.layers[name];
  state.layers[name] = on;
  setLayerVisible(name, on);
  const btn = { stations: "tg-precip", gauges: "tg-gauges", qpe: "tg-qpe", streams: "tg-streams", soils: "tg-soils", parcels: "tg-parcels", trout: "tg-trout", karst: "tg-karst", wetlands: "tg-wetlands", fema: "tg-fema", crossings: "tg-crossings", wells: "tg-wells" }[name];
  if (name === "crossings") setCrossingsEnabled(on);
  if (name === "wells") setWellsEnabled(on);
  if (name === "trout" || name === "karst" || name === "wetlands") setDnrLayerEnabled(name, on);
  if (name === "fema") setFemaEnabled(on);
  if (name === "soils") setSoilsEnabled(on);
  if (name === "parcels") setParcelsEnabled(on);
  $(btn).classList.toggle("on", on);
  updateLayersButton();
  const row = $(btn); const mz = Number(row?.dataset?.minzoom);
  if (on && mz && map?.getZoom?.() < mz - 0.01) { zoomHint = { name, mz }; setStatus(`${row.dataset.label} loads at zoom ${mz}+ (now ${map.getZoom().toFixed(0)}). Zoom in to see it.`, false, true); }
  else if (!on && zoomHint?.name === name) setStatus(normalStatus);
  renderLegend(); syncUrl();
}
function renderLegend() {
  const lg = $("legend-body");
  lg.innerHTML = "";
  if (state.layers.stations) renderPrecipLegend(lg, { days: state.days });
  if (state.layers.gauges) renderGaugeLegend(lg);
  if (state.layers.parcels) lg.insertAdjacentHTML("beforeend", parcelsLegendHtml());
  if (state.layers.fema) lg.insertAdjacentHTML("beforeend", femaLegendHtml());
  if (state.layers.crossings) lg.insertAdjacentHTML("beforeend", crossingsLegendHtml());
  if (state.layers.wells) lg.insertAdjacentHTML("beforeend", wellsLegendHtml());
  for (const k of ["wetlands", "trout", "karst"]) if (state.layers[k]) lg.insertAdjacentHTML("beforeend", dnrLegendHtml(k));
  if (state.layers.soils) lg.insertAdjacentHTML("beforeend", soilsLegendHtml());
  if (state.layers.streams) lg.insertAdjacentHTML("beforeend", `<h4>Streams (StreamStats grid)</h4><div class="legend-row"><span class="swatch sq" style="background:#0070ff"></span>Mapped stream cells (zoom 13+)</div><div class="small">The 10 m cells StreamStats delineates on; snap targets these.</div>`);
  lg.insertAdjacentHTML("beforeend", terrainLegendHtml(state.terrain));
  if (state.layers.qpe) lg.insertAdjacentHTML("beforeend", `<h4>Radar QPE (${$("ctl-qpe").selectedOptions[0].text})</h4><div class="small">NWS RFC multi-sensor estimate, inches; colors per NWS scale (light green &lt;0.1 → purple/white &gt;5). <a href="https://water.noaa.gov/precip" target="_blank" rel="noopener">Legend</a></div>`);
}

async function refreshPrecipNow() {
  setStatus(`Loading precipitation (${state.days === 1 ? state.endDate : state.days + " days to " + state.endDate})…`);
  syncUrl();
  try {
    const list = await track("stations", loadPrecip({ endDate: state.endDate, days: state.days }));
    setStatus(`${list.filter((s) => !s.missingAll).length} stations reporting · ${state.days === 1 ? state.endDate : state.days + "-day window ending " + state.endDate}`);
    if (!firstLoadDone) { firstLoadDone = true; try { if (localStorage.getItem("nh-visited") !== "1") { localStorage.setItem("nh-visited", "1"); $("help").hidden = false; } } catch {} showHintOnce(); }
    renderLegend();
    if (!state.selection || state.selection.type === "region") renderRegion();
    else if (state.selection.type === "station") renderStation(state.selection.id);
    else if (state.selection.type === "point") { const [lon, lat] = state.selection.id.split(",").map(Number); renderPoint(lon, lat); }
    else renderRegion();
  } catch (e) { setStatus("Precipitation load failed: " + e.message, true); console.error(e); }
}
const refreshPrecip = debounce(refreshPrecipNow, 150);

// If a newer build was deployed, refetch every asset past the CDN cache and reload once (see tools/stamp_version.py).
async function checkBuild() {
  try {
    const v = await (await fetch("version.json", { cache: "no-store" })).json();
    if (!v.build || v.build === APP.build) return false;
    if (sessionStorage.getItem("nh-reloaded-for") === v.build) return false; // already tried once this session
    sessionStorage.setItem("nh-reloaded-for", v.build);
    setStatus(`Updating to build ${v.build}…`);
    await Promise.all((v.files || []).map((f) => fetch(f, { cache: "reload" }).catch(() => null)));
    location.reload();
    return true;
  } catch { return false; }
}

async function boot() {
  if (await checkBuild()) return;
  buildControls();
  initMap({ center: state.center, zoom: state.zoom, basemap: state.basemap });
  setLayerVisible("stations", state.layers.stations); setLayerVisible("gauges", state.layers.gauges); setLayerVisible("qpe", state.layers.qpe); setLayerVisible("streams", !!state.layers.streams); setLayerVisible("soils", !!state.layers.soils); setLayerVisible("parcels", !!state.layers.parcels); setLayerVisible("trout", !!state.layers.trout); setLayerVisible("karst", !!state.layers.karst); setLayerVisible("wetlands", !!state.layers.wetlands); setLayerVisible("fema", !!state.layers.fema); setLayerVisible("crossings", !!state.layers.crossings); setLayerVisible("wells", !!state.layers.wells);
  setQpeWindow(state.qpeWindow);
  for (const [id, on] of Object.entries(state.terrain)) setTerrainVisible(id, on);
  setTerrainOpacity(state.terrainOpacity);
  renderLegend();
  track("map", new Promise((res) => on("map:ready", res)));
  track("design storms", loadAtlas14());
  track("alerts", loadAlerts()).catch((e) => { $("alerts-count").textContent = "n/a"; console.warn(e); });
  track("lake level", loadLake());
  const gaugesP = track("gauges", loadGauges()).catch((e) => { console.warn(e); return []; });
  await refreshPrecipNow();
  // Don't block the UI on gauges: USGS can take 30+ s on a bad day. Cached gauges already show; re-render when live ones land.
  gaugesP.then(() => { if (!state.selection || state.selection.type === "region") renderRegion(); });
  if (!state.selection || state.selection.type === "region") renderRegion();
  else if (state.selection.type === "gauge") renderGauge(state.selection.id);
  else if (state.selection.type === "station") renderStation(state.selection.id);
  else if (state.selection.type === "point") { const [lon, lat] = state.selection.id.split(",").map(Number); renderPoint(lon, lat); }

  track("projects", initProjects());
  initExport();
  initSearch();
  initSoils();
  initParcels();
  initDnrLayers();
  initFema();
  initCrossings();
  initWells();
  if (state.layers.wells) { if (map.getSource("ov-wells")) setWellsEnabled(true); else on("map:ready", () => setWellsEnabled(true)); }
  if (state.layers.crossings) { if (map.getSource("ov-xing-dnr")) setCrossingsEnabled(true); else on("map:ready", () => setCrossingsEnabled(true)); }
  if (state.layers.fema) { if (map.getSource("ov-fema-zones")) setFemaEnabled(true); else on("map:ready", () => setFemaEnabled(true)); }
  for (const k of ["wetlands", "trout", "karst"]) if (state.layers[k]) { if (map.getSource("ov-trout")) setDnrLayerEnabled(k, true); else on("map:ready", () => setDnrLayerEnabled(k, true)); }
  initNav(); watchTooltips();
  if (state.layers.parcels) { if (map.getSource("parcels")) setParcelsEnabled(true); else on("map:ready", () => setParcelsEnabled(true)); }
  if (state.layers.soils) { if (map.getSource("soils")) setSoilsEnabled(true); else on("map:ready", () => setSoilsEnabled(true)); }
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
