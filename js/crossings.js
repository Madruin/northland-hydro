// Stream crossings: MN DNR Culvert Inventory Suite (stream crossing summary + culvert openings + bridge assessments)
// and the FHWA National Bridge Inventory (NTAD feature service) for MnDOT/county/township bridges and large culverts.
import { $, escapeHtml, fmt, fmtNum, debounce, haversineKm } from "./util.js";
import { map, setOverlay } from "./map.js";

const DNR = "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/struc_culvert_inventory_pub/FeatureServer";
const NBI = "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_National_Bridge_Inventory/FeatureServer/0";
export const MIN_ZOOM = 10;
const M2FT = 3.28084;

const NBI_KIND = { 1: "Concrete", 2: "Concrete continuous", 3: "Steel", 4: "Steel continuous", 5: "Prestressed concrete", 6: "Prestressed concrete continuous", 7: "Timber", 8: "Masonry", 9: "Aluminum / iron", 0: "Other" };
const NBI_TYPE = { "01": "Slab", "02": "Stringer / girder", "03": "Girder-floorbeam", "04": "Tee beam", "05": "Box beam (multiple)", "06": "Box beam (single)", "07": "Frame", "08": "Orthotropic", "09": "Deck truss", "10": "Through truss", "11": "Deck arch", "12": "Through arch", "13": "Suspension", "14": "Stayed girder", "15": "Lift", "16": "Bascule", "17": "Swing", "18": "Tunnel", "19": "Culvert", "20": "Mixed", "21": "Segmental box girder", "22": "Channel beam", "00": "Other" };
const NBI_OWNER = { "01": "MnDOT", "02": "County", "03": "Township", "04": "City", "11": "State park", "21": "Other state agency", "25": "Other local agency", "26": "Private", "27": "Railroad", "60": "Federal", "62": "BIA", "64": "USFS", "66": "NPS", "70": "USACE", "80": "Unknown" };
const COND = (c) => ({ 9: "Excellent", 8: "Very good", 7: "Good", 6: "Satisfactory", 5: "Fair", 4: "Poor", 3: "Serious", 2: "Critical", 1: "Imminent failure", 0: "Failed", N: "n/a" }[c] ?? c);
const SCOUR = (c) => ({ 3: "Scour critical", 4: "Stable, action needed", 5: "Stable, within footing limits", 6: "Not evaluated (no calculation)", 7: "Countermeasures installed", 8: "Stable, above footing", 9: "Dry land / foundation on rock", U: "Unknown foundation", T: "Tidal", N: "Not over waterway" }[c] ?? c);
const BC = { G: "Good", F: "Fair", P: "Poor" };

let enabled = false, lastKey = null, inflight = null;
export function initCrossings() { map.on("moveend", debounce(() => { if (enabled) refresh(); }, 350)); }
export function setCrossingsEnabled(on) { enabled = on; if (on) refresh(); else { setOverlay("xing-dnr", empty()); setOverlay("xing-nbi", empty()); lastKey = null; note(""); } }
const empty = () => ({ type: "FeatureCollection", features: [] });
function note(t) { const el = $("crossings-note"); if (el) el.textContent = t; }

async function qgeo(base, params) {
  const u = new URLSearchParams({ inSR: "4326", outSR: "4326", geometryPrecision: "6", f: "geojson", ...params });
  const r = await fetch(`${base}/query?${u}`); if (!r.ok) throw new Error(`${r.status}`);
  const d = await r.json(); if (d.error) throw new Error(d.error.message); return d;
}
const DNR_FIELDS = "crossing_id,crossing_type,stream_name,stream_kittle,road_path_or_railway_name,own_type,maint_name,county,year_built,crossing_condition,condition_issues,total_span,bankfull_width_ft,bankfull_estimate_confidence,fish_barrier_at_some_flows,fish_barrier_at_all_flows,primary_limiting_factor_for_pas,scour_pool,scour_pool_depth_ft,upstream_pool,upstream_deposition,bank_erosion_caused_by_crossing,crossing_properly_aligned,stream_stability_impact,priority,recommended_corrective_actions,field_date,survey_purpose,quantity,channel_gradient,floodprone_width_ft,inlet_bed_elevation,outlet_bed_elevation,headwater_surface_elevation,tailwater_surface_elevation,road_width_ft,notes_and_comments";
const NBI_FIELDS = "STRUCTURE_NUMBER_008,FACILITY_CARRIED_007,FEATURES_DESC_006A,YEAR_BUILT_027,YEAR_RECONSTRUCTED_106,STRUCTURE_KIND_043A,STRUCTURE_TYPE_043B,MAIN_UNIT_SPANS_045,STRUCTURE_LEN_MT_049,MAX_SPAN_LEN_MT_048,DECK_WIDTH_MT_052,DECK_COND_058,SUPERSTRUCTURE_COND_059,SUBSTRUCTURE_COND_060,CHANNEL_COND_061,CULVERT_COND_062,SCOUR_CRITICAL_113,WATERWAY_EVAL_071,OWNER_022,MAINTENANCE_021,BRIDGE_CONDITION,LOWEST_RATING,OPERATING_RATING_064,INVENTORY_RATING_066,POSTING_EVAL_070";

