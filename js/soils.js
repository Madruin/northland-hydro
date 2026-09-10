// SSURGO soils: hydrologic-soil-group map layer (viewport-driven) and a soils section for the Point panel.
import { $, escapeHtml, fmt, fmtNum, debounce, on } from "./util.js";
import * as sda from "./api/sda.js";
import { map, setSoils } from "./map.js";

export const HSG_COLORS = { A: "#2e7d32", B: "#7cb342", C: "#ffb300", D: "#d32f2f", "A/D": "#5e35b1", "B/D": "#8e24aa", "C/D": "#e91e63" };
export const HSG_NOTE = { A: "high infiltration, low runoff", B: "moderate infiltration", C: "slow infiltration", D: "very slow infiltration, high runoff", "A/D": "A if drained, D undrained", "B/D": "B if drained, D undrained", "C/D": "C if drained, D undrained" };
export const MIN_ZOOM = 12, MAX_SPAN_KM = 7;

let enabled = false;
let lastKey = null;
let inflight = null;

export function initSoils() {
  map.on("moveend", debounce(() => { if (enabled) refresh(); }, 400));
}
export function setSoilsEnabled(on) {
  enabled = on;
  if (on) refresh(); else { setSoils({ type: "FeatureCollection", features: [] }); lastKey = null; setStatusNote(""); }
}
function setStatusNote(t) { const el = $("soils-note"); if (el) el.textContent = t; }

async function refresh() {
  const z = map.getZoom();
  const b = map.getBounds();
  const spanKm = 111.32 * Math.cos((b.getCenter().lat * Math.PI) / 180) * (b.getEast() - b.getWest());
  if (z < MIN_ZOOM || spanKm > MAX_SPAN_KM) { setSoils({ type: "FeatureCollection", features: [] }); lastKey = null; setStatusNote(`Soils: zoom in (${MIN_ZOOM}+) to load map units`); return; }
  const pad = 0.15;
  const bbox = [b.getWest() - (b.getEast() - b.getWest()) * pad, b.getSouth() - (b.getNorth() - b.getSouth()) * pad, b.getEast() + (b.getEast() - b.getWest()) * pad, b.getNorth() + (b.getNorth() - b.getSouth()) * pad];
  const key = bbox.map((v) => v.toFixed(3)).join(",");
  if (key === lastKey) return;
  lastKey = key;
  setStatusNote("Soils: loading map units…");
  const mine = (inflight = sda.polygonsInBbox(bbox));
  try {
    const fc = await mine;
    if (inflight !== mine || !enabled) return;
    for (const f of fc.features) {
      const p = f.properties;
      p.color = HSG_COLORS[p.hydgrp] || "#9e9e9e";
      p.label = p.musym || "";
      p.popup = `<div class="popup-title">${escapeHtml(p.muname || p.musym)}</div><div><span class="popup-big" style="color:${p.color}">${escapeHtml(p.hydgrp || "–")}</span> <span class="popup-sub">hydrologic soil group${p.hydgrp ? " · " + (HSG_NOTE[p.hydgrp] || "") : ""}</span></div><div class="popup-sub">${escapeHtml(p.musym)} · ${escapeHtml(p.compname || "")} ${p.comppct ? p.comppct + "%" : ""} · ${escapeHtml(p.drainagecl || "")}${p.hydric === "Yes" ? " · hydric" : ""}${p.slope != null ? " · " + p.slope + "% slope" : ""}</div>`;
    }
    setSoils(fc);
    setStatusNote(`Soils: ${fc.features.length} map-unit polygons (SSURGO)`);
  } catch (e) { console.warn("soils failed", e); setStatusNote("Soils: Soil Data Access request failed"); }
}

export function soilsLegendHtml() {
  return `<h4>Hydrologic soil group (SSURGO)</h4>${Object.entries(HSG_COLORS).map(([k, c]) => `<div class="legend-row"><span class="swatch sq" style="background:${c};opacity:.8"></span>${k} <span class="small">${HSG_NOTE[k]}</span></div>`).join("")}<div class="legend-row"><span class="swatch sq" style="background:#9e9e9e;opacity:.6"></span>Not rated</div><div class="small">Dominant component of each map unit. Loads for the view at zoom ${MIN_ZOOM}+; symbols label the units at 14+. <span id="soils-note"></span></div>`;
}

