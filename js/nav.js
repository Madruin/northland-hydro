// Panel history (back navigation + breadcrumbs) and header tooltips (glossary).
import { $, escapeHtml } from "./util.js";

const history = [];   // [{type, id, label, run}]
let restoring = false;
const MAX = 20;

// Call from each panel renderer. `run` re-renders that view; `label` is what the breadcrumb shows.
export function visit(type, id, label, run) {
  if (restoring) { restoring = false; renderBar(); return; }
  const top = history[history.length - 1];
  if (top && top.type === type && top.id === id) { top.label = label; top.run = run; renderBar(); return; }
  history.push({ type, id, label, run });
  if (history.length > MAX) history.shift();
  renderBar();
}
export function back() {
  if (history.length < 2) return;
  history.pop();
  const prev = history[history.length - 1];
  restoring = true;
  prev.run();
}
function jumpTo(i) {
  if (i < 0 || i >= history.length - 1) return;
  history.splice(i + 1);
  const t = history[i];
  restoring = true;
  t.run();
}
function renderBar() {
  let bar = $("nav-bar");
  if (!bar) {
    bar = document.createElement("div"); bar.id = "nav-bar"; bar.className = "nav-bar";
    const head = document.querySelector(".panel-head");
    head.insertAdjacentElement("afterend", bar);
  }
  if (history.length < 2) { bar.hidden = true; return; }
  bar.hidden = false;
  const crumbs = history.slice(-4);
  const offset = history.length - crumbs.length;
  bar.innerHTML = `<button class="btn nav-back" id="nav-back" title="Back (Alt+←)">‹ Back</button><div class="crumbs">${crumbs.map((h, i) => { const idx = offset + i; const last = idx === history.length - 1; return `<span class="crumb ${last ? "on" : ""}" data-i="${idx}">${escapeHtml(h.label)}</span>`; }).join('<span class="crumb-sep">›</span>')}</div>`;
  $("nav-back").onclick = back;
  bar.querySelectorAll(".crumb:not(.on)").forEach((el) => el.addEventListener("click", () => jumpTo(Number(el.dataset.i))));
}
export function initNav() {
  document.addEventListener("keydown", (e) => { if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); back(); } });
}