function decorateDnr(p) {
  const ratio = p.total_span && p.bankfull_width_ft ? p.total_span / p.bankfull_width_ft : null;
  const barrier = p.fish_barrier_at_all_flows === "Y" ? "barrier at all flows" : p.fish_barrier_at_some_flows === "Y" ? "barrier at some flows" : "passable";
  p.color = p.priority === "High" ? "#dc2626" : p.priority === "Medium" ? "#f59e0b" : ratio != null && ratio < 0.5 ? "#f59e0b" : "#16a34a";
  p.ratio = ratio;
  p.popup = `<div class="popup-title">${escapeHtml(p.crossing_type || "Crossing")} · ${escapeHtml(p.road_path_or_railway_name || "")}</div><div class="popup-sub">${escapeHtml(p.stream_name || "")} · span ${fmt(p.total_span, 1)} ft / bankfull ${fmt(p.bankfull_width_ft, 1)} ft${ratio != null ? ` (${fmt(100 * ratio, 0)}%)` : ""}</div><div class="popup-sub">${barrier}${p.priority ? " · priority " + escapeHtml(p.priority) : ""}${p.recommended_corrective_actions ? " · " + escapeHtml(p.recommended_corrective_actions) : ""} · DNR ${escapeHtml(p.crossing_id || "")}</div>`;
}
function decorateNbi(p) {
  const isCulvert = p.STRUCTURE_TYPE_043B === "19";
  p.color = p.BRIDGE_CONDITION === "P" ? "#dc2626" : p.BRIDGE_CONDITION === "F" ? "#f59e0b" : "#2563eb";
  p.popup = `<div class="popup-title">${isCulvert ? "Culvert" : "Bridge"} ${escapeHtml(p.STRUCTURE_NUMBER_008 || "")} · ${escapeHtml(p.FACILITY_CARRIED_007 || "")}</div><div class="popup-sub">over ${escapeHtml(p.FEATURES_DESC_006A || "")} · ${escapeHtml(NBI_KIND[p.STRUCTURE_KIND_043A] || "")} ${escapeHtml(NBI_TYPE[p.STRUCTURE_TYPE_043B] || "")} · built ${p.YEAR_BUILT_027 || "?"}${p.YEAR_RECONSTRUCTED_106 ? ", recon. " + p.YEAR_RECONSTRUCTED_106 : ""}</div><div class="popup-sub">length ${fmt(p.STRUCTURE_LEN_MT_049 * M2FT, 0)} ft · condition ${BC[p.BRIDGE_CONDITION] || p.BRIDGE_CONDITION || "?"} (lowest ${p.LOWEST_RATING ?? "?"}) · scour ${escapeHtml(SCOUR(p.SCOUR_CRITICAL_113))} · ${escapeHtml(NBI_OWNER[p.OWNER_022] || p.OWNER_022 || "")}</div>`;
}
async function refresh() {
  const z = map.getZoom(); const b = map.getBounds();
  if (z < MIN_ZOOM) { setOverlay("xing-dnr", empty()); setOverlay("xing-nbi", empty()); lastKey = null; note(`Crossings: zoom in (${MIN_ZOOM}+) to load`); return; }
  const pad = 0.15;
  const bbox = [b.getWest() - (b.getEast() - b.getWest()) * pad, b.getSouth() - (b.getNorth() - b.getSouth()) * pad, b.getEast() + (b.getEast() - b.getWest()) * pad, b.getNorth() + (b.getNorth() - b.getSouth()) * pad];
  const key = bbox.map((v) => v.toFixed(3)).join(","); if (key === lastKey) return; lastKey = key;
  note("Crossings: loading…");
  const env = { geometry: bbox.map((v) => v.toFixed(5)).join(","), geometryType: "esriGeometryEnvelope", spatialRel: "esriSpatialRelIntersects", resultRecordCount: "2000" };
  const mine = (inflight = Promise.allSettled([qgeo(`${DNR}/0`, { ...env, outFields: DNR_FIELDS }), qgeo(NBI, { ...env, outFields: NBI_FIELDS })]));
  const [dr, nr] = await mine; if (inflight !== mine || !enabled) return;
  let nd = 0, nn = 0; const errs = [];
  if (dr.status === "fulfilled") { for (const f of dr.value.features) decorateDnr(f.properties); setOverlay("xing-dnr", dr.value); nd = dr.value.features.length; } else errs.push("DNR " + dr.reason?.message);
  if (nr.status === "fulfilled") { for (const f of nr.value.features) decorateNbi(f.properties); setOverlay("xing-nbi", nr.value); nn = nr.value.features.length; } else errs.push("NBI " + nr.reason?.message);
  note(`Crossings: ${nd} DNR-surveyed, ${nn} NBI structures${errs.length ? " · failed: " + errs.join("; ") : ""}`);
}

