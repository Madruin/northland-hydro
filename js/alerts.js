// NWS active alerts for the region (issued by NWS Duluth or covering listed counties).
import { COUNTIES } from "./config.js";
import { activeAlerts } from "./api/nws.js";
import { $, escapeHtml, fmtDateTime } from "./util.js";

export let alerts = [];
const countyNames = COUNTIES.map((c) => c.name.replace(/ \(WI\)/, ""));

export async function loadAlerts() {
  const res = await Promise.allSettled([activeAlerts({ area: "MN" }), activeAlerts({ area: "WI" })]);
  const all = res.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const seen = new Set();
  alerts = all.filter((a) => {
    if (seen.has(a.id)) return false; seen.add(a.id);
    const dlh = /Duluth/i.test(a.sender || "");
    const county = countyNames.some((n) => new RegExp(`\\b${n}\\b`, "i").test(a.areas || ""));
    return dlh || county;
  }).sort((a, b) => sevRank(b.severity) - sevRank(a.severity));
  const btn = $("btn-alerts");
  $("alerts-count").textContent = alerts.length ? `${alerts.length} alert${alerts.length > 1 ? "s" : ""}` : "No alerts";
  btn.classList.toggle("hot", alerts.some((a) => ["Extreme", "Severe"].includes(a.severity)));
  return alerts;
}
function sevRank(s) { return { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 }[s] || 0; }

export function alertsHtml(list = alerts) {
  if (!list.length) return `<div class="notice">No active NWS alerts from the Duluth office or for TSA3 counties.</div>`;
  return list.map((a) => `<div class="alert ${(a.severity || "").toLowerCase()}">
      <div class="h">${escapeHtml(a.event)} <span class="small">· ${escapeHtml(a.sender)}</span></div>
      <div>${escapeHtml(a.headline || "")}</div>
      <div class="small">${escapeHtml(a.areas || "")}${a.ends ? ` · until ${fmtDateTime(a.ends)}` : ""}</div>
    </div>`).join("");
}