// ---- Glossary tooltips on table headers and stat labels ----
const GLOSSARY = [
  [/^PI (low|high)$/i, "90% prediction interval for the regression estimate: the true value is expected to fall between PI low and PI high 9 times in 10."],
  [/^SEp ?%?$/i, "Average standard error of prediction of the regression equation, in percent. Roughly the one-sigma uncertainty of the estimate."],
  [/^Statistic$/i, "AEP = annual exceedance probability. 1% AEP is the 100-year flood; 50% AEP the 2-year; 66.7% AEP about the 1.5-year (near bankfull)."],
  [/^Class$/i, "MN DNR flow class: today's flow compared with the gauge's period-of-record percentiles for this calendar date. Q90 = flow exceeded 90% of days (low); Q10 = exceeded 10% (high)."],
  [/^cfs$/i, "Discharge in cubic feet per second (ft³/s)."],
  [/^ft$/i, "Gage height (stage) in feet, gauge datum."],
  [/^in$/i, "Precipitation total for the current window, inches."],
  [/^% ?nrm$/i, "Percent of the 1991–2020 normal for the same window. Shown only for 7-day and longer windows."],
  [/^% normal$/i, "Percent of the 1991–2020 normal for the same window. Shown only for 7-day and longer windows."],
  [/^Missing( d)?$/i, "Days in the window with no observation. Totals with missing days are marked partial (*)."],
  [/^Observed$/i, "Sum of daily precipitation over the window, inches (ACIS reducer; trace counts as 0)."],
  [/^Normal$/i, "1991–2020 climatological normal for the same window, inches."],
  [/^Depth$/i, "Snow depth on the ground, inches."],
  [/^Snow$/i, "New snowfall, inches."],
  [/^Precip$/i, "Daily precipitation, inches (liquid equivalent). T = trace, A = multi-day accumulation ending that day, M = missing."],
  [/^mi$/i, "Distance from the clicked point, miles."],
  [/^Area ft²$/i, "Bankfull cross-sectional area from the regional curve, square feet."],
  [/^Width ft$/i, "Bankfull width from the regional curve, feet."],
  [/^Depth ft$/i, "Bankfull mean depth (area ÷ width), feet."],
  [/^W\/D$/i, "Width-to-depth ratio at bankfull. Rosgen E channels <12, C channels >12, B channels >12 with entrenchment ratio 1.4–2.2."],
  [/^Q<sub>bkf<\/sub> cfs$|^Qbkf cfs$/i, "Bankfull discharge from the regional curve, cubic feet per second."],
  [/^V ft\/s$/i, "Bankfull mean velocity = Q ÷ area, feet per second."],
  [/^Type$/i, "Rosgen stream type the curve was fit to: B (steep, confined), C (riffle-pool, moderate W/D), E (low W/D, meandering)."],
  [/^HSG$/i, "NRCS hydrologic soil group. A = high infiltration/low runoff … D = very slow infiltration/high runoff. Dual groups (A/D etc.) apply the first letter only if the soil is drained."],
  [/^Hydric$/i, "Hydric rating: soil formed under saturated conditions (wetland indicator)."],
  [/^Flooding$/i, "Flooding frequency class of the component (None, Very rare, Rare, Occasional, Frequent)."],
  [/^Water table$/i, "Shallowest depth to a wet soil-moisture state in any month, cm below surface (SSURGO cosoilmoist)."],
  [/^Surface$/i, "USDA texture of the surface horizon (e.g. SIL = silt loam, L = loam, FSL = fine sandy loam)."],
  [/^Kw$/i, "Soil erodibility factor (USLE K, whole soil) of the surface horizon."],
  [/^Ksat$/i, "Saturated hydraulic conductivity of the surface horizon, micrometers per second (10 µm/s ≈ 1.4 in/h)."],
  [/^Restriction$/i, "Depth to the first restrictive layer (bedrock, densic, fragipan…), cm. >200 = none within 2 m."],
  [/^Drainage$/i, "Natural drainage class, from excessively drained to very poorly drained."],
  [/^Component$/i, "Soil component (series or miscellaneous area) within the map unit, with its percent of the unit."],
  [/^Spillway el\.$/i, "Principal spillway (outlet crest) elevation from the DNR dams inventory, feet in the datum shown."],
  [/^Top of dam$/i, "Top-of-dam elevation, feet in the datum shown."],
  [/^Hazard$/i, "Dam hazard classification (High, Significant, Low) based on downstream consequences of failure, not condition."],
  [/^Datum$/i, "Vertical datum of the elevations in this row. Local/project datums are not tied to NAVD88."],
  [/^Duration$/i, "Storm duration. Atlas 14 depths are true-interval; daily gauge totals run about 13% lower than a true 24-hour maximum."],
  [/^\d+(\.\d+)?-yr$/i, "Average recurrence interval (return period). A 10-yr depth has a 10% chance of being exceeded in any given year."],
  [/^\d+ d$|^\d+d$/i, "Accumulation window ending on the panel's end date."],
  [/^Cowardin$/i, "Cowardin classification code: system (P palustrine, L lacustrine, R riverine), class (EM emergent, SS scrub-shrub, FO forested, UB unconsolidated bottom, AB aquatic bed), subclass, water regime (A–H), modifiers (x excavated, h diked/impounded, b beaver, d drained)."],
  [/^DA mi²$/i, "Drainage area from StreamStats, square miles."],
  [/^Q1% cfs$/i, "1% annual-exceedance-probability (100-year) peak flow from the regression, cfs."],
];
export function applyTooltips(root = document) {
  root.querySelectorAll("th:not([title]), .stat .l:not([title])").forEach((el) => {
    const text = el.textContent.trim();
    const html = el.innerHTML.trim();
    for (const [re, tip] of GLOSSARY) { if (re.test(text) || re.test(html)) { el.title = tip; el.classList.add("has-tip"); break; } }
  });
}
export function watchTooltips() {
  const body = document.querySelector(".panel-body");
  if (!body) return;
  let t; const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => applyTooltips(body), 120); });
  mo.observe(body, { childList: true, subtree: true });
  applyTooltips(body);
}
