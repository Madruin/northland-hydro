// Point and basin sections for the regulatory water layers: DNR Public Waters Inventory, MPCA impaired waters and
// TMDL allocation areas, and BWSR RIM / wetland-bank easements. Map layers themselves live in dnrlayers.js.
import { escapeHtml, fmt, fmtNum, haversineKm, distToGeomM } from "./util.js";
import { fetchStatic } from "./dnrlayers.js";

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
  const r = await fetch(`${url}/query?${u}`, { signal: AbortSignal.timeout(90000) }); if (!r.ok) throw new Error(`${r.status}`);
  const d = await r.json(); if (d.error) throw new Error(d.error.message); return d;
}
const near = (lon, lat, m) => { const d = m / 111320, dx = d / Math.cos((lat * Math.PI) / 180); return { geometry: `${(lon - dx).toFixed(6)},${(lat - d).toFixed(6)},${(lon + dx).toFixed(6)},${(lat + d).toFixed(6)}`, geometryType: "esriGeometryEnvelope", spatialRel: "esriSpatialRelIntersects" }; };
const at = (lon, lat) => ({ geometry: `${lon.toFixed(6)},${lat.toFixed(6)}`, geometryType: "esriGeometryPoint", spatialRel: "esriSpatialRelIntersects", returnGeometry: "false" });
const distToGeom = (lon, lat, g) => distToGeomM(lon, lat, g); // metres to the nearest segment
const dateOf = (ms) => (ms ? new Date(ms).toLocaleDateString() : "");


