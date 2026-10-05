// Site report options, in the spirit of StreamStats' report builder: choose the map for the first page (the whole
// delineated watershed by default, or the current map view) and which sections to include. Both map images are
// captured while the dialog is open, because the map stops drawing once the report tab takes focus; the report tab
// itself is opened inside the "Build report" click so browsers don't treat it as a pop-up.
import { $, escapeHtml } from "./util.js";
import { map, snapshot, drawBasin } from "./map.js";

export const REPORT_GROUPS = [
  ["Overview", [["keynums", "Key numbers (rain, drainage area, 100-yr peak, bankfull width)"]]],
  ["Site conditions at the point", [["pt-fema", "FEMA flood zone"], ["pt-pwi", "Public waters (PWI)"], ["pt-wetland", "Wetlands (NWI)"], ["pt-impaired", "Impaired waters and TMDLs"], ["pt-lake", "Lake or river"], ["pt-crossing", "Stream crossing"], ["pt-species", "Listed species (USFWS IPaC)"], ["pt-mpca", "Contamination (MPCA)"], ["pt-easement", "Conservation easements"], ["pt-parcel", "Parcel"], ["pt-soils", "Soils"], ["pt-wells", "Wells and depth to bedrock"]]],
  ["Watershed and channel", [["ws-summary", "Drainage area and basin characteristics"], ["ws-flows", "Peak-flow statistics (StreamStats regression)"], ["ws-runoff", "Runoff and curve number (design-storm peaks)"], ["ws-basinsoils", "Basin soils (hydrologic soil groups)"], ["ws-bedrock", "Basin depth to bedrock"], ["ws-impaired", "Impaired waters in the basin"], ["regional", "Bankfull dimensions (TSA3 regional curve)"], ["regional-others", "Other regional curves, for comparison"]]],
  ["Rain and weather", [["rain-stations", "Observed rainfall at nearby stations"], ["rain-prism", "Gridded rainfall at the point (PRISM)"], ["gauges", "Nearby stream gauges"], ["forecast", "NWS forecast and alerts"], ["atlas14", "Design storms (NOAA Atlas 14)"]]],
  ["Back matter", [["sources", "Sources and methods"]]],
];
const PRESETS = {
  partner: ["keynums", "pt-fema", "pt-pwi", "pt-wetland", "pt-impaired", "pt-lake", "pt-species", "pt-mpca", "pt-easement", "pt-parcel", "sources"],
  engineering: ["keynums", "pt-fema", "pt-pwi", "pt-wetland", "pt-impaired", "pt-lake", "pt-crossing", "pt-soils", "pt-wells", "ws-summary", "ws-flows", "ws-runoff", "ws-basinsoils", "regional", "rain-prism", "atlas14", "sources"],
};
PRESETS.everything = REPORT_GROUPS.flatMap(([, items]) => items.map(([id]) => id));
const KEY = "nh-report-opts";
const GROUP_NOTE = { "Site conditions at the point": "Open this point in the Point panel to include its site conditions.", "Watershed and channel": "Delineate the watershed (Point panel) to add watershed sections." };

// Which sections have something to print for this point
function availability(ws, lon, lat) {
  const tab = document.getElementById("tab-point");
  const ptOpen = !!tab && tab.dataset.pt === `${lon.toFixed(5)},${lat.toFixed(5)}`;
  const filled = (el) => !!el && el.textContent.trim() && !el.querySelector(".spinner") && !el.querySelector("[data-empty]");
  const avail = {};
  for (const [, items] of REPORT_GROUPS) for (const [id] of items) {
    if (id.startsWith("pt-")) avail[id] = ptOpen && filled(document.getElementById(id));
    else if (id === "ws-summary") avail[id] = !!ws && !ws.manual;
    else if (id === "ws-flows") avail[id] = !!ws?.flows;
    else if (id.startsWith("ws-")) avail[id] = ptOpen && filled(tab.querySelector("." + id));
    else if (id === "regional" || id === "regional-others") avail[id] = !!ws?.da;
    else avail[id] = true;
  }
  return avail;
}
const bboxOf = (g) => { let w = 180, s = 90, e = -180, n = -90; const walk = (c) => { if (typeof c[0] === "number") { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); } else c.forEach(walk); }; walk(g.coordinates); return [[w, s], [e, n]]; };
const idle = (ms = 8000) => new Promise((r) => { const t = setTimeout(r, ms); map.once("idle", () => { clearTimeout(t); r(); }); });

