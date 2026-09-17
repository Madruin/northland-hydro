// Point and basin sections for the regulatory water layers: DNR Public Waters Inventory, MPCA impaired waters and
// TMDL allocation areas, and BWSR RIM / wetland-bank easements. Map layers themselves live in dnrlayers.js.
import { escapeHtml, fmt, fmtNum, haversineKm } from "./util.js";

const DNR = "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr";
const PCA = "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_pca";
const BWSR = "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_bwsr";
export const IMPAIRED = { streams: `${PCA}/env_impaired_water_2024/FeatureServer/7`, lakes: `${PCA}/env_impaired_water_2024/FeatureServer/13`, tmdl: `${PCA}/env_tmdl_allocation_areas/FeatureServer/3` };
export const PWI = { lines: `${DNR}/water_mn_public_waters/FeatureServer/0`, basins: `${DNR}/water_mn_public_waters/FeatureServer/1` };
export const EASE = { rim: `${BWSR}/bdry_bwsr_rim_cons_easements/FeatureServer/0`, bank: `${BWSR}/bdry_wetland_banking_easements/FeatureServer/0` };

// MPCA impairment parameter abbreviations as used in imp_param / needs_pln / approved
export const IMP = { "Hg-F": "mercury in fish tissue", "Hg-W": "mercury in water", T: "turbidity", TSS: "total suspended solids", "E.coli": "E. coli", FC: "fecal coliform", DO: "dissolved oxygen", Nutrients: "nutrients / eutrophication", "Fishes bio": "fish bioassessment", "Invert bio": "macroinvertebrate bioassessment", Chloride: "chloride", "PCB-F": "PCBs in fish tissue", "PFOS-F": "PFOS in fish tissue", pH: "pH", Temp: "temperature", Ammonia: "ammonia", Arsenic: "arsenic", Nitrates: "nitrates", Sulfate: "sulfate", Al: "aluminum", "Plant bio": "aquatic plant bioassessment" };
const USES = { AQL: "aquatic life", AQR: "aquatic recreation", AQC: "aquatic consumption", DWS: "drinking water", LAC: "limited aquatic life" };
export const impList = (s) => (s || "").split(";").map((x) => x.trim()).filter((x) => x && x !== "None").map((x) => IMP[x] ? `${x} (${IMP[x]})` : x);
export const useList = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => USES[x] || x);

async function q(url, params, fmtOut = "json") {
  const u = new URLSearchParams({ inSR: "4326", outSR: "4326", f: fmtOut, ...params });
  const r = await fetch(`${url}/query?${u}`); if (!r.ok) throw new Error(`${r.status}`);
  const d = await r.json(); if (d.error) throw new Error(d.error.message); return d;
}
const near = (lon, lat, m) => { const d = m / 111320, dx = d / Math.cos((lat * Math.PI) / 180); return { geometry: `${(lon - dx).toFixed(6)},${(lat - d).toFixed(6)},${(lon + dx).toFixed(6)},${(lat + d).toFixed(6)}`, geometryType: "esriGeometryEnvelope", spatialRel: "esriSpatialRelIntersects" }; };
const at = (lon, lat) => ({ geometry: `${lon.toFixed(6)},${lat.toFixed(6)}`, geometryType: "esriGeometryPoint", spatialRel: "esriSpatialRelIntersects", returnGeometry: "false" });
function distToGeom(lon, lat, g) {
  let dmin = Infinity; const walk = (c) => { if (typeof c[0] === "number") { const d = haversineKm(lat, lon, c[1], c[0]) * 1000; if (d < dmin) dmin = d; } else c.forEach(walk); };
  if (g?.coordinates) walk(g.coordinates); return dmin;
}
const dateOf = (ms) => (ms ? new Date(ms).toLocaleDateString() : "");

