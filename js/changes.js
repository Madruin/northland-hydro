// Changelog: a one-time "What's new" note for returning visitors after an update, "Recent changes" at the top of
// Help, and the full record in Help's Changelog tab. Newest first; add an entry when a release changes something
// people will notice (plain language, what changed for the person using the site).
import { escapeHtml } from "./util.js";

export const CHANGES = [
  { date: "2026-10-06", items: [
    "Watershed lines no longer zig-zag along the Lake Superior shore (USGS's sawtooth shoreline strip is left out of the drawing).",
    "Right-click (or long-press) the map for point info, a field point, coordinates or directions.",
    "Opening northland.eco without a link returns to your last view and layers; shared links now include satellite layers.",
    "\"What's new\" note after updates, this changelog, and a Report a problem link in the footer.",
    "Layers menu: filter box, \"n on\" counts per group, Turn all off; keyboard shortcuts (L, /, ?, arrows, Esc).",
    "Tidier on small screens: one-row header down to ~1000 px, tabs appear when they have content, two-column rain legend, map credits folded.",
    "Field notes: your initials can prefix point names (MV-P1); offline notice when the phone loses signal.",
  ] },
  { date: "2026-10-05", items: [
    "Satellite layers from NASA (Layers menu): 30 m Landsat/Sentinel-2 imagery with a clear-scene date picker (also in Compare), daily satellite imagery, snow cover, vegetation loss and fire detections.",
    "Climate and snowpack (Daymet) row in the Point panel: precipitation and temperature normals, typical peak snowpack and melt-out date, wettest days on record.",
    "Team field records: field notes and photos upload to a team project; partner agency staff can be given access per project; each project has a Field records page with a ZIP for the shared drive.",
    "Field notes: Take photo opens the camera and asks for a name and note.",
    "New projects fill in the SWCD, county, coordinates and nearby stations and gauges from a tap on the map; SWCD is a list (North and South St. Louis separate). Construction projects are flagged after more than 0.5\" of rain.",
    "Print site report: choose sections and the map extent, a simplified one-table version, Word (.docx) download, and a scale bar on report maps.",
    "Basin soils are component-weighted (e.g. 55% D, 25% B/D) instead of the dominant soil per map unit.",
    "Site in development notice with version and last-updated date; Northland Eco presented as an independent project.",
    "Password boxes have a show/hide eye; menus scroll on short screens.",
    "Hosting moved to Railway, with the data refresh jobs running there.",
  ] },
  { date: "2026-09-29", items: [
    "Point panel rebuilt as fixed, grouped rows with one-line answers in each header; Delineate from here is a button in the Watershed row.",
    "FEMA flood zones and other regional layers draw from vector tiles: precise at every zoom with no flicker between overview and detail.",
    "Runoff and curve number get their own row; the FEMA row names the zone at the point; crossings read \"No mapped crossing within 260 ft\".",
    "Partner-readiness fixes; the search box no longer offers saved passwords; the Region tab is never blank; footer logo easter egg.",
  ] },
  { date: "2026-09-25", items: [
    "Field notes: averaged GPS points, walked route tracks and geotagged photos (Solocator direction included), saved on the device, with exports to Google Earth, GPX, CSV and Civil 3D.",
  ] },
  { date: "2026-09-24", items: [
    "Contamination layer and Point panel section (MPCA sites, groundwater plumes, land-use restrictions, closed landfills).",
    "Rain stations, stream gauges and radar moved into the Layers menu.",
  ] },
  { date: "2026-09-23", items: [
    "Watershed (HUC-8/10/12) boundaries; NLCD land cover with the runoff curve number; FWS wetland raster when zoomed out.",
    "Listed species from USFWS IPaC in every Point panel; MSE3 unit-hydrograph design-storm peaks.",
    "Trails layer (DNR, Superior National Forest, OpenStreetMap); crossings shown region-wide at every zoom.",
    "Clicks work while data is still loading; a round of fixes from a site-wide audit.",
  ] },
  { date: "2026-09-17", items: [
    "Public waters (PWI), impaired waters and TMDLs, conservation easements and DNR observation wells, with point and basin sections.",
    "Imagery compare (swipe between years) and TR-55 design-storm runoff in the watershed section.",
    "Search finds tax parcels by PIN or owner in all eight counties.",
    "Data freshness panel, point ground elevation and a lidar profile tool; live radar reflectivity option.",
    "Regional layers load instantly from monthly snapshots and show a whole-area overview when zoomed out; layer loading and failure feedback.",
  ] },
  { date: "2026-09-14", items: [
    "Pine County parcels and WLSSD rain gauges.",
    "Collapsible legend; loading text joins the status pill; the control strip scrolls on narrow windows; measure tool Finish/Clear buttons.",
  ] },
  { date: "2026-09-11", items: [
    "Renamed Northland Eco, with a new logo; moved to northland.eco.",
    "Layers for trout streams, karst, wetlands, FEMA flood hazard, crossings (DNR culverts and NBI bridges) and wells and borings.",
    "Basin-wide soil groups with composite curve number after delineation.",
    "Locate me, measure, coordinates in and out, panel history (Back), glossary tooltips, recent points, Sources & methods in Help.",
    "High-resolution imagery basemaps from MnGeo, back to 1991.",
  ] },
  { date: "2026-09-10", items: [
    "Watershed delineation reaches the pour point; snap to the StreamStats stream grid.",
    "Phone layout with a bottom-sheet panel.",
    "Soils (SSURGO hydrologic groups), county parcels and DNR lake levels (LakeFinder).",
  ] },
  { date: "2026-09-08", items: [
    "First release as Northland Hydro: rainfall stations, stream gauges, NWS forecast, Lake Superior, StreamStats watersheds and TSA3 regional curves for NE Minnesota.",
    "Team project watch list with sign-in; saved watershed analyses; printable site hydrology report.",
    "Terrain menu (MnTOPO lidar hillshade, DEM, contours) and CAD export (imagery, DEM, contours in UTM 15N US ft).",
  ] },
];