// ---- Snapshot first, live second ----
// The regional snapshots under data/layers (see dnrlayers.js) answer point questions in milliseconds; MnGeo is then
// asked for the current answer and replaces it when (if) it arrives. The returned promise settles after the first
// paint, so the panel's jump bar turns "ready" without waiting up to 90 s for MnGeo.
const clock = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function pip(lon, lat, g) {
  const inRing = (r) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.some((p) => inRing(p[0]) && !p.slice(1).some(inRing));
}
async function snapNear(id, lon, lat, m) {
  const d = Math.max(m, 1) / 111320, dx = d / Math.cos((lat * Math.PI) / 180);
  const st = await fetchStatic({ id }, [lon - dx, lat - d, lon + dx, lat + d]);
  if (!st) return null;
  const features = st.fc.features.map((f) => ({ ...f.properties, m: f.geometry && /Polygon/.test(f.geometry.type) && pip(lon, lat, f.geometry) ? 0 : distToGeom(lon, lat, f.geometry) })).filter((f) => f.m <= Math.max(m, 0.5)).sort((a, b) => a.m - b.m);
  return { features, fetched: st.fetched };
}
async function twoPhase(container, snapFn, liveFn, paint, failTitle) {
  const tok = (container.dataset.tok = String(Math.random())); const mine = () => container.dataset.tok === tok;
  container.innerHTML = "";
  const live = liveFn().then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));
  let snap = null; try { snap = await snapFn(); } catch { snap = null; }
  if (!mine()) return;
  const finish = (res) => {
    if (!mine()) return;
    if (res.ok) paint(res.r, `live from MnGeo, ${clock()}`);
    else if (snap) { const a = container.querySelector(":scope > .asof"); if (a) a.textContent = `snapshot ${snap.fetched} · MnGeo not answering, showing snapshot`; }
    else container.innerHTML = `<h3>${failTitle}</h3><div class="notice">${failTitle} request failed: ${escapeHtml(res.e?.message || "")}</div>`;
  };
  if (snap) { paint(snap.r, `snapshot ${snap.fetched} · checking MnGeo for newer data…`); live.then(finish); }
  else finish(await live);
}
const asof = (t) => `<div class="asof">${escapeHtml(t)}</div>`;
// ---- Public Waters Inventory ----
export function renderPwiAt(container, lon, lat) {
  const paint = ({ b, ls }, tag) => {
    if (!b && !ls.length) { container.innerHTML = ""; return; }
    let html = `<h3>Public waters (DNR PWI)</h3>`;
    if (b) html += `<div><b>${escapeHtml(b.pw_basin_name || "Unnamed basin")}</b> · ${escapeHtml(b.pwi_label || "")}${b.pwi_class ? ` (class ${escapeHtml(b.pwi_class)})` : ""}${b.dowlknum ? ` · DOW ${escapeHtml(b.dowlknum)}` : ""}</div>
      <div class="small">${b.acres ? `${fmtNum(b.acres)} ac` : ""}${b.shore_mi ? ` · ${fmt(b.shore_mi, 1)} mi shoreline` : ""}${b.dnr_shoreland_class ? ` · shoreland class: <b>${escapeHtml(b.dnr_shoreland_class)}</b>` : ""}</div>`;
    if (ls.length) { const l = ls[0]; html += `<div style="margin-top:4px"><b>${escapeHtml(l.kittle_name || "Unnamed watercourse")}</b> · ${escapeHtml(l.pwi_label || "Public water watercourse")}${l.entire === "Y" ? " (entire length)" : ""} <span class="small">· ${fmtNum(l.m * 3.281)} ft away${l.kittle_nbr ? " · " + escapeHtml(l.kittle_nbr) : ""}${l.upsum_sqmi ? ` · ${fmt(l.upsum_sqmi, 1)} mi² upstream` : ""}</span></div>`; }
    html += `<div class="notice">Work in the bed or bank of a public water below the ordinary high water level needs a <a href="https://www.dnr.state.mn.us/permits/water/index.html" target="_blank" rel="noopener">DNR public waters work permit</a> (or must fit a general permit); shoreland zoning applies within 1,000 ft of a public water basin and 300 ft of a watercourse. Verify with the <a href="https://www.dnr.state.mn.us/waters/watermgmt_section/pwi/maps.html" target="_blank" rel="noopener">official PWI maps</a> and the area hydrologist.</div>`;
    container.innerHTML = html + asof(tag);
  };
  const snapFn = async () => {
    const [bs, ln] = await Promise.all([snapNear("pwi-basins", lon, lat, 0), snapNear("pwi-lines", lon, lat, 150)]);
    if (!bs && !ln) return null;
    return { r: { b: bs?.features[0] || null, ls: ln?.features || [] }, fetched: bs?.fetched || ln?.fetched };
  };
  const liveFn = async () => {
    const [basins, lines] = await Promise.all([
      q(PWI.basins, { ...at(lon, lat), outFields: "pw_basin_name,dowlknum,pwi_class,pwi_label,wettype,acres,shore_mi,dnr_shoreland_class" }),
      q(PWI.lines, { ...near(lon, lat, 150), outFields: "kittle_name,kittle_nbr,pwi_label,entire", returnGeometry: "true" }, "geojson"),
    ]);
    return { b: basins?.features?.[0]?.attributes || null, ls: (lines?.features || []).map((f) => ({ ...f.properties, m: distToGeom(lon, lat, f.geometry) })).sort((x, y) => x.m - y.m) };
  };
  return twoPhase(container, snapFn, liveFn, paint, "Public waters (DNR PWI)");
}

