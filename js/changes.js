// Recent changes: a one-time "What's new" note for returning visitors after an update, and the list in Help.
// Newest first; add an entry when a release changes something people will notice.
import { escapeHtml } from "./util.js";

export const CHANGES = [
  { date: "2026-10-06", items: [
    "Satellite layers from NASA (Layers menu): 30 m Landsat/Sentinel-2 imagery with a clear-scene date picker (also in Compare), daily satellite imagery for Lake Superior plumes and ice, snow cover, vegetation loss and fire detections.",
    "Climate and snowpack (Daymet) row in the Point panel: precipitation and temperature normals, typical peak snowpack and melt-out date.",
    "Watershed lines no longer zig-zag along the Lake Superior shore.",
    "Right-click (or long-press) the map for point info, a field point, coordinates or directions.",
    "Opening northland.eco without a link returns to your last view and layers; shared links now include satellite layers.",
    "Tidier on small screens: one-row header, tabs appear when they have content, shorter legend, menus scroll on short screens.",
    "Field notes: Take photo opens the camera, your initials can prefix point names (MV-P1).",
  ] },
  { date: "2026-10-05", items: [
    "Team field records: field notes and photos upload to a team project; partner agency staff can be given access per project; each project has a Field records page with a ZIP for the shared drive.",
    "New projects fill in the SWCD, county, coordinates and nearby stations and gauges from a tap on the map.",
    "Print site report: choose sections, simplified version, Word (.docx) download, scale bar on the map.",
  ] },
];

const SEEN = "nh-changes-seen";
export function changesHtml(n = CHANGES.length) {
  return CHANGES.slice(0, n).map((c) => `<h4>${new Date(c.date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</h4><ul class="changes">${c.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`).join("");
}
// Once per update, for people who have been here before (first-time visitors get the welcome dialog instead)
export function maybeShowWhatsNew(returning) {
  let seen = null; try { seen = localStorage.getItem(SEEN); localStorage.setItem(SEEN, CHANGES[0].date); } catch { return; }
  if (!returning || seen === CHANGES[0].date) return;
  const all = CHANGES.filter((c) => !seen || c.date > seen).flatMap((c) => c.items);
  const el = document.createElement("div"); el.id = "whats-new"; el.className = "floating"; el.setAttribute("role", "status");
  el.innerHTML = `<div class="wn-head"><b>What's new in Northland Eco</b><button class="wn-x" title="Dismiss" aria-label="Dismiss">✕</button></div><ul class="changes">${all.slice(0, 5).map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul><div class="small">${all.length > 5 ? `${all.length - 5} more changes are listed` : "The full list is"} in Help (?).</div>`;
  el.querySelector(".wn-x").onclick = () => el.remove();
  document.getElementById("map-wrap")?.append(el);
}
