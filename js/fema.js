// FEMA National Flood Hazard Layer (NFHL): flood zones (with floodway), BFE lines, cross sections, LOMRs;
// viewport layer + point section geared to no-rise / CLOMR / LOMR planning. hazards.fema.gov is CORS-enabled.
import { $, escapeHtml, fmt, fmtNum, debounce, haversineKm } from "./util.js";
import { map, setOverlay } from "./map.js";

const N = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer";
const L = { zones: 28, xs: 14, bfe: 16, lomr: 1, panels: 3, baselines: 17, lomas: 34 };
export const MIN_ZOOM = 12;

// Zone styling: floodway darkest, 1% (A/AE/AH/AO) red, 0.2% orange, minimal none
export function zoneStyle(z, sub) {
  const s = (sub || "").toUpperCase();
  if (s.includes("FLOODWAY")) return { color: "#7f1d1d", opacity: 0.55, label: "Regulatory floodway" };
  if (/^(A|AE|AH|AO|A99|V|VE)$/.test(z)) return { color: "#ef4444", opacity: 0.35, label: "1% annual chance (SFHA)" };
  if (s.includes("0.2 PCT")) return { color: "#f59e0b", opacity: 0.3, label: "0.2% annual chance" };
  if (s.includes("LEVEE")) return { color: "#a16207", opacity: 0.3, label: "Reduced risk due to levee" };
  if (z === "D") return { color: "#a3a3a3", opacity: 0.25, label: "Zone D (undetermined)" };
  return { color: "#9ca3af", opacity: 0.08, label: "Minimal flood hazard" };
}
const ZONE_TEXT = { A: "1% annual chance, no BFE determined (approximate study)", AE: "1% annual chance with BFE", AH: "1% annual chance shallow ponding, 1–3 ft", AO: "1% annual chance sheet flow, 1–3 ft", A99: "1% annual chance, protected by levee under construction", V: "Coastal 1% with wave action, no BFE", VE: "Coastal 1% with wave action and BFE", X: "Outside the 1% floodplain", D: "Flood hazard undetermined" };

let enabled = false, lastKey = null, inflight = null;
export function initFema() { map.on("moveend", debounce(() => { if (enabled) refresh(); }, 350)); }
export function setFemaEnabled(on) { enabled = on; if (on) refresh(); else { for (const id of ["fema-zones", "fema-xs", "fema-bfe", "fema-lomr"]) setOverlay(id, empty()); lastKey = null; note(""); } }
const empty = () => ({ type: "FeatureCollection", features: [] });
function note(t) { const el = $("fema-note"); if (el) el.textContent = t; }