// ---- Impaired waters + TMDL ----
function impairedRow(p, kind) {
  const imps = impList(p.imp_param); const approved = impList(p.approved); const needs = impList(p.needs_pln);
  return `<tr><td><b>${escapeHtml(p.name || "Unnamed")}</b> <span class="small">${kind} · ${escapeHtml(p.reach_desc || "")} · AUID ${escapeHtml(p.auid || "")}${p.m != null ? ` · ${fmtNum(p.m * 3.281)} ft` : ""}</span></td>
    <td class="small">${imps.map(escapeHtml).join("; ") || "–"}</td><td class="small">${useList(p.affected_u).map(escapeHtml).join(", ")}</td>
    <td class="small">${approved.length ? `TMDL approved: ${escapeHtml(approved.join("; "))}` : ""}${needs.length ? `${approved.length ? "<br>" : ""}TMDL needed: ${escapeHtml(needs.join("; "))}` : ""}${p.new_impair && p.new_impair !== "None" ? `<br>new 2024: ${escapeHtml(p.new_impair)}` : ""}</td></tr>`;
}
const IMP_FIELDS = "auid,name,reach_desc,affected_u,imp_param,new_impair,needs_pln,approved,huc_8_name,use_class";
export function renderImpairedAt(container, lon, lat) {
  const paint = ({ streams, lakes, tmdl }, tag) => {
    if (!streams.length && !lakes.length && !tmdl.length) { container.innerHTML = ""; return; }
    container.innerHTML = `<h3>Impaired waters (MPCA 2024 list) and TMDLs</h3>
      ${streams.length || lakes.length ? `<table class="data"><thead><tr><th>Water</th><th>Impairments</th><th>Affected uses</th><th>TMDL status</th></tr></thead><tbody>${streams.map((p) => impairedRow(p, "stream")).join("")}${lakes.map((p) => impairedRow(p, "lake")).join("")}</tbody></table>` : `<div class="small">No impaired stream reach within 500 m or impaired lake within 300 m.</div>`}
      ${tmdl.length ? `<div class="small" style="margin-top:4px"><b>Inside TMDL allocation area${tmdl.length > 1 ? "s" : ""}:</b> ${tmdl.map((t) => `${escapeHtml(t.waterbody_name || "")} · ${escapeHtml(t.tmdl_pollutant || "")}${t.epa_approval ? ` (EPA approved ${dateOf(t.epa_approval)})` : ""}${t.area_sq_mi ? ` · ${fmt(t.area_sq_mi, 1)} mi²` : ""}`).join("; ")}. Load allocations apply to new and expanded sources in this area.</div>` : ""}
      <div class="small">Source: MPCA 2024 impaired waters list (303(d)) and TMDL allocation areas. Impairments drive Clean Water Fund and 319 eligibility; TMDL wasteload and load allocations are in the approved TMDL report on <a href="https://www.pca.state.mn.us/air-water-land-climate/minnesotas-impaired-waters-list" target="_blank" rel="noopener">MPCA's impaired waters page</a>.</div>` + asof(tag);
  };
  const snapFn = async () => {
    const [st, lk, tm] = await Promise.all([snapNear("imp-streams", lon, lat, 500), snapNear("imp-lakes", lon, lat, 300), snapNear("tmdl-areas", lon, lat, 0)]);
    if (!st && !lk && !tm) return null;
    return { r: { streams: (st?.features || []).slice(0, 4), lakes: (lk?.features || []).slice(0, 2), tmdl: tm?.features || [] }, fetched: st?.fetched || lk?.fetched || tm?.fetched };
  };
  const liveFn = async () => {
    const [st, lk, tm] = await Promise.all([
      q(IMPAIRED.streams, { ...near(lon, lat, 500), outFields: IMP_FIELDS, returnGeometry: "true", geometryPrecision: "5" }, "geojson"),
      q(IMPAIRED.lakes, { ...near(lon, lat, 300), outFields: IMP_FIELDS + ",area_acres", returnGeometry: "true", geometryPrecision: "5" }, "geojson"),
      q(IMPAIRED.tmdl, { ...at(lon, lat), outFields: "waterbody_name,tmdl_pollutant,epa_approval,source,area_sq_mi,wid" }),
    ]);
    return {
      streams: (st?.features || []).map((f) => ({ ...f.properties, m: distToGeom(lon, lat, f.geometry) })).sort((a, b) => a.m - b.m).slice(0, 4),
      lakes: (lk?.features || []).map((f) => ({ ...f.properties, m: distToGeom(lon, lat, f.geometry) })).sort((a, b) => a.m - b.m).slice(0, 2),
      tmdl: tm?.features?.map((f) => f.attributes) || [],
    };
  };
  return twoPhase(container, snapFn, liveFn, paint, "Impaired waters");
}
// Impaired reaches and lakes intersecting a basin polygon (watershed section)
const basinCache = new Map();
function ring(geometry, max = 400) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const r = polys.map((p) => p[0]).sort((a, b) => b.length - a.length)[0]; const step = Math.max(1, Math.ceil(r.length / max));
  const pts = r.filter((_, i) => i % step === 0).map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]); if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) pts.push(pts[0]); return pts;
}
// Does a snapshot feature touch the basin? vertex-in-polygon either way, or an edge crossing (bbox-prefiltered).
function bboxOf(g) { if (g.__bb) return g.__bb; let x0 = 180, y0 = 90, x1 = -180, y1 = -90; const w = (c) => { if (typeof c[0] === "number") { if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1]; } else c.forEach(w); }; w(g.coordinates); return (g.__bb = [x0, y0, x1, y1]); }
function segCross(a, b, c, d) { const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b); }
function touchesBasin(g, ring, rb) {
  const bb = bboxOf(g); if (bb[0] > rb[2] || bb[2] < rb[0] || bb[1] > rb[3] || bb[3] < rb[1]) return false;
  const basin = { type: "Polygon", coordinates: [ring] };
  const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : [];
  for (const l of lines) for (const c of l) if (pip(c[0], c[1], basin)) return true;
  if (/Polygon/.test(g.type)) for (const c of ring) if (pip(c[0], c[1], g)) return true;
  for (const l of lines) for (let i = 1; i < l.length; i++) {
    const a = l[i - 1], b = l[i]; const sx0 = Math.min(a[0], b[0]), sx1 = Math.max(a[0], b[0]), sy0 = Math.min(a[1], b[1]), sy1 = Math.max(a[1], b[1]);
    if (sx0 > rb[2] || sx1 < rb[0] || sy0 > rb[3] || sy1 < rb[1]) continue;
    for (let k = 1; k < ring.length; k++) { const c = ring[k - 1], d = ring[k]; if (Math.max(c[0], d[0]) < sx0 || Math.min(c[0], d[0]) > sx1 || Math.max(c[1], d[1]) < sy0 || Math.min(c[1], d[1]) > sy1) continue; if (segCross(a, b, c, d)) return true; }
  }
  return false;
}
async function snapInBasin(id, ring, rb) {
  const st = await fetchStatic({ id }, rb); if (!st) return null;
  return { features: st.fc.features.filter((f) => f.geometry && touchesBasin(f.geometry, ring, rb)).map((f) => f.properties), fetched: st.fetched };
}
export function renderBasinImpairments(container, geometry) {
  container.innerHTML = `<div class="small">Loading impaired waters in basin…</div>`;
  const rg = ring(geometry); const rb = bboxOf({ coordinates: rg }); const key = JSON.stringify(rg).slice(0, 200) + rg.length;
  const paint = (res, tag) => {
    const all = [...res.streams, ...res.lakes];
    if (!all.length && !res.tmdl.length) { container.innerHTML = `<h3>Impaired waters in basin</h3><div class="small">No reach or lake in the basin is on the 2024 impaired waters list.</div>` + asof(tag); return; }
    const tally = {}; for (const w of all) for (const i of impList(w.imp_param)) tally[i] = (tally[i] || 0) + 1;
    container.innerHTML = `<h3>Impaired waters in basin <span class="pill">${all.length}</span></h3>
      <div class="small">Impairments: ${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${escapeHtml(k)} ×${n}`).join(" · ")}</div>
      <table class="data"><thead><tr><th>Water</th><th>Impairments</th><th>Affected uses</th><th>TMDL status</th></tr></thead><tbody>${res.streams.map((p) => impairedRow(p, "stream")).join("")}${res.lakes.map((p) => impairedRow(p, "lake")).join("")}</tbody></table>
      ${res.tmdl.length ? `<div class="small">TMDL allocation areas overlapping the basin: ${[...new Set(res.tmdl.map((t) => `${t.waterbody_name} (${t.tmdl_pollutant})`))].map(escapeHtml).join("; ")}.</div>` : ""}
      <div class="small">MPCA 2024 list; reaches that touch the basin boundary are included.</div>` + asof(tag);
  };
  const snapFn = async () => {
    const [st, lk, tm] = await Promise.all([snapInBasin("imp-streams", rg, rb), snapInBasin("imp-lakes", rg, rb), snapInBasin("tmdl-areas", rg, rb)]);
    if (!st && !lk && !tm) return null;
    return { r: { streams: st?.features || [], lakes: lk?.features || [], tmdl: tm?.features || [] }, fetched: st?.fetched || lk?.fetched || tm?.fetched };
  };
  const liveFn = async () => {
    let res = basinCache.get(key);
    if (!res) {
      const geom = JSON.stringify({ rings: [rg], spatialReference: { wkid: 4326 } });
      const p = { geometry: geom, geometryType: "esriGeometryPolygon", spatialRel: "esriSpatialRelIntersects", returnGeometry: "false", resultRecordCount: "200" };
      const [st, lk, tm] = await Promise.all([q(IMPAIRED.streams, { ...p, outFields: IMP_FIELDS + ",length_miles" }), q(IMPAIRED.lakes, { ...p, outFields: IMP_FIELDS + ",area_acres" }), q(IMPAIRED.tmdl, { ...p, outFields: "waterbody_name,tmdl_pollutant,epa_approval" })]);
      res = { streams: (st.features || []).map((f) => f.attributes), lakes: (lk.features || []).map((f) => f.attributes), tmdl: (tm.features || []).map((f) => f.attributes) };
      basinCache.set(key, res);
    }
    return res;
  };
  return twoPhase(container, snapFn, liveFn, paint, "Impaired waters in basin");
}

// ---- MPCA contamination (What's In My Neighborhood, groundwater atlas, institutional controls, closed landfills) ----
const MPCA_CAT = { cleanup: "cleanup", waste: "tanks / hazardous waste", permit: "permitted facility" };
export async function renderMpcaAt(container, lon, lat) {
  container.innerHTML = "";
  try {
    const [sites, gw, gwl, ic, lf] = await Promise.all([snapNear("mpca-sites", lon, lat, 152), snapNear("mpca-gwconcern", lon, lat, 0), snapNear("mpca-gwline", lon, lat, 152), snapNear("mpca-ic", lon, lat, 0), snapNear("mpca-landfill", lon, lat, 0)]);
    const s = sites?.features || [], inside = [...(ic?.features || []).map((p) => ({ t: "Institutional control area (recorded land-use restriction)", d: `${p.ai_name || ""} · ${p.si_type_desc || ""}` })),
      ...(gw?.features || []).map((p) => ({ t: `Groundwater contamination ${p.kind || "area"}`, d: `${p.project_name || ""} · ${p.media_type || ""} · ${p.status || ""}` })),
      ...(lf?.features || []).map((p) => ({ t: "Closed landfill waste footprint", d: `${p.facilityname || ""} · ${p.status || ""}` }))];
    { const seen = new Set(); for (let i = inside.length - 1; i >= 0; i--) { const k = inside[i].t + inside[i].d; if (seen.has(k)) inside.splice(i, 1); else seen.add(k); } } // overlapping identical records
    const plume = (gwl?.features || [])[0];
    if (!s.length && !inside.length && !plume) return;
    container.innerHTML = `<h3>Contamination and regulated sites · MPCA</h3>
      ${inside.length ? `<div class="notice">${inside.map((x) => `<b>Inside ${escapeHtml(x.t)}</b>: ${escapeHtml(x.d)}`).join("<br>")}. Check the MPCA file before excavation, dewatering or wells.</div>` : ""}
      ${plume ? `<div class="notice">A mapped groundwater contamination boundary (${escapeHtml(plume.project_na || "")}, ${escapeHtml(plume.media_type || "")}) is ${fmtNum(plume.m * 3.281)} ft away.</div>` : ""}
      ${s.length ? `<table class="data"><thead><tr><th>MPCA site within 500 ft</th><th>Activity</th><th class="num">ft</th></tr></thead><tbody>${s.slice(0, 8).map((p) => `<tr><td>${p.url ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.name || "MPCA site")}</a>` : escapeHtml(p.name || "MPCA site")} <span class="small">${escapeHtml(MPCA_CAT[p.cat] || "")}${p.active === "N" ? ", inactive" : ""}${p.ic ? ", <b>institutional controls</b>" : ""}</span></td><td class="small">${escapeHtml(p.acts || "")}</td><td class="num">${fmtNum(p.m * 3.281)}</td></tr>`).join("")}</tbody></table>${s.length > 8 ? `<div class="small">${s.length - 8} more within 500 ft.</div>` : ""}` : `<div class="small">No MPCA sites within 500 ft.</div>`}
      <div class="small">MPCA What's In My Neighborhood, Groundwater Contamination Atlas, institutional controls and Closed Landfill Program, via MnGeo (snapshot ${escapeHtml(sites?.fetched || ic?.fetched || "")}); site names link to the MPCA record. Screening only: a Phase I environmental site assessment is the standard for due diligence.</div>`;
  } catch (e) { container.innerHTML = `<h3>Contamination · MPCA</h3><div class="notice">MPCA layers unavailable: ${escapeHtml(e.message)}</div>`; }
}

