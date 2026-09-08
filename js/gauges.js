// Stream-gauge layer: USGS instantaneous values merged with the MN DNR/MPCA CSG feed.
import { REGION_BBOX, FLOW_CLASSES } from "./config.js";
import { latestInBbox } from "./api/usgs.js";
import { loadCsgSites, flowClassInfo } from "./api/dnr.js";
import { setGauges } from "./map.js";
import { escapeHtml, fmtNum, fmt, ago, emit } from "./util.js";

export let gauges = [];   // merged list

export async function loadGauges() {
  if (!gauges.length) { try { const c = JSON.parse(localStorage.getItem("nh-gauges") || "null"); if (c && Date.now() - c.t < 3 * 86400e3) { gauges = c.gauges; setGauges(toFeatureCollection(gauges)); emit("gauges:loaded", { gauges, stale: true }); } } catch {} }
  const [usgsRes, dnrRes] = await Promise.allSettled([latestInBbox(REGION_BBOX), loadCsgSites(REGION_BBOX)]);
  const usgs = usgsRes.status === "fulfilled" ? usgsRes.value : {};
  const dnr = dnrRes.status === "fulfilled" ? dnrRes.value : [];
  if (usgsRes.status === "rejected") console.warn("USGS failed", usgsRes.reason);
  if (dnrRes.status === "rejected") console.warn("DNR failed", dnrRes.reason);

  const merged = new Map();
  for (const d of dnr) {
    const u = d.usgs_id ? usgs[d.usgs_id] : null;
    const g = {
      id: d.usgs_id ? `USGS-${d.usgs_id}` : `DNR-${d.site_id}`, dnr_id: d.site_id, usgs_id: d.usgs_id, name: d.name,
      lat: d.lat, lon: d.lon, providers: d.providers, tags: d.tags, telemetry: d.telemetry, flowClass: d.flowClass,
      flow: u?.values.discharge?.value ?? d.flow, flowTime: u?.values.discharge?.time ?? (d.flowTime ? d.flowTime.replace(" ", "T") : null),
      stage: u?.values.stage?.value ?? d.stage, stageTime: u?.values.stage?.time ?? (d.stageTime ? d.stageTime.replace(" ", "T") : null),
      source: u ? "USGS + MN DNR" : "MN DNR/MPCA", telRange: d.telRange, arcRange: d.arcRange,
    };
    merged.set(g.id, g);
  }
  for (const [no, u] of Object.entries(usgs)) {
    const id = `USGS-${no}`;
    if (merged.has(id)) continue;
    merged.set(id, { id, usgs_id: no, dnr_id: null, name: titleCase(u.name), lat: u.lat, lon: u.lon, providers: ["USGS"], tags: ["Telemetry"], telemetry: true,
      flowClass: 0, flow: u.values.discharge?.value ?? null, flowTime: u.values.discharge?.time, stage: u.values.stage?.value ?? null, stageTime: u.values.stage?.time, source: "USGS" });
  }
  gauges = [...merged.values()].map((g) => ({ ...g, color: flowClassInfo(g.flowClass).color, stale: isStale(g) }));
  try { localStorage.setItem("nh-gauges", JSON.stringify({ t: Date.now(), gauges })); } catch {}
  setGauges(toFeatureCollection(gauges));
  emit("gauges:loaded", { gauges });
  return gauges;
}

function isStale(g) {
  const t = g.flowTime || g.stageTime;
  if (!t) return true;
  return Date.now() - new Date(t).getTime() > 3 * 86400e3;
}
function titleCase(s) { return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bMn\b/g, "MN").replace(/\bWi\b/g, "WI").replace(/\bNr\b/g, "nr").replace(/\bAt\b/g, "at").replace(/\bNear\b/g, "near"); }

function toFeatureCollection(list) {
  return { type: "FeatureCollection", features: list.map((g) => ({
    type: "Feature", geometry: { type: "Point", coordinates: [g.lon, g.lat] },
    properties: { kind: "gauge", id: g.id, name: g.name, color: g.stale ? "#6b7280" : g.color, flowClass: g.flowClass, popup: popupHtml(g) } })) };
}
function popupHtml(g) {
  const cls = flowClassInfo(g.flowClass);
  return `<div class="popup-title">${escapeHtml(g.name)}</div>
    <div><span class="popup-big">${g.flow != null ? fmtNum(g.flow, g.flow < 10 ? 2 : 0) + " cfs" : "–"}</span> ${g.stage != null ? `<span class="popup-sub">stage ${fmt(g.stage)} ft</span>` : ""}</div>
    <div class="popup-sub">${g.flowClass ? `<span class="pill class" style="background:${cls.color}">${cls.label}</span>` : ""}${g.flowTime ? ago(g.flowTime) : "no recent data"} · ${escapeHtml(g.source)}</div>`;
}

export let hideUnclassified = false;
export function setHideUnclassified(v) { hideUnclassified = v; }
export function renderGaugeLegend(container) {
  const rows = FLOW_CLASSES.slice(1).concat(FLOW_CLASSES[0]).map((c) => `<div class="legend-row"><span class="swatch sq" style="background:${c.color}"></span>${c.label}</div>`).join("");
  container.insertAdjacentHTML("beforeend", `<h4>Gauge flow vs. period of record</h4>${rows}<div class="legend-row"><span class="swatch sq" style="background:#6b7280"></span>Stale (&gt;3 days)</div><div class="small">Classes from MN DNR CSG percentiles for this date; unclassified = no percentile record.</div><label class="legend-toggle-row"><input type="checkbox" id="lg-hide-unclassified" ${hideUnclassified ? "checked" : ""}/> hide unclassified gauges</label>`);
}

export function gaugeById(id) { return gauges.find((g) => g.id === id); }