export function chooseReportOptions({ lon, lat, ws }) {
  return new Promise((resolve) => {
    const avail = availability(ws, lon, lat);
    const basin = ws?.basin && !ws.manual ? ws.basin : null;
    let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {}
    let chosen = new Set(saved?.include || PRESETS.engineering);
    const shots = { view: null, watershed: null }; let ready = false;
    const box = document.createElement("div");
    box.className = "modal"; box.id = "rpt-modal"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Site report options");
    box.innerHTML = `<div class="modal-box rpt-box">
      <div class="modal-head"><b>Site report</b><button type="button" id="rpt-x" title="Cancel">✕</button></div>
      <div class="modal-body">
        <h4>Report type</h4>
        <div class="rpt-style">
          <label><input type="radio" name="rpt-style" value="detailed"> <span><b>Detailed</b> · choose the sections below; tables, sources and methods for engineers and agencies</span></label>
          <label><input type="radio" name="rpt-style" value="simple" ${ws?.da && !ws.manual ? "" : "disabled"}> <span><b>Simplified</b> · one page: site facts, the watershed map, and a table of drainage area, 100-year peak flow, bankfull width, soil group and basin slope with their sources${ws?.da && !ws.manual ? "" : ` <span class="small">(delineate the watershed first)</span>`}</span></label>
        </div>
        <h4>Map on the first page</h4>
        <div class="rpt-map">
          <div class="rpt-map-opts">
            <label><input type="radio" name="rpt-map" value="watershed" ${basin ? "checked" : "disabled"}> Whole delineated watershed</label>
            <label><input type="radio" name="rpt-map" value="view" ${basin ? "" : "checked"}> Current map view</label>
            ${basin ? "" : `<div class="small">Delineate the watershed in the Point panel to map the whole basin.</div>`}
          </div>
          <div class="rpt-prev"><img id="rpt-img" alt="Map preview" hidden><span id="rpt-prep" class="small">Preparing the map…</span></div>
        </div>
        <div id="rpt-detail">
        <h4>Include</h4>
        <div class="rpt-presets">Presets: <button type="button" class="chip" data-p="partner" title="Plain-language site summary for partners and landowners">Partner summary</button> <button type="button" class="chip" data-p="engineering">Engineering</button> <button type="button" class="chip" data-p="everything">Everything</button> <button type="button" class="chip" data-p="none">None</button></div>
        <div class="rpt-groups">${REPORT_GROUPS.map(([g, items]) => { const ok = items.filter(([id]) => avail[id]);
          return `<fieldset class="rpt-group"><legend>${escapeHtml(g)}</legend>${ok.length ? ok.map(([id, label]) => `<label><input type="checkbox" value="${id}"> ${escapeHtml(label)}</label>`).join("") : `<div class="small">${escapeHtml(GROUP_NOTE[g] || "Nothing available here.")}</div>`}</fieldset>`; }).join("")}</div>
        </div>
      </div>
      <div class="rpt-foot"><span id="rpt-msg" class="small"></span><button type="button" class="btn" id="rpt-cancel">Cancel</button><button type="button" class="btn primary" id="rpt-go" disabled>Build report</button></div>
    </div>`;
    document.body.append(box);
    const boxes = [...box.querySelectorAll('input[type="checkbox"]')];
    const sync = () => boxes.forEach((b) => (b.checked = chosen.has(b.value)));
    const read = () => { chosen = new Set(boxes.filter((b) => b.checked).map((b) => b.value)); };
    const mode = () => box.querySelector('input[name="rpt-map"]:checked')?.value || "view";
    const style = () => box.querySelector('input[name="rpt-style"]:checked')?.value || "detailed";
    const canSimple = !!(ws?.da && !ws.manual);
    box.querySelector(`input[name="rpt-style"][value="${saved?.style === "simple" && canSimple ? "simple" : "detailed"}"]`).checked = true;
    const showStyle = () => { $("rpt-detail").hidden = style() === "simple"; };
    const preview = () => { const img = $("rpt-img"), src = shots[mode()] || shots.view; if (src) { img.src = src; img.hidden = false; $("rpt-prep").hidden = true; } };
    const close = (result) => { document.removeEventListener("keydown", onKey); box.remove(); resolve(result); };
    const onKey = (e) => { if (e.key === "Escape") close(null); };
    sync(); showStyle();
    box.querySelectorAll('input[name="rpt-style"]').forEach((r) => (r.onchange = showStyle));
    box.querySelectorAll(".rpt-presets [data-p]").forEach((b) => (b.onclick = () => { chosen = new Set(b.dataset.p === "none" ? [] : PRESETS[b.dataset.p]); sync(); }));
    boxes.forEach((b) => (b.onchange = read));
    box.querySelectorAll('input[name="rpt-map"]').forEach((r) => (r.onchange = preview));
    $("rpt-x").onclick = $("rpt-cancel").onclick = () => close(null);
    box.onclick = (e) => { if (e.target === box) close(null); };
    document.addEventListener("keydown", onKey);
    $("rpt-go").onclick = () => {
      read(); const st = style(); const include = st === "simple" ? ["simple"] : [...chosen].filter((id) => avail[id]);
      if (!include.length) { $("rpt-msg").textContent = "Pick at least one section."; return; }
      try { localStorage.setItem(KEY, JSON.stringify({ include: [...chosen], style: st })); } catch {}
      // Open the tab now, inside this click; the report fills it in when it is built
      const win = window.open("", "_blank");
      if (win) { try { win.document.write('<!doctype html><title>Building report…</title><body style="font:15px system-ui;padding:40px;color:#334">Building the site report… this tab fills in when it is ready (usually 5–15 seconds).</body>'); } catch {} }
      const m = mode();
      close({ include, style: st, mapMode: m, mapImage: shots[m] || shots.view, win });
    };
    // Capture both map images: the current view now, then the whole basin (fit, wait for tiles, capture, restore)
    (async () => {
      shots.view = await snapshot();
      if (basin && document.body.contains(box)) {
        $("rpt-prep").textContent = "Preparing the watershed map…";
        const v = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
        // The watershed map shows the basin and the site; rain-station dots and gauge symbols are hidden for it
        const hide = ["stations-circle", "stations-label", "gauges-circle", "ov-wlssd"].filter((l) => map.getLayer(l) && map.getLayoutProperty(l, "visibility") !== "none");
        try { hide.forEach((l) => map.setLayoutProperty(l, "visibility", "none")); drawBasin(basin); map.fitBounds(bboxOf(basin.geometry || basin), { padding: 50, animate: false, maxZoom: 15 }); await idle(); shots.watershed = await snapshot(); }
        finally { hide.forEach((l) => map.setLayoutProperty(l, "visibility", "visible")); map.jumpTo(v); }
      }
      ready = true; if (!document.body.contains(box)) return;
      $("rpt-go").disabled = false; preview();
      if (!shots.view && !shots.watershed) $("rpt-prep").textContent = "The map could not be captured (it only draws while this tab is visible); the report will have no map.";
    })();
  });
}