// ---- Easements ----
export function renderEasementsAt(container, lon, lat) {
  const paint = ({ r, b }, tag) => {
    if (!r.length && !b.length) { container.innerHTML = ""; return; }
    container.innerHTML = `<h3>Conservation easements at this point</h3>
      ${r.map((e) => `<div><b>BWSR ${escapeHtml(e.ease_cat || "RIM")} easement ${escapeHtml(e.ease_num || "")}</b> · ${escapeHtml(e.ease_type || "")}<div class="small">${fmt(e.ease_acres, 1)} ac · ${escapeHtml(e.swcd_name || "")} SWCD · signed ${escapeHtml(String(e.ease_year || ""))}${e.fund_type ? " · " + escapeHtml(e.fund_type) : ""} · status ${escapeHtml(e.exp_status || "")}${e.exp_date ? ", expires " + dateOf(e.exp_date) : ""}${e.recorded === "Y" ? " · recorded" + (e.rec_date ? " " + dateOf(e.rec_date) : "") : ""}</div></div>`).join("")}
      ${b.map((e) => `<div><b>Wetland bank easement ${escapeHtml(e.easement_number || e.easement_id || "")}</b> · site ${escapeHtml(String(e.siteid || ""))}<div class="small">${fmt(e.acres, 1)} ac · ${escapeHtml(e.county || "")} County${e.instrument_type ? " · " + escapeHtml(e.instrument_type) : ""}${e.recording_date ? " · recorded " + dateOf(e.recording_date) : ""}${e.description ? " · " + escapeHtml(e.description) : ""}</div></div>`).join("")}
      <div class="notice">Easement land carries use restrictions; any project inside the boundary needs BWSR (RIM) or the wetland bank sponsor's sign-off. Boundaries here are the recorded GIS versions; the recorded legal description governs.</div>` + asof(tag);
  };
  const snapFn = async () => {
    const [rim, bank] = await Promise.all([snapNear("rim", lon, lat, 30), snapNear("wetbank", lon, lat, 30)]);
    if (!rim && !bank) return null;
    return { r: { r: rim?.features || [], b: bank?.features || [] }, fetched: rim?.fetched || bank?.fetched };
  };
  const liveFn = async () => {
    const [rim, bank] = await Promise.all([
      q(EASE.rim, { ...near(lon, lat, 30), outFields: "ease_num,ease_type,ease_cat,fund_type,ease_acres,ease_year,exp_status,exp_date,swcd_name,recorded,rec_date" }),
      q(EASE.bank, { ...near(lon, lat, 30), outFields: "county,siteid,easement_number,acres,instrument_type,recording_date,description" }),
    ]);
    return { r: rim?.features?.map((f) => f.attributes) || [], b: bank?.features?.map((f) => f.attributes) || [] };
  };
  return twoPhase(container, snapFn, liveFn, paint, "Conservation easements");
}