// ---- Point panel section ----
export async function renderSoilsAt(container, lon, lat) {
  container.innerHTML = `<h3>Soils at this point (NRCS SSURGO)</h3><div class="spinner">Soil Data Access…</div>`;
  try {
    const rows = await sda.pointBasic(lon, lat);
    if (!rows.length) { container.innerHTML = `<h3>Soils at this point (NRCS SSURGO)</h3><div class="notice">No SSURGO map unit here (water, or unmapped).</div>`; return; }
    const mu = rows[0];
    const dom = rows[0];
    const cokeys = rows.filter((r) => r.majcompflag?.trim() === "Yes" || Number(r.comppct_r) >= 15).map((r) => r.cokey).slice(0, 4);
    container.innerHTML = `<h3>Soils at this point (NRCS SSURGO)</h3>
      <div><b>${escapeHtml(mu.muname)}</b> <span class="small">· ${escapeHtml(mu.musym)} · ${escapeHtml(mu.areaname || mu.areasymbol)}</span></div>
      <div class="stat-row">
        <div class="stat"><div class="v" style="color:${HSG_COLORS[dom.hydgrp] || "#9e9e9e"}">${escapeHtml(dom.hydgrp || "–")}</div><div class="l">hydrologic group</div><div class="s">${escapeHtml(HSG_NOTE[dom.hydgrp] || "dominant component")}</div></div>
        <div class="stat"><div class="v" style="font-size:13px">${escapeHtml(dom.drainagecl || "–")}</div><div class="l">drainage class</div><div class="s">${dom.hydricrating === "Yes" ? "hydric" : dom.hydricrating === "No" ? "not hydric" : ""}</div></div>
        <div class="stat"><div class="v">${dom.slope_r != null ? dom.slope_r + "%" : "–"}</div><div class="l">slope (rv)</div><div class="s">${escapeHtml(dom.runoff || "")}</div></div>
      </div>
      <table class="data"><thead><tr><th>Component</th><th class="num">%</th><th>HSG</th><th>Drainage</th><th>Hydric</th><th>Flooding</th><th class="num">Water table</th><th>Surface</th><th class="num">Kw</th><th class="num">Ksat</th><th class="num">Restriction</th></tr></thead>
        <tbody>${rows.map((r) => `<tr data-cokey="${escapeHtml(r.cokey)}"><td title="${escapeHtml(r.taxclname || "")}">${escapeHtml(r.compname)}${r.localphase ? " (" + escapeHtml(r.localphase) + ")" : ""}</td><td class="num">${r.comppct_r}</td><td style="color:${HSG_COLORS[r.hydgrp] || "inherit"}"><b>${escapeHtml(r.hydgrp || "–")}</b></td><td>${escapeHtml(r.drainagecl || "")}</td><td>${escapeHtml(r.hydricrating || "")}</td><td class="d-flod">…</td><td class="num d-wt">…</td><td class="d-tex">…</td><td class="num d-kw">…</td><td class="num d-ksat">…</td><td class="num d-res">…</td></tr>`).join("")}</tbody></table>
      <div class="small">Water table = shallowest wet-state depth in any month (cm). Ksat µm/s and Kw for the surface horizon. Restriction = depth to first restrictive layer (cm). <a href="${sda.wssUrl(lon, lat)}" target="_blank" rel="noopener">Open in Web Soil Survey</a> · <a href="https://casoilresource.lawr.ucdavis.edu/gmap/?loc=${lat.toFixed(5)},${lon.toFixed(5)}" target="_blank" rel="noopener">SoilWeb</a></div>`;
    try {
      const det = await sda.componentDetails(cokeys);
      for (const d of det) {
        const tr = container.querySelector(`tr[data-cokey="${d.cokey}"]`); if (!tr) continue;
        tr.querySelector(".d-flod").textContent = d.flodfreq || "None";
        tr.querySelector(".d-wt").textContent = d.wtdepth_cm != null ? d.wtdepth_cm : "–";
        tr.querySelector(".d-tex").textContent = d.surf_texture || "–";
        tr.querySelector(".d-kw").textContent = d.kw_surface ?? "–";
        tr.querySelector(".d-ksat").textContent = d.ksat_surface != null ? fmt(d.ksat_surface, 1) : "–";
        tr.querySelector(".d-res").textContent = d.restr_cm != null ? d.restr_cm : ">200";
      }
      container.querySelectorAll("td.d-flod, td.d-wt, td.d-tex, td.d-kw, td.d-ksat, td.d-res").forEach((td) => { if (td.textContent === "…") td.textContent = "–"; });
    } catch (e) { console.warn("component details failed", e); container.querySelectorAll("td.d-flod, td.d-wt, td.d-tex, td.d-kw, td.d-ksat, td.d-res").forEach((td) => (td.textContent = "–")); }
  } catch (e) { container.innerHTML = `<h3>Soils at this point (NRCS SSURGO)</h3><div class="notice">Soil Data Access failed: ${escapeHtml(e.message)}</div>`; }
}
