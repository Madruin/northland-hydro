// Renders the site hydrology summary from the JSON document written by report.js.
const FLOW_CLASSES = ["Unclassified", "Critical low (< Q90)", "Low (Q90–Q75)", "Low normal (Q75–Q50)", "High normal (Q50–Q25)", "High (Q25–Q10)", "Flooding (> Q10)"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const f = (v, d = 2) => (v == null || isNaN(v) ? "–" : Number(v).toFixed(d));
const n = (v, d = 0) => (v == null || isNaN(v) ? "–" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));
const date = (iso, o = { month: "short", day: "numeric", year: "numeric" }) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString(undefined, o) : "–");
const dt = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "–");

let doc = null;
try { doc = JSON.parse(localStorage.getItem("nh-report") || "null"); } catch {}
const root = document.getElementById("report");
if (!doc) root.innerHTML = `<p>No report data found. Open Northland Eco, choose a point or project, and use "Print report".</p>`;
else render(doc);

document.getElementById("btn-json").onclick = () => {
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `hydrology_${(doc.project?.name || "point").replace(/[^a-z0-9]+/gi, "_")}_${doc.window.endDate}.json`; a.click();
};

function render(d) {
  const w = d.window;
  const winLabel = w.days === 1 ? `for ${date(w.endDate)}` : `${w.days} days, ${date(w.startDate)} to ${date(w.endDate)}`;
  const q = (code) => { for (const sg of d.watershed?.flows || []) for (const rr of sg.regressionRegions || []) for (const r of rr.results || []) if (r.code === code) return r; return null; };
  const pk100 = q("PK1AEP"), pk2 = q("PK50AEP"), pk1_5 = q("PK66_7AEP");
  const cRow = d.regional?.chosen?.rows?.find((r) => r.type === "C") || d.regional?.chosen?.rows?.[0];
  root.innerHTML = `
    <h1>Site hydrology summary${d.project ? `: ${esc(d.project.name)}` : ""}</h1>
    <div class="meta">${d.project ? `${esc(kindLabel(d.project.kind))} · ${esc(d.project.status)}${d.project.county ? ` · ${esc(d.project.county)} County` : ""}${d.project.swcd ? ` · ${esc(d.project.swcd)}` : ""}<br>` : ""}
      Location ${f(d.point.lat, 5)}, ${f(d.point.lon, 5)}${d.project?.location_note ? ` (${esc(d.project.location_note)})` : ""} · Generated ${dt(d.generatedAt)}${d.generatedBy ? ` by ${esc(d.generatedBy)}` : ""} · ${esc(d.app)}<br>
      Reproduce: <a href="${esc(d.permalink)}">${esc(d.permalink.length > 110 ? d.permalink.slice(0, 110) + "…" : d.permalink)}</a></div>
    ${d.mapImage ? `<img class="map" src="${d.mapImage}" alt="Map" />` : ""}
    ${d.project?.notes ? `<p class="note">${esc(d.project.notes)}</p>` : ""}

    <div class="stats">
      <div class="stat"><div class="v">${d.prism ? f(d.prism.winTotal) + '"' : "–"}</div><div class="l">rain ${w.days === 1 ? "on " + date(w.endDate, { month: "short", day: "numeric" }) : w.days + "-day (PRISM)"}</div><div class="s">${d.stations[0] ? `${f(d.stations[0].total)}" at ${esc(d.stations[0].name)}` : ""}</div></div>
      <div class="stat"><div class="v">${d.prism?.max1 ? f(d.prism.max1.sum) + '"' : "–"}</div><div class="l">max 1-day in window</div><div class="s">${d.prism?.max1 ? date(d.prism.max1.end, { month: "short", day: "numeric" }) : ""}${d.prism?.rp24 ? " · " + d.prism.rp24.text + " (Atlas 14)" : ""}</div></div>
      <div class="stat"><div class="v">${d.watershed ? f(d.watershed.da, 2) : "–"}</div><div class="l">drainage area, mi²</div><div class="s">${d.watershed ? (d.watershed.manual ? "entered manually" : "StreamStats, HUC " + esc(d.watershed.huc || "")) : "not delineated"}</div></div>
      <div class="stat"><div class="v">${pk100 ? n(pk100.value) : "–"}</div><div class="l">1% AEP (100-yr) peak, cfs</div><div class="s">${pk100?.intervalBounds ? `90% PI ${n(pk100.intervalBounds.lower)}–${n(pk100.intervalBounds.upper)}` : ""}</div></div>
      <div class="stat"><div class="v">${cRow ? f(cRow.width, 1) + " ft" : "–"}</div><div class="l">bankfull width (${d.regional?.chosen?.rows?.length > 1 ? "C" : "all"})</div><div class="s">${d.regional ? esc(d.regional.chosen.curveName.replace(" Regional Curve", "")) + " curve" : ""}</div></div>
    </div>

    <h2>1. Rainfall</h2>
    <p class="note">Observed precipitation ${winLabel}. Station values are daily observations ending the morning of the date shown (CoCoRaHS/COOP report about 7 AM). Source: RCC-ACIS.</p>
    <table><thead><tr><th>Station</th><th>Network / id</th><th class="num">Dist mi</th><th class="num">Total in</th><th class="num">Max 1-day</th><th class="num">Missing d</th><th class="num">% of normal</th></tr></thead><tbody>
      ${d.stations.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.network)} · ${esc(s.id)}</td><td class="num">${f(s.mi, 1)}</td><td class="num">${s.total == null ? "no report" : (s.total === 0 && s.flag === "T" ? "T" : f(s.total))}</td><td class="num">${s.max1 != null ? f(s.max1) + (s.max1Date ? " (" + date(s.max1Date, { month: "numeric", day: "numeric" }) + ")" : "") : "–"}</td><td class="num">${s.missing || 0}</td><td class="num">${w.days >= 7 && s.normal && s.total != null ? Math.round((100 * s.total) / s.normal) + "%" : "–"}</td></tr>`).join("")}
    </tbody></table>
    ${d.prism ? `<h3>Gridded precipitation at the point (PRISM 4 km via ACIS${d.prism.lastDate ? `, latest grid ${date(d.prism.lastDate)}` : ""})</h3>
    <table><thead><tr><th>Window</th>${d.prism.windows.map((x) => `<th class="num">${x.days} d</th>`).join("")}</tr></thead><tbody>
      <tr><td>Total, in</td>${d.prism.windows.map((x) => `<td class="num">${f(x.total)}${x.missing ? "*" : ""}</td>`).join("")}</tr></tbody></table>
    <p class="note">${d.normals ? `30-day total is ${Math.round((100 * (d.prism.windows.find((x) => x.days === 30)?.total ?? 0)) / d.normals.normal)}% of the 1991–2020 normal at ${esc(d.normals.name)} (${f(d.normals.mi, 0)} mi away; normal ${f(d.normals.normal)}").` : "No station with normals nearby."}
      Largest totals in the window: 1-day ${d.prism.max1 ? f(d.prism.max1.sum) + '" ending ' + date(d.prism.max1.end) : "–"}${d.prism.rp24 ? ` (${d.prism.rp24.text})` : ""}; 2-day ${d.prism.max2 ? f(d.prism.max2.sum) + '"' : "–"}${d.prism.rp48 ? ` (${d.prism.rp48.text})` : ""}; 3-day ${d.prism.max3 ? f(d.prism.max3.sum) + '"' : "–"}${d.prism.rp72 ? ` (${d.prism.rp72.text})` : ""}. Return periods interpolated from NOAA Atlas 14 at the nearest 0.2° node; fixed-clock daily totals run about 13% below true peak 24 h depths.</p>` : ""}

    <h2>2. Stream gauges</h2>
    <table><thead><tr><th>Gauge</th><th>Ids</th><th class="num">Dist mi</th><th class="num">Flow cfs</th><th class="num">Stage ft</th><th>Class vs record</th><th>As of</th></tr></thead><tbody>
      ${d.gauges.map((g) => `<tr><td>${esc(g.name)}</td><td>${g.usgs_id ? "USGS " + g.usgs_id : ""}${g.dnr_id ? (g.usgs_id ? " · " : "") + "DNR " + g.dnr_id : ""}</td><td class="num">${f(g.mi, 1)}</td><td class="num">${g.flow != null ? n(g.flow, g.flow < 10 ? 1 : 0) : "–"}</td><td class="num">${f(g.stage)}</td><td>${FLOW_CLASSES[g.flowClass] || ""}${g.stale ? " (stale)" : ""}</td><td>${g.flowTime ? dt(g.flowTime) : "–"}</td></tr>`).join("")}
    </tbody></table>
    <p class="note">Flow class is the MN DNR Cooperative Stream Gaging comparison of current flow to the site's period-of-record percentiles for this date. USGS values are provisional.${d.lake ? ` Lake Superior at Duluth: ${f(d.lake.ft)} ft IGLD85 at ${esc(d.lake.time)} (NOAA CO-OPS 9099064).` : ""}</p>

    ${d.weather ? `<h2>3. Forecast and alerts</h2>
    <div class="two"><div>
      <table><thead><tr><th>Period</th><th class="num">°F</th><th class="num">PoP</th><th>Forecast</th></tr></thead><tbody>${d.weather.periods.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${p.temperature}</td><td class="num">${p.pop != null ? p.pop + "%" : "–"}</td><td>${esc(p.short)}</td></tr>`).join("")}</tbody></table>
    </div><div>
      <div class="stats"><div class="stat"><div class="v">${f(d.weather.qpf24)}"</div><div class="l">QPF next 24 h</div></div><div class="stat"><div class="v">${f(d.weather.qpf72)}"</div><div class="l">QPF next 72 h</div></div></div>
      <p class="note">NWS ${esc(d.weather.office)} gridded forecast ${esc(d.weather.grid)}${d.weather.place ? ` near ${esc(d.weather.place)}` : ""}, updated ${dt(d.weather.qpfUpdated)}.</p>
      ${d.alerts?.length ? d.alerts.map((a) => `<div class="alert"><b>${esc(a.event)}</b> · ${esc(a.sender)}<br>${esc(a.headline || "")}</div>`).join("") : `<p class="note">No active NWS alerts at this point.</p>`}
    </div></div>` : ""}

    ${d.atlas14 ? `<h2>4. Design storms (NOAA Atlas 14, PDS depth, inches)</h2>
    <table><thead><tr><th>Duration</th>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<th class="num">${d.atlas14.aris[i]}-yr</th>`).join("")}</tr></thead><tbody>
      ${[4, 5, 6, 7, 8, 9, 10, 11, 13].map((di) => `<tr class="${di === 9 ? "band" : ""}"><td>${esc(d.atlas14.durations[di])}</td>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<td class="num">${f(d.atlas14.q[di][i])}</td>`).join("")}</tr>`).join("")}
    </tbody></table>
    <p class="note">Nearest precomputed grid node ${f(d.atlas14.lat, 1)}, ${f(d.atlas14.lon, 1)} (${d.atlas14.step}° spacing). For submittals use the official point query: <a href="${esc(d.atlas14.pfdsUrl)}">${esc(d.atlas14.pfdsUrl)}</a></p>` : ""}

    ${d.watershed ? `<h2 class="pb">5. Watershed (USGS StreamStats)</h2>
    ${d.watershed.savedAt ? `<p class="note">From the analysis saved ${dt(d.watershed.savedAt)}${d.watershed.savedBy ? ` by ${esc(d.watershed.savedBy)}` : ""}${d.watershed.label ? ` ("${esc(d.watershed.label)}")` : ""}; services were retrieved ${dt(d.watershed.retrievedAt)}.</p>` : `<p class="note">Live analysis retrieved ${dt(d.watershed.retrievedAt)}.</p>`}
    ${d.watershed.manual ? `<p class="note">Drainage area ${f(d.watershed.da, 2)} mi² entered manually; no delineation or basin characteristics.</p>` : `
    <div class="stats">
      <div class="stat"><div class="v">${f(d.watershed.da, 2)}</div><div class="l">drainage area, mi²</div><div class="s">HUC ${esc(d.watershed.huc || "")}${d.watershed.basin ? ` · ${d.watershed.basin.type}` : ""}</div></div>
      ${["BSLDEM10M", "CSL10_85", "LAKEAREA", "STORNWI"].map((c) => { const b = d.watershed.bc.find((x) => x.code === c); return b ? `<div class="stat"><div class="v">${f(b.value, 1)}</div><div class="l">${esc(b.name)}</div><div class="s">${esc(b.unit || "")}</div></div>` : ""; }).join("")}
    </div>
    <h3>Basin characteristics</h3>
    <table><thead><tr><th>Characteristic</th><th>Code</th><th class="num">Value</th><th>Unit</th></tr></thead><tbody>${d.watershed.bc.map((b) => `<tr><td>${esc(b.name)}</td><td>${esc(b.code)}</td><td class="num">${n(b.value, 3)}</td><td>${esc(b.unit || "")}</td></tr>`).join("")}</tbody></table>
    ${flows(d.watershed)}`}` : ""}

    ${d.regional ? `<h2>6. Bankfull channel dimensions (TSA3 regional curves)</h2>
    <p class="note">${esc(d.regional.chosen.curveName)} · ${esc(d.regional.chosen.region)}. ${esc(d.regional.chosen.method)}</p>
    ${curveTable(d.regional.chosen, d.watershed.da, true)}
    ${d.regional.chosen.warnings?.length ? `<p class="warn">${d.regional.chosen.warnings.map(esc).join(" ")}</p>` : ""}
    <p class="note">${esc(d.regional.chosen.reliability)}</p>
    <h3>Other curves at ${f(d.watershed.da, 2)} mi², for comparison</h3>
    ${d.regional.others.map((o) => `<p class="small"><b>${esc(o.curveName)}</b> (${esc(o.sourceFile)}, ${o.sourceModified})</p>${curveTable(o, d.watershed.da, false)}`).join("")}
    <p class="note">Bankfull dimensions are planning-level estimates from regional survey data; verify with a field bankfull survey before design.</p>` : ""}

    ${d.sections?.length ? `<h2 class="pb">7. Site conditions at the point</h2>
    <p class="note">Lake, stream crossing, FEMA flood hazard, wetland, parcel, soils and well records for the point, as shown in the Northland Eco Point panel at ${dt(d.generatedAt)}.</p>
    ${d.sections.map((s) => `<section class="sec">${s.html}</section>`).join("")}` : ""}
    <h2>Sources and methods</h2>
    <ol class="sources">
      <li>${esc(d.sources.acis.note)}: ${esc(d.sources.acis.url)}. Retrieved ${dt(d.generatedAt)}.</li>
      <li>${esc(d.sources.usgs.note)}: ${esc(d.sources.usgs.url)}. ${esc(d.sources.dnr.note)}: ${esc(d.sources.dnr.url)}. Gauge values as of the times shown.</li>
      <li>${esc(d.sources.nws.note)}: ${esc(d.sources.nws.url)}.</li>
      <li>${esc(d.sources.atlas14.note)}: ${esc(d.sources.atlas14.url)}. Perica et al., NOAA Atlas 14 Volume 8, 2013.</li>
      ${d.sources.streamstats ? `<li>${esc(d.sources.streamstats.note)}: ${esc(d.sources.streamstats.url)}. Peak flows: Minnesota regional regression equations, USGS SIR 2023-5079. Low-flow and flow-duration statistics: USGS SIR 2015-5170.</li>` : ""}
      ${d.sources.regional ? `<li>TSA3 regional curves: ${d.sources.regional.map((r) => `${esc(r.file)} (${r.modified})`).join("; ")}. Equations reproduced from each workbook's Prediction Equations sheet.</li>` : ""}
      <li>${esc(d.sources.coops.note)}: ${esc(d.sources.coops.url)}.</li>
      ${d.sections?.length ? `<li>Site conditions: MN DNR LakeFinder and dams inventory; MN DNR Culvert Inventory Suite and FHWA National Bridge Inventory; FEMA National Flood Hazard Layer (effective data only); MN DNR National Wetlands Inventory update; county parcel services; NRCS SSURGO via Soil Data Access; MN County Well Index (Minnesota Geological Survey / MDH) and DNR Drill Core Library. Retrieved ${dt(d.generatedAt)}.</li>` : ""}
      <li>Map basemap © OpenFreeMap, OpenMapTiles, OpenStreetMap contributors; county boundaries US Census TIGER via us-atlas.</li>
    </ol>
    <p class="small">Generated by ${esc(d.app)}. All upstream data are provisional and subject to revision by the issuing agency. This summary supports screening and design-basis documentation; it does not replace agency reports or field measurements.</p>`;
}

function flows(ws) {
  if (!ws.flows) return `<p class="note">Regression flow statistics unavailable for this point.</p>`;
  return ws.flows.map((sg) => {
    const rows = (sg.regressionRegions || []).flatMap((rr) => (rr.results || []).map((r) => ({ ...r, region: rr.name })));
    if (!rows.length) return "";
    const m = sg.regressionRegions[0]?.name?.match(/(\d{4})_(\d{4})/);
    return `<h3>${esc(sg.statisticGroupName)} <span class="small">${esc(sg.regressionRegions.map((r) => r.name).join(", "))}${m ? ` · USGS SIR ${m[1]}-${m[2]}` : ""}</span></h3>
      <table><thead><tr><th>Statistic</th><th>Code</th><th class="num">Value cfs</th><th class="num">PI low</th><th class="num">PI high</th><th class="num">SEp %</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="${r.code === "PK1AEP" ? "band" : ""}"><td>${esc(r.name)}</td><td>${esc(r.code)}</td><td class="num">${n(r.value, r.value < 10 ? 2 : 0)}</td><td class="num">${r.intervalBounds ? n(r.intervalBounds.lower) : "–"}</td><td class="num">${r.intervalBounds ? n(r.intervalBounds.upper) : "–"}</td><td class="num">${f((r.errors || []).find((e) => /prediction/i.test(e.name))?.value, 0)}</td></tr>`).join("")}</tbody></table>`;
  }).join("") + `<p class="note">PI = 90% prediction interval; SEp = average standard error of prediction. Regression region taken at the pour point (not area-weighted); no gage adjustment applied.</p>`;
}
function curveTable(c, da, full) {
  return `<table><thead><tr><th>Type</th><th class="num">Area ft²</th><th class="num">Width ft</th><th class="num">Depth ft</th><th class="num">W/D</th><th class="num">Q<sub>bkf</sub> cfs</th><th class="num">V ft/s</th></tr></thead><tbody>
    ${c.rows.map((r) => `<tr><td>${r.type === "all" ? "All" : r.type}</td><td class="num">${f(r.area, 1)}</td><td class="num">${f(r.width, 1)}</td><td class="num">${f(r.depth, 2)}</td><td class="num">${f(r.wd, 1)}</td><td class="num">${f(r.q, 0)}</td><td class="num">${f(r.v, 1)}</td></tr>`).join("")}</tbody></table>`;
}
function kindLabel(k) { return { stream: "Stream restoration", culvert: "Culvert / fish passage", shoreline: "Shoreline / bluff", stormwater: "Stormwater", dam: "Dam / outlet", other: "Other" }[k] || k; }