// ---- Public Waters Inventory ----
export async function renderPwiAt(container, lon, lat) {
  container.innerHTML = "";
  try {
    const [basins, lines] = await Promise.all([
      q(PWI.basins, { ...at(lon, lat), outFields: "pw_basin_name,dowlknum,pwi_class,pwi_label,wettype,acres,shore_mi,dnr_shoreland_class" }).catch(() => null),
      q(PWI.lines, { ...near(lon, lat, 150), outFields: "kittle_name,kittle_nbr,pwi_label,entire", returnGeometry: "true" }, "geojson").catch(() => null),
    ]);
    const b = basins?.features?.[0]?.attributes;
    const ls = (lines?.features || []).map((f) => ({ ...f.properties, m: distToGeom(lon, lat, f.geometry) })).sort((x, y) => x.m - y.m);
    if (!b && !ls.length) return;
    let html = `<h3>Public waters (DNR PWI)</h3>`;
    if (b) html += `<div><b>${escapeHtml(b.pw_basin_name || "Unnamed basin")}</b> · ${escapeHtml(b.pwi_label || "")}${b.pwi_class ? ` (class ${escapeHtml(b.pwi_class)})` : ""}${b.dowlknum ? ` · DOW ${escapeHtml(b.dowlknum)}` : ""}</div>
      <div class="small">${b.acres ? `${fmtNum(b.acres)} ac` : ""}${b.shore_mi ? ` · ${fmt(b.shore_mi, 1)} mi shoreline` : ""}${b.dnr_shoreland_class ? ` · shoreland class: <b>${escapeHtml(b.dnr_shoreland_class)}</b>` : ""}</div>`;
    if (ls.length) { const l = ls[0]; html += `<div style="margin-top:4px"><b>${escapeHtml(l.kittle_name || "Unnamed watercourse")}</b> · ${escapeHtml(l.pwi_label || "Public water watercourse")}${l.entire === "Y" ? " (entire length)" : ""} <span class="small">· ${fmtNum(l.m * 3.281)} ft away${l.kittle_nbr ? " · " + escapeHtml(l.kittle_nbr) : ""}${l.upsum_sqmi ? ` · ${fmt(l.upsum_sqmi, 1)} mi² upstream` : ""}</span></div>`; }
    html += `<div class="notice">Work in the bed or bank of a public water below the ordinary high water level needs a <a href="https://www.dnr.state.mn.us/permits/water/index.html" target="_blank" rel="noopener">DNR public waters work permit</a> (or must fit a general permit); shoreland zoning applies within 1,000 ft of a public water basin and 300 ft of a watercourse. Verify with the <a href="https://www.dnr.state.mn.us/waters/watermgmt_section/pwi/maps.html" target="_blank" rel="noopener">official PWI maps</a> and the area hydrologist.</div>`;
    container.innerHTML = html;
  } catch (e) { container.innerHTML = `<h3>Public waters (DNR PWI)</h3><div class="notice">PWI request failed: ${escapeHtml(e.message)}</div>`; }
}