async function q(layer, params) {
  const u = new URLSearchParams({ inSR: "4326", outSR: "4326", geometryPrecision: "5", f: "geojson", ...params });
  const r = await fetch(`${N}/${layer}/query?${u}`); if (!r.ok) throw new Error(`NFHL ${layer} ${r.status}`);
  const d = await r.json(); if (d.error) throw new Error(`NFHL ${layer}: ${d.error.message}`);
  return d;
}
async function refresh() {
  const z = map.getZoom(); const b = map.getBounds();
  if (z < MIN_ZOOM) { for (const id of ["fema-zones", "fema-xs", "fema-bfe", "fema-lomr"]) setOverlay(id, empty()); lastKey = null; note(`FEMA: zoom in (${MIN_ZOOM}+) to load`); return; }
  const pad = 0.15;
  const bbox = [b.getWest() - (b.getEast() - b.getWest()) * pad, b.getSouth() - (b.getNorth() - b.getSouth()) * pad, b.getEast() + (b.getEast() - b.getWest()) * pad, b.getNorth() + (b.getNorth() - b.getSouth()) * pad];
  const key = bbox.map((v) => v.toFixed(3)).join(","); if (key === lastKey) return; lastKey = key;
  note("FEMA: loading…");
  const env = { geometry: bbox.map((v) => v.toFixed(5)).join(","), geometryType: "esriGeometryEnvelope", spatialRel: "esriSpatialRelIntersects", resultRecordCount: "2000" };
  const mine = (inflight = Promise.allSettled([
    q(L.zones, { ...env, outFields: "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DEPTH,V_DATUM,STUDY_TYP,DFIRM_ID" }),
    q(L.xs, { ...env, outFields: "XS_LTR,WSEL_REG,STREAM_STN,WTR_NM,XS_LN_TYP,V_DATUM" }),
    q(L.bfe, { ...env, outFields: "ELEV,V_DATUM" }),
    q(L.lomr, { ...env, outFields: "CASE_NO,EFF_DATE,STATUS" }),
  ]));
  const res = await mine; if (inflight !== mine || !enabled) return;
  const [zr, xr, br, lr] = res.map((r) => (r.status === "fulfilled" ? r.value : null));
  const errs = res.filter((r) => r.status === "rejected").map((r) => r.reason?.message);
  if (zr) { for (const f of zr.features) { const p = f.properties; const st = zoneStyle(p.FLD_ZONE, p.ZONE_SUBTY); p.color = st.color; p.opacity = st.opacity; p.minimal = st.label === "Minimal flood hazard" ? 1 : 0; p.popup = `<div class="popup-title">Zone ${escapeHtml(p.FLD_ZONE)}${p.ZONE_SUBTY ? " · " + escapeHtml(titleCase(p.ZONE_SUBTY)) : ""}</div><div class="popup-sub">${escapeHtml(st.label)}${p.STATIC_BFE > -9999 ? ` · static BFE ${p.STATIC_BFE} ft ${escapeHtml(p.V_DATUM || "")}` : ""}${p.DEPTH > -9999 ? ` · depth ${p.DEPTH} ft` : ""} · ${p.STUDY_TYP === "NP" ? "" : escapeHtml(p.STUDY_TYP || "")} FIRM ${escapeHtml(p.DFIRM_ID || "")}</div>`; } setOverlay("fema-zones", zr); }
  if (xr) { for (const f of xr.features) { const p = f.properties; p.label = p.XS_LTR || ""; p.popup = `<div class="popup-title">Cross section ${escapeHtml(p.XS_LTR || "(unlettered)")} · ${escapeHtml(p.WTR_NM || "")}</div><div class="popup-sub">Regulatory WSEL ${fmt(p.WSEL_REG, 1)} ft ${escapeHtml(p.V_DATUM || "")} · station ${fmtNum(p.STREAM_STN)} ft · ${escapeHtml(p.XS_LN_TYP || "")}</div>`; } setOverlay("fema-xs", xr); }
  if (br) { for (const f of br.features) { const p = f.properties; p.label = String(p.ELEV); p.popup = `<div class="popup-title">BFE ${p.ELEV} ft ${escapeHtml(p.V_DATUM || "")}</div>`; } setOverlay("fema-bfe", br); }
  if (lr) { for (const f of lr.features) { const p = f.properties; p.popup = `<div class="popup-title">LOMR ${escapeHtml(p.CASE_NO || "")}</div><div class="popup-sub">${escapeHtml(p.STATUS || "")} · effective ${p.EFF_DATE ? new Date(p.EFF_DATE).toLocaleDateString() : "?"}</div>`; } setOverlay("fema-lomr", lr); }
  const n = (zr?.features.length || 0) + (xr?.features.length || 0) + (br?.features.length || 0) + (lr?.features.length || 0);
  note(`FEMA: ${zr?.features.length || 0} zones, ${xr?.features.length || 0} cross sections, ${br?.features.length || 0} BFEs, ${lr?.features.length || 0} LOMRs${[zr, xr, br, lr].some((r) => r?.properties?.exceededTransferLimit) ? " (limit hit, zoom in)" : ""}${errs.length ? " · failed: " + errs.join("; ") : ""}`);
}
function titleCase(s) { return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bPct\b/, "pct").replace(/\bBfe\b/, "BFE"); }