const SEEN = "nh-changes-seen";
const day = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const block = (c) => `<h4>${day(c.date)}</h4><ul class="changes">${c.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
// The latest few releases, for the top of Help
export function changesHtml(n = 2) { return CHANGES.slice(0, n).map(block).join(""); }
// Everything, for Help's Changelog tab
export function changelogHtml() {
  return `<h2>Changelog</h2><div class="small">Every change people would notice, newest first, since the first release on ${day(CHANGES[CHANGES.length - 1].date)}. Problems or ideas: the <b>Report a problem</b> link in the footer.</div>${CHANGES.map(block).join("")}`;
}
// Once per update, for people who have been here before (first-time visitors get the welcome dialog instead)
export function maybeShowWhatsNew(returning, openChangelog) {
  let seen = null; try { seen = localStorage.getItem(SEEN); localStorage.setItem(SEEN, CHANGES[0].date); } catch { return; }
  if (!returning || seen === CHANGES[0].date) return;
  const all = CHANGES.filter((c) => !seen || c.date > seen).flatMap((c) => c.items);
  const el = document.createElement("div"); el.id = "whats-new"; el.className = "floating"; el.setAttribute("role", "status");
  el.innerHTML = `<div class="wn-head"><b>What's new in Northland Eco</b><button class="wn-x" title="Dismiss" aria-label="Dismiss">✕</button></div><ul class="changes">${all.slice(0, 5).map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul><div class="small">${all.length > 5 ? `${all.length - 5} more · ` : ""}<button type="button" class="linkbtn wn-all">Full changelog</button></div>`;
  el.querySelector(".wn-x").onclick = () => el.remove();
  el.querySelector(".wn-all").onclick = () => { el.remove(); openChangelog?.(); };
  document.getElementById("map-wrap")?.append(el);
}