// ---- Impaired waters + TMDL ----
function impairedRow(p, kind) {
  const imps = impList(p.imp_param); const approved = impList(p.approved); const needs = impList(p.needs_pln);
  return `<tr><td><b>${escapeHtml(p.name || "Unnamed")}</b> <span class="small">${kind} · ${escapeHtml(p.reach_desc || "")} · AUID ${escapeHtml(p.auid || "")}${p.m != null ? ` · ${fmtNum(p.m * 3.281)} ft` : ""}</span></td>
    <td class="small">${imps.map(escapeHtml).join("; ") || "–"}</td><td class="small">${useList(p.affected_u).map(escapeHtml).join(", ")}</td>
    <td class="small">${approved.length ? `TMDL approved: ${escapeHtml(approved.join("; "))}` : ""}${needs.length ? `${approved.length ? "<br>" : ""}TMDL needed: ${escapeHtml(needs.join("; "))}` : ""}${p.new_impair && p.new_impair !== "None" ? `<br>new 2024: ${escapeHtml(p.new_impair)}` : ""}</td></tr>`;
}
const IMP_FIELDS = "auid,name,reach_desc,affected_u,imp_param,new_impair,needs_pln,approved,huc_8_name,use_class";
export async function renderImpairedAt(container, lon, lat) {
  container.innerHTML = "";
  try {
    const [st, lk, tm] = await Promise.all([
      q(IMPAIRED.streams, { ...near(lon, lat, 500), outFields: IMP_FIELDS, returnGeometry: "true", geometryPrecision: "5" }, "geojson").catch(() => null),
      q(IMPAIRED.lakes, { ...near(lon, lat, 300), outFields: IMP_FIELDS + ",area_acres", returnGeometry: "true", geometryPrecision: "5" }, "geojson").catch(() => null),
      q(IMPAIRED.tmdl, { ...at(lon, lat), outFields: "waterbody_name,tmdl_pollutant,epa_approval,source,area_sq_mi,wid" }).catch(() => null),
    ]);
    const streams = (st?.features || []).map((f) => ({ ...f.properties, m: distToGeom(lon, lat, f.geometry) })).sort((a, b) => a.m - b.m).slice(0, 4);
    const lakes = (lk?.features || []).map((f) => ({ ...f.properties, m: distToGeom(lon, lat, f.geometry) })).sort((a, b) => a.m - b.m).slice(0, 2);
    const tmdl = tm?.features?.map((f) => f.attributes) || [];
    if (!streams.length && !lakes.length && !tmdl.length) return;
    container.innerHTML = `<h3>Impaired waters (MPCA 2024 list) and TMDLs</h3>
      ${streams.length || lakes.length ? `<table class="data"><thead><tr><th>Water</th><th>Impairments</th><th>Affected uses</th><th>TMDL status</th></tr></thead><tbody>${streams.map((p) => impairedRow(p, "stream")).join("")}${lakes.map((p) => impairedRow(p, "lake")).join("")}</tbody></table>` : `<div class="small">No impaired stream reach within 500 m or impaired lake within 300 m.</div>`}
      ${tmdl.length ? `<div class="small" style="margin-top:4px"><b>Inside TMDL allocation area${tmdl.length > 1 ? "s" : ""}:</b> ${tmdl.map((t) => `${escapeHtml(t.waterbody_name || "")} · ${escapeHtml(t.tmdl_pollutant || "")}${t.epa_approval ? ` (EPA approved ${dateOf(t.epa_approval)})` : ""}${t.area_sq_mi ? ` · ${fmt(t.area_sq_mi, 1)} mi²` : ""}`).join("; ")}. Load allocations apply to new and expanded sources in this area.</div>` : ""}
      <div class="small">Source: MPCA 2024 impaired waters list (303(d)) and TMDL allocation areas. Impairments drive Clean Water Fund and 319 eligibility; TMDL wasteload and load allocations are in the approved TMDL report on <a href="https://www.pca.state.mn.us/air-water-land-climate/minnesotas-impaired-waters-list" target="_blank" rel="noopener">MPCA's impaired waters page</a>.</div>`;
  } catch (e) { container.innerHTML = `<h3>Impaired waters</h3><div class="notice">MPCA request failed: ${escapeHtml(e.message)}</div>`; }
}
// Impaired reaches and lakes intersecting a basin polygon (watershed section)
const basinCache = new Map();
function ring(geometry, max = 400) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const r = polys.map((p) => p[0]).sort((a, b) => b.length - a.length)[0]; const step = Math.max(1, Math.ceil(r.length / max));
  const pts = r.filter((_, i) => i % step === 0).map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]); if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) pts.push(pts[0]); return pts;
}
export async function renderBasinImpairments(container, geometry) {
  container.innerHTML = `<div class="small">Loading impaired waters in basin…</div>`;
  try {
    const rg = ring(geometry); const key = JSON.stringify(rg).slice(0, 200) + rg.length;
    let res = basinCache.get(key);
    if (!res) {
      const geom = JSON.stringify({ rings: [rg], spatialReference: { wkid: 4326 } });
      const p = { geometry: geom, geometryType: "esriGeometryPolygon", spatialRel: "esriSpatialRelIntersects", returnGeometry: "false", resultRecordCount: "200" };
      const [st, lk, tm] = await Promise.all([q(IMPAIRED.streams, { ...p, outFields: IMP_FIELDS + ",length_miles" }), q(IMPAIRED.lakes, { ...p, outFields: IMP_FIELDS + ",area_acres" }), q(IMPAIRED.tmdl, { ...p, outFields: "waterbody_name,tmdl_pollutant,epa_approval" })]);
      res = { streams: (st.features || []).map((f) => f.attributes), lakes: (lk.features || []).map((f) => f.attributes), tmdl: (tm.features || []).map((f) => f.attributes) };
      basinCache.set(key, res);
    }
    const all = [...res.streams, ...res.lakes];
    if (!all.length && !res.tmdl.length) { container.innerHTML = `<h3>Impaired waters in basin</h3><div class="small">No reach or lake in the basin is on the 2024 impaired waters list.</div>`; return; }
    const tally = {}; for (const w of all) for (const i of impList(w.imp_param)) tally[i] = (tally[i] || 0) + 1;
    container.innerHTML = `<h3>Impaired waters in basin <span class="pill">${all.length}</span></h3>
      <div class="small">Impairments: ${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${escapeHtml(k)} ×${n}`).join(" · ")}</div>
      <table class="data"><thead><tr><th>Water</th><th>Impairments</th><th>Affected uses</th><th>TMDL status</th></tr></thead><tbody>${res.streams.map((p) => impairedRow(p, "stream")).join("")}${res.lakes.map((p) => impairedRow(p, "lake")).join("")}</tbody></table>
      ${res.tmdl.length ? `<div class="small">TMDL allocation areas overlapping the basin: ${[...new Set(res.tmdl.map((t) => `${t.waterbody_name} (${t.tmdl_pollutant})`))].map(escapeHtml).join("; ")}.</div>` : ""}
      <div class="small">MPCA 2024 list; reaches that touch the basin boundary are included.</div>`;
  } catch (e) { container.innerHTML = `<h3>Impaired waters in basin</h3><div class="notice">MPCA request failed: ${escapeHtml(e.message)}</div>`; }
}

// ---- Easements ----
export async function renderEasementsAt(container, lon, lat) {
  container.innerHTML = "";
  try {
    const [rim, bank] = await Promise.all([
      q(EASE.rim, { ...near(lon, lat, 30), outFields: "ease_num,ease_type,ease_cat,fund_type,ease_acres,ease_year,exp_status,exp_date,swcd_name,recorded,rec_date" }).catch(() => null),
      q(EASE.bank, { ...near(lon, lat, 30), outFields: "county,siteid,easement_number,acres,instrument_type,recording_date,description" }).catch(() => null),
    ]);
    const r = rim?.features?.map((f) => f.attributes) || []; const b = bank?.features?.map((f) => f.attributes) || [];
    if (!r.length && !b.length) return;
    container.innerHTML = `<h3>Conservation easements at this point</h3>
      ${r.map((e) => `<div><b>BWSR ${escapeHtml(e.ease_cat || "RIM")} easement ${escapeHtml(e.ease_num || "")}</b> · ${escapeHtml(e.ease_type || "")}<div class="small">${fmt(e.ease_acres, 1)} ac · ${escapeHtml(e.swcd_name || "")} SWCD · signed ${escapeHtml(String(e.ease_year || ""))}${e.fund_type ? " · " + escapeHtml(e.fund_type) : ""} · status ${escapeHtml(e.exp_status || "")}${e.exp_date ? ", expires " + dateOf(e.exp_date) : ""}${e.recorded === "Y" ? " · recorded" + (e.rec_date ? " " + dateOf(e.rec_date) : "") : ""}</div></div>`).join("")}
      ${b.map((e) => `<div><b>Wetland bank easement ${escapeHtml(e.easement_number || e.easement_id || "")}</b> · site ${escapeHtml(String(e.siteid || ""))}<div class="small">${fmt(e.acres, 1)} ac · ${escapeHtml(e.county || "")} County${e.instrument_type ? " · " + escapeHtml(e.instrument_type) : ""}${e.recording_date ? " · recorded " + dateOf(e.recording_date) : ""}${e.description ? " · " + escapeHtml(e.description) : ""}</div></div>`).join("")}
      <div class="notice">Easement land carries use restrictions; any project inside the boundary needs BWSR (RIM) or the wetland bank sponsor's sign-off. Boundaries here are the recorded GIS versions; the recorded legal description governs.</div>`;
  } catch (e) { container.innerHTML = `<h3>Conservation easements</h3><div class="notice">BWSR request failed: ${escapeHtml(e.message)}</div>`; }
}