export function femaLegendHtml() {
  return `<h4>FEMA flood hazard (NFHL)</h4>
    <div class="legend-row"><span class="swatch sq" style="background:#7f1d1d;opacity:.7"></span>Regulatory floodway</div>
    <div class="legend-row"><span class="swatch sq" style="background:#ef4444;opacity:.5"></span>1% annual chance (A, AE, AH, AO)</div>
    <div class="legend-row"><span class="swatch sq" style="background:#f59e0b;opacity:.45"></span>0.2% annual chance (X shaded)</div>
    <div class="legend-row"><span class="swatch sq" style="background:none;border:1.5px solid #0f172a"></span>Cross section (lettered) · <span style="color:#7c2d12">BFE line</span></div>
    <div class="legend-row"><span class="swatch sq" style="background:none;border:1.5px dashed #6d28d9"></span>LOMR area</div>
    <div class="small">Effective NFHL from FEMA (hazards.fema.gov), loads at zoom ${MIN_ZOOM}+. Regulatory data for the effective FIRM; check the panel date and any LOMRs. <span id="fema-note"></span></div>`;
}

// ---- Point panel section ----
export async function renderFemaAt(container, lon, lat) {
  container.innerHTML = `<h3>FEMA flood hazard at this point</h3><div class="spinner">Querying NFHL…</div>`;
  const pt = { geometry: `${lon.toFixed(6)},${lat.toFixed(6)}`, geometryType: "esriGeometryPoint", spatialRel: "esriSpatialRelIntersects", returnGeometry: "false" };
  const near = (m) => { const d = m / 111320; return { geometry: `${(lon - d / Math.cos((lat * Math.PI) / 180)).toFixed(6)},${(lat - d).toFixed(6)},${(lon + d / Math.cos((lat * Math.PI) / 180)).toFixed(6)},${(lat + d).toFixed(6)}`, geometryType: "esriGeometryEnvelope", spatialRel: "esriSpatialRelIntersects" }; };
  try {
    const [zone, panel, lomr, xs, bfe, base] = await Promise.all([
      q(L.zones, { ...pt, outFields: "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DEPTH,V_DATUM,STUDY_TYP,DFIRM_ID,SOURCE_CIT" }).catch(() => null),
      q(L.panels, { ...pt, outFields: "FIRM_PAN,EFF_DATE,PANEL_TYP,PCOMM,ST_FIPS" }).catch(() => null),
      q(L.lomr, { ...pt, outFields: "CASE_NO,EFF_DATE,STATUS" }).catch(() => null),
      q(L.xs, { ...near(600), outFields: "XS_LTR,WSEL_REG,STREAM_STN,WTR_NM,XS_LN_TYP,V_DATUM,STRMBED_EL", returnGeometry: "true" }).catch(() => null),
      q(L.bfe, { ...near(300), outFields: "ELEV,V_DATUM", returnGeometry: "true" }).catch(() => null),
      q(L.baselines, { ...near(600), outFields: "WTR_NM,STUDY_TYP,FLD_PROB1,SPEC_CONS1,R_ST_DESC,R_END_DESC", returnGeometry: "false" }).catch(() => null),
    ]);
    if (!container.isConnected) return;
    const zf = zone?.features || [];
    const zoneState = zf[0]?.properties?.DFIRM_ID?.slice(0, 2);
    const p = (panel?.features || []).map((f) => f.properties).sort((a, b) => (a.ST_FIPS === zoneState ? -1 : 0) - (b.ST_FIPS === zoneState ? -1 : 0))[0];
    const fips = p?.ST_FIPS || zf[0]?.properties?.DFIRM_ID?.slice(0, 2);
    const county = zf[0]?.properties?.DFIRM_ID?.slice(0, 5);
    if (!zf.length && !p) { container.innerHTML = `<h3>FEMA flood hazard at this point</h3><div class="notice">No effective NFHL data here (unmapped area or no digital FIRM). <a href="${mscUrl(lat, lon)}" target="_blank" rel="noopener">FEMA Map Service Center</a></div>`; return; }
    // nearest cross sections with distance
    const xsRows = (xs?.features || []).map((f) => { const c = f.geometry?.coordinates || []; const pts = c.flat(Array.isArray(c[0]?.[0]) ? 1 : 0); let dmin = Infinity; for (const [x, y] of pts) { const d = haversineKm(lat, lon, y, x); if (d < dmin) dmin = d; } return { ...f.properties, m: dmin * 1000 }; }).sort((a, b) => a.m - b.m).slice(0, 6);
    const bfeRows = (bfe?.features || []).map((f) => { const c = f.geometry?.coordinates || []; const pts = c.flat(Array.isArray(c[0]?.[0]) ? 1 : 0); let dmin = Infinity; for (const [x, y] of pts) { const d = haversineKm(lat, lon, y, x); if (d < dmin) dmin = d; } return { ...f.properties, m: dmin * 1000 }; }).sort((a, b) => a.m - b.m).slice(0, 4);
    const inFloodway = zf.some((f) => (f.properties.ZONE_SUBTY || "").toUpperCase().includes("FLOODWAY"));
    const inSfha = zf.some((f) => f.properties.SFHA_TF === "T");
    const primary = zf.find((f) => (f.properties.ZONE_SUBTY || "").toUpperCase().includes("FLOODWAY")) || zf.find((f) => f.properties.SFHA_TF === "T") || zf[0];
    const pp = primary.properties;
    const st = zoneStyle(pp.FLD_ZONE, pp.ZONE_SUBTY);
    const guidance = inFloodway
      ? "Inside the regulatory floodway: any encroachment needs a no-rise certification (0.00 ft increase in the base flood elevation, compared with the effective model) or a CLOMR before construction and a LOMR after. Obtain the effective hydraulic model (HEC-RAS) from the FEMA Engineering Library or MnDNR floodplain staff; the duplicate-effective run must match before the proposed run."
      : inSfha
        ? (pp.FLD_ZONE === "A" ? "Zone A (approximate study, no BFE): a project must establish the BFE (best available data, or a new study) for permitting; changes to the floodplain typically go through a CLOMR/LOMR. Encroachment analysis is at the community's discretion under 44 CFR 60.3(b)." : "Inside the 1% floodplain but outside the floodway: fill or structures are allowed under the local ordinance if the cumulative rise stays within the 1.0 ft allowance (0.5 ft in Minnesota where the DNR model ordinance applies); a CLOMR/LOMR revises the map if the floodplain boundary or BFE changes.")
        : (pp.ZONE_SUBTY || "").includes("0.2") ? "0.2% annual chance zone (shaded X): no federal floodplain permit requirement, but MnDNR and some communities regulate; freeboard to the 0.2% elevation is common practice for critical facilities." : "Outside the mapped SFHA. No FEMA floodplain permit; note that unstudied small streams may still flood.";
    container.innerHTML = `<h3>FEMA flood hazard at this point</h3>
      <div class="stat-row">
        <div class="stat ${inFloodway ? "bad" : inSfha ? "warn" : ""}"><div class="v">${escapeHtml(pp.FLD_ZONE)}${inFloodway ? " FW" : ""}</div><div class="l">flood zone</div><div class="s">${escapeHtml(st.label)}</div></div>
        <div class="stat"><div class="v">${pp.STATIC_BFE > -9999 ? fmt(pp.STATIC_BFE, 1) : bfeRows[0] ? fmt(bfeRows[0].ELEV, 1) : "–"}</div><div class="l">1% (100-yr) BFE, ft ${escapeHtml(pp.V_DATUM || bfeRows[0]?.V_DATUM || "")}</div><div class="s">${pp.STATIC_BFE > -9999 ? "static zone BFE" : bfeRows[0] ? `nearest BFE line, ${fmtNum(bfeRows[0].m * 3.281)} ft away` : "none mapped (Zone A or X)"}</div></div>
        <div class="stat"><div class="v" style="font-size:13px">${p ? escapeHtml(p.FIRM_PAN) : "–"}</div><div class="l">FIRM panel</div><div class="s">${p?.EFF_DATE ? "effective " + new Date(p.EFF_DATE).toLocaleDateString() : ""}${p?.PANEL_TYP ? " · " + escapeHtml(p.PANEL_TYP) : ""}</div></div>
      </div>
      ${zf.length > 1 ? `<div class="small">Zones intersecting the point: ${zf.map((f) => escapeHtml(f.properties.FLD_ZONE + (f.properties.ZONE_SUBTY ? " (" + titleCase(f.properties.ZONE_SUBTY) + ")" : ""))).join("; ")}.</div>` : ""}
      ${lomr?.features?.length ? `<div class="notice">LOMR in effect here: ${lomr.features.map((f) => `${escapeHtml(f.properties.CASE_NO)} (${escapeHtml(f.properties.STATUS || "")}, ${f.properties.EFF_DATE ? new Date(f.properties.EFF_DATE).toLocaleDateString() : "?"})`).join("; ")}. The revised data supersede the panel.</div>` : ""}
      <div class="notice">${escapeHtml(guidance)}</div>
      ${base?.features?.length ? `<div class="small">Studied reach: ${base.features.map((f) => `${escapeHtml(f.properties.WTR_NM || "")} (${escapeHtml(f.properties.STUDY_TYP || "")}${f.properties.FLD_PROB1 ? ", " + escapeHtml(f.properties.FLD_PROB1) : ""}${f.properties.SPEC_CONS1 ? ", " + escapeHtml(f.properties.SPEC_CONS1) : ""})`).join("; ")}</div>` : ""}
      ${xsRows.length ? `<h3>Nearest cross sections</h3><table class="data"><thead><tr><th>XS</th><th>Stream</th><th class="num">Reg. WSEL ft</th><th class="num">Streambed ft</th><th class="num">Station ft</th><th class="num">Dist ft</th></tr></thead><tbody>
        ${xsRows.map((r) => `<tr><td><b>${escapeHtml(r.XS_LTR || "–")}</b><div class="small">${escapeHtml(r.XS_LN_TYP || "")}</div></td><td>${escapeHtml(r.WTR_NM || "")}</td><td class="num">${fmt(r.WSEL_REG, 1)}</td><td class="num">${r.STRMBED_EL > -9999 ? fmt(r.STRMBED_EL, 1) : "–"}</td><td class="num">${fmtNum(r.STREAM_STN)}</td><td class="num">${fmtNum(r.m * 3.281)}</td></tr>`).join("")}</tbody></table>
        <div class="small">Regulatory water-surface elevations at the effective cross sections (${escapeHtml(xsRows[0].V_DATUM || "datum per FIS")}); a no-rise compares proposed against these. Lettered sections appear in the FIS profile.</div>` : ""}
      <div class="actions">
        <a class="btn" href="${mscUrl(lat, lon)}" target="_blank" rel="noopener">FEMA Map Service Center</a>
        <a class="btn" href="https://msc.fema.gov/portal/advanceSearch" target="_blank" rel="noopener">FIS report / effective model</a>
        ${fips === "27" ? `<a class="btn" href="https://www.dnr.state.mn.us/waters/watermgmt_section/floodplain/index.html" target="_blank" rel="noopener">MnDNR floodplain program</a>` : ""}
        <a class="btn" href="https://www.fema.gov/flood-maps/change-your-flood-zone/paperwork" target="_blank" rel="noopener">MT-2 (CLOMR/LOMR) forms</a>
      </div>
      <div class="small"><b>Flood elevations.</b> The 1% (100-year) water surface is the BFE above and the regulatory WSEL at each cross section. FEMA does not serve the 0.2% (500-year), 2% or 10% elevations as data: they are in the Flood Insurance Study's flood profiles and Floodway Data Table, indexed by the cross-section letters listed here. Open the FIS via the Map Service Center for this panel${xsRows.length ? ` and look up ${escapeHtml(xsRows.filter((r) => r.XS_LTR).map((r) => r.XS_LTR).slice(0, 4).join(", ") || "the nearest lettered section")} on ${escapeHtml(xsRows[0].WTR_NM || "the studied stream")}` : ""}.</div>
      <div class="small">Effective NFHL data from FEMA (${escapeHtml(pp.DFIRM_ID || "")}, ${escapeHtml(pp.SOURCE_CIT || "")}). Pending or preliminary maps are not shown; confirm with the community floodplain administrator before design.</div>`;
  } catch (e) { container.innerHTML = `<h3>FEMA flood hazard at this point</h3><div class="notice">NFHL request failed: ${escapeHtml(e.message)}</div>`; }
}
export const mscUrl = (lat, lon) => `https://msc.fema.gov/portal/search?AddressQuery=${lat.toFixed(5)}%2C${lon.toFixed(5)}`;