export function crossingsLegendHtml() {
  return `<h4>Stream crossings</h4>
    <div class="legend-row"><span class="swatch" style="background:#16a34a"></span>DNR culvert survey (green ok · <span style="color:#f59e0b">amber</span> medium priority or span &lt; ½ bankfull · <span style="color:#dc2626">red</span> high priority)</div>
    <div class="legend-row"><span class="swatch sq" style="background:#2563eb;transform:rotate(45deg);width:10px;height:10px"></span>NBI bridge / large culvert (blue good · amber fair · red poor)</div>
    <div class="small">MN DNR Culvert Inventory Suite (stream-crossing surveys with bankfull comparison, passage, scour) and FHWA National Bridge Inventory (MnDOT, county, township structures over 20 ft). Loads at zoom ${MIN_ZOOM}+. <span id="crossings-note"></span></div>`;
}

// ---- Point panel section: nearest DNR crossing (within 80 m) with openings + bridge assessment, and nearest NBI structure (within 80 m) ----
export async function renderCrossingAt(container, lon, lat) {
  container.innerHTML = "";
  const near = (m) => { const d = m / 111320; return { geometry: `${(lon - d / Math.cos((lat * Math.PI) / 180)).toFixed(6)},${(lat - d).toFixed(6)},${(lon + d / Math.cos((lat * Math.PI) / 180)).toFixed(6)},${(lat + d).toFixed(6)}`, geometryType: "esriGeometryEnvelope", spatialRel: "esriSpatialRelIntersects" }; };
  try {
    const [dr, nr] = await Promise.all([qgeo(`${DNR}/0`, { ...near(80), outFields: DNR_FIELDS }).catch(() => null), qgeo(NBI, { ...near(80), outFields: NBI_FIELDS }).catch(() => null)]);
    const dist = (f) => haversineKm(lat, lon, f.geometry.coordinates[1], f.geometry.coordinates[0]) * 1000;
    const dnr = (dr?.features || []).sort((a, b) => dist(a) - dist(b))[0];
    const nbi = (nr?.features || []).sort((a, b) => dist(a) - dist(b))[0];
    if (!dnr && !nbi) return;
    let html = `<h3>Stream crossing at this point</h3>`;
    if (dnr) {
      const p = dnr.properties; const ratio = p.total_span && p.bankfull_width_ft ? p.total_span / p.bankfull_width_ft : null;
      let openings = [], bridge = null;
      try { const o = await qgeo(`${DNR}/1`, { where: `crossing_id='${p.crossing_id}'`, outFields: "pipe_id,opening_end,opening_shape,opening_material,size_span,size_rise,length,inlet_type,outlet_type,outlet_drop_ft,inlet_invert_elevation,outlet_invert_elevation,pct_plugged,substrate,substrate_depth_ft,water_depth_ft,culvert_condition,condition_issues,flow_restriction,flow_restriction_type,maximum_velocity_fps,notes_and_comments", returnGeometry: "false" }); openings = (o.features || []).map((f) => f.properties); } catch {}
      if (/bridge/i.test(p.crossing_type || "")) { try { const b = await qgeo(`${DNR}/2`, { where: `crossing_id='${p.crossing_id}'`, outFields: "length,size_rise,water_depth_ft,bridge_condition,condition_issues,notes_and_comments,field_date,maximum_velocity_fps", returnGeometry: "false" }); bridge = (b.features || [])[0]?.properties || null; } catch {} }
      const flags = [["Fish barrier at all flows", p.fish_barrier_at_all_flows], ["Barrier at some flows", p.fish_barrier_at_some_flows], ["Scour pool", p.scour_pool], ["Upstream pool", p.upstream_pool], ["Upstream deposition", p.upstream_deposition], ["Bank erosion caused by crossing", p.bank_erosion_caused_by_crossing], ["Stream stability impact", p.stream_stability_impact]].filter(([, v]) => v === "Y").map(([k]) => k);
      html += `<div><b>${escapeHtml(p.crossing_type || "Crossing")}</b> · ${escapeHtml(p.road_path_or_railway_name || "")} over ${escapeHtml(p.stream_name || "unnamed stream")} <span class="small">· DNR ${escapeHtml(p.crossing_id || "")} · ${escapeHtml(p.stream_kittle || "")} · ${fmtNum(dist(dnr) * 3.281)} ft from click</span></div>
        <div class="stat-row">
          <div class="stat ${ratio != null && ratio < 0.5 ? "bad" : ratio != null && ratio < 0.8 ? "warn" : ""}"><div class="v">${fmt(p.total_span, 1)}</div><div class="l">total span, ft</div><div class="s">bankfull ${fmt(p.bankfull_width_ft, 1)} ft${ratio != null ? ` · ${fmt(100 * ratio, 0)}% of bankfull` : ""}${p.bankfull_estimate_confidence ? ` (${escapeHtml(p.bankfull_estimate_confidence.toLowerCase())} confidence)` : ""}</div></div>
          <div class="stat ${p.priority === "High" ? "bad" : p.priority === "Medium" ? "warn" : ""}"><div class="v" style="font-size:15px">${escapeHtml(p.priority || "–")}</div><div class="l">DNR priority</div><div class="s">${escapeHtml(p.crossing_condition || "")}${p.crossing_properly_aligned === "N" ? " · misaligned" : ""}</div></div>
          <div class="stat"><div class="v" style="font-size:15px">${p.fish_barrier_at_all_flows === "Y" ? "Barrier" : p.fish_barrier_at_some_flows === "Y" ? "Partial" : "Passable"}</div><div class="l">fish passage</div><div class="s">${escapeHtml(p.primary_limiting_factor_for_pas || "")}</div></div>
        </div>
        ${flags.length ? `<div class="small">Observed: ${flags.join("; ")}${p.scour_pool_depth_ft ? ` · scour pool ${fmt(p.scour_pool_depth_ft, 1)} ft deep` : ""}.</div>` : ""}
        ${p.recommended_corrective_actions ? `<div class="notice"><b>DNR recommended action:</b> ${escapeHtml(p.recommended_corrective_actions)}</div>` : ""}
        ${openings.length ? `<table class="data"><thead><tr><th>Opening</th><th>Shape / material</th><th class="num">Span ft</th><th class="num">Rise ft</th><th class="num">Length ft</th><th>Inlet / outlet</th><th class="num">Outlet drop ft</th><th>Condition</th></tr></thead><tbody>
          ${openings.map((o) => `<tr><td>${escapeHtml(o.pipe_id || "")} ${escapeHtml(o.opening_end || "")}${o.pct_plugged ? `<div class="small">${o.pct_plugged}% plugged</div>` : ""}</td><td>${escapeHtml(o.opening_shape || "")}<div class="small">${escapeHtml(o.opening_material || "")}</div></td><td class="num">${fmt(o.size_span, 1)}</td><td class="num">${fmt(o.size_rise, 1)}</td><td class="num">${fmt(o.length, 0)}</td><td class="small">${escapeHtml(o.inlet_type || "")} / ${escapeHtml(o.outlet_type || "")}${o.substrate === "Y" ? "<br>substrate present" : ""}</td><td class="num">${o.outlet_drop_ft != null ? fmt(o.outlet_drop_ft, 1) : "–"}</td><td>${escapeHtml(o.culvert_condition || "")}<div class="small">${escapeHtml(o.condition_issues || "")}</div></td></tr>`).join("")}</tbody></table>` : ""}
        ${bridge ? `<div class="small">Bridge assessment: ${[bridge.length ? `length ${fmt(bridge.length, 0)} ft` : "", bridge.size_rise ? `rise ${fmt(bridge.size_rise, 1)} ft` : "", bridge.water_depth_ft ? `water depth ${fmt(bridge.water_depth_ft, 1)} ft` : "", bridge.bridge_condition ? `condition ${escapeHtml(bridge.bridge_condition)}` : "", bridge.condition_issues ? escapeHtml(bridge.condition_issues) : "", bridge.notes_and_comments ? escapeHtml(bridge.notes_and_comments) : ""].filter(Boolean).join(" · ")}</div>` : ""}
        <div class="small">${[p.inlet_bed_elevation != null ? `inlet bed ${fmt(p.inlet_bed_elevation, 2)} / outlet bed ${fmt(p.outlet_bed_elevation, 2)} (survey datum)` : "", p.channel_gradient != null ? `channel gradient ${fmt(100 * p.channel_gradient, 2)}%` : "", p.floodprone_width_ft ? `flood-prone width ${fmt(p.floodprone_width_ft, 0)} ft` : "", p.road_width_ft ? `road width ${fmt(p.road_width_ft, 0)} ft` : "", `surveyed ${p.field_date ? new Date(p.field_date).toLocaleDateString() : "date unknown"}${p.survey_purpose ? " (" + escapeHtml(p.survey_purpose) + ")" : ""}`, p.own_type || p.maint_name ? `owner ${escapeHtml(p.own_type || p.maint_name)}` : "", p.year_built ? `built ${p.year_built}` : "", p.notes_and_comments ? escapeHtml(p.notes_and_comments) : ""].filter(Boolean).join(" · ")}. Source: MN DNR Culvert Inventory Suite.</div>`;
    }
    if (nbi) {
      const p = nbi.properties; const isCulvert = p.STRUCTURE_TYPE_043B === "19";
      html += `<div style="margin-top:10px"><b>NBI ${isCulvert ? "culvert" : "bridge"} ${escapeHtml(p.STRUCTURE_NUMBER_008 || "")}</b> · ${escapeHtml(p.FACILITY_CARRIED_007 || "")} over ${escapeHtml(p.FEATURES_DESC_006A || "")} <span class="small">· ${fmtNum(dist(nbi) * 3.281)} ft from click</span></div>
        <table class="data"><tbody>
          <tr><td class="small">Structure</td><td>${escapeHtml(NBI_KIND[p.STRUCTURE_KIND_043A] || "")} ${escapeHtml(NBI_TYPE[p.STRUCTURE_TYPE_043B] || "")}, ${p.MAIN_UNIT_SPANS_045 || "?"} span(s), built ${p.YEAR_BUILT_027 || "?"}${p.YEAR_RECONSTRUCTED_106 ? `, reconstructed ${p.YEAR_RECONSTRUCTED_106}` : ""}</td></tr>
          <tr><td class="small">Dimensions</td><td>length ${fmt(p.STRUCTURE_LEN_MT_049 * M2FT, 1)} ft · max span ${fmt(p.MAX_SPAN_LEN_MT_048 * M2FT, 1)} ft · deck width ${fmt(p.DECK_WIDTH_MT_052 * M2FT, 1)} ft</td></tr>
          <tr><td class="small">Condition</td><td>overall <b>${BC[p.BRIDGE_CONDITION] || p.BRIDGE_CONDITION || "?"}</b> (lowest rating ${p.LOWEST_RATING ?? "?"}) · deck ${COND(p.DECK_COND_058)} · superstructure ${COND(p.SUPERSTRUCTURE_COND_059)} · substructure ${COND(p.SUBSTRUCTURE_COND_060)}${isCulvert ? ` · culvert ${COND(p.CULVERT_COND_062)}` : ""}</td></tr>
          <tr><td class="small">Waterway</td><td>channel ${COND(p.CHANNEL_COND_061)} · scour: ${escapeHtml(SCOUR(p.SCOUR_CRITICAL_113))} · waterway adequacy ${p.WATERWAY_EVAL_071 ?? "?"}</td></tr>
          <tr><td class="small">Owner / maint.</td><td>${escapeHtml(NBI_OWNER[p.OWNER_022] || p.OWNER_022 || "?")} / ${escapeHtml(NBI_OWNER[p.MAINTENANCE_021] || p.MAINTENANCE_021 || "?")}${p.OPERATING_RATING_064 ? ` · operating rating ${p.OPERATING_RATING_064} t, inventory ${p.INVENTORY_RATING_066} t` : ""}${p.POSTING_EVAL_070 != null ? ` · posting ${p.POSTING_EVAL_070}` : ""}</td></tr>
        </tbody></table>
        <div class="small">FHWA National Bridge Inventory (structures over 20 ft, inspected on a 24-month cycle). Ratings 0–9; 4 or less is poor. Metric fields converted to feet.</div>`;
    }
    container.innerHTML = html;
  } catch (e) { console.warn("crossings lookup failed", e); }
}
