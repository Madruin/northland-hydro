// Tax parcels from each county's own ArcGIS service (the MnGeo statewide compilation is too slow for live use).
// Viewport-driven at zoom 14+; fields normalized to one shape per feature: pin, owner, acres, address, city, use, emv.
import { $, escapeHtml, fmt, fmtNum, debounce } from "./util.js";
import { map, setParcels, countyBboxes } from "./map.js";

const SERVICES = {
  "27137": { name: "St. Louis", url: "https://gis.stlouiscountymn.gov/server2/rest/services/GeneralUse/Open_Data/MapServer/7", fields: "PRCL_NBR,OWNAME,ACREAGE,DEEDED_ACRES,PHYSADDR,PHYSCITY,Ownership,TAX_DIST_NAME,HSTD_Desc1,TaxableMarketValue,LAND_EST,BUILDING,TAX_YR,LEGAL,LAKE_NAME",
    map: (p) => ({ pin: p.PRCL_NBR, owner: p.OWNAME, acres: p.ACREAGE, acresDeed: p.DEEDED_ACRES, address: p.PHYSADDR, city: p.PHYSCITY, use: p.Ownership, district: p.TAX_DIST_NAME, homestead: p.HSTD_Desc1, emv: p.TaxableMarketValue ?? ((p.LAND_EST || 0) + (p.BUILDING || 0)), year: p.TAX_YR, legal: p.LEGAL, lake: p.LAKE_NAME }) },
  "27031": { name: "Cook", url: "https://services.arcgis.com/L3KwVADPEG6iD24f/arcgis/rest/services/Tax_Parcel_Polygons/FeatureServer/0", fields: "COUNTY_PIN,OWNER_NAME,ACRES_POLY,ACRES_DEED,ANUMBER,ST_NAME,ST_POS_TYP,CTU_NAME,USECLASS1,HOMESTEAD,EMV_TOTAL,TAX_YEAR,ABB_LEGAL",
    map: (p) => ({ pin: p.COUNTY_PIN, owner: p.OWNER_NAME, acres: p.ACRES_POLY, acresDeed: p.ACRES_DEED, address: [p.ANUMBER, p.ST_NAME, p.ST_POS_TYP].filter(Boolean).join(" "), city: p.CTU_NAME, use: p.USECLASS1, homestead: p.HOMESTEAD, emv: p.EMV_TOTAL, year: p.TAX_YEAR, legal: p.ABB_LEGAL }) },
  "27017": { name: "Carlton", url: "https://gis.co.carlton.mn.us/arcgis/rest/services/OpenData/Parcels_CarltonCountyMN/MapServer/0", fields: "PARCELID,OWNAME,TXNAME,PHYSADDR,PHYSCITY,APDEED,TPHSTC,TPYEAR,LEGAL,PLDESC", noPaging: false,
    map: (p) => ({ pin: p.PARCELID, owner: p.OWNAME || p.TXNAME, acres: null, acresDeed: p.APDEED, address: p.PHYSADDR, city: p.PHYSCITY, homestead: p.TPHSTC, year: p.TPYEAR, legal: p.LEGAL || p.PLDESC }) },
  "27001": { name: "Aitkin", url: "https://gisweb.co.aitkin.mn.us/arcgis/rest/services/ParcelTaxData/FeatureServer/0", fields: "PRCL_NBR,OWNNAME,Acres,DEEDED_ACRES,Physical_Address,Physical_City,TAX_DIST_NAME,TPCLS1,TPHSTC,ESTTOTVAL,TAX_YR,LEGAL,LAKE_NAME",
    map: (p) => ({ pin: p.PRCL_NBR, owner: p.OWNNAME, acres: p.Acres, acresDeed: p.DEEDED_ACRES, address: p.Physical_Address, city: p.Physical_City, district: p.TAX_DIST_NAME, use: p.TPCLS1, homestead: p.TPHSTC, emv: p.ESTTOTVAL, year: p.TAX_YR, legal: p.LEGAL, lake: p.LAKE_NAME }) },
  "27095": { name: "Mille Lacs", url: "https://gis.co.mille-lacs.mn.us/arcgis/rest/services/AGO_Parcels_and_Lots/MapServer/3", fields: "*", noPaging: true,
    map: (p) => ({ pin: p["dbo.tblParcelJoin.PARCEL_NUMBER"] || p["DBO.CDSTRL_Parcels.Name"], owner: p["dbo.tblParcelJoin.OWNER_NAME"] || p["dbo.tblParcelJoin.TAXPAYER_NAME"], acres: null, acresDeed: p["dbo.tblParcelJoin.DEEDED_ACRES"], address: p["dbo.tblParcelJoin.PROPERTY_ADDRESS"], city: p["dbo.tblParcelJoin.CITY_TWP_NAME"], year: p["dbo.tblParcelJoin.TAX_YEAR"], legal: p["dbo.tblParcelJoin.LEGAL"] }) },
  "27075": { name: "Lake", url: "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_co_lake/plan_tax_parcels/FeatureServer/0", fields: "gis_pid,tax_ownname,tax_taxname,gis_acres,tax_acres,tax_twpcityname,gis_ownertype,gis_emv,tax_taxyear,tax_legaldesc,gis_watershedhuc12name",
    map: (p) => ({ pin: p.gis_pid, owner: p.tax_ownname || p.tax_taxname, acres: p.gis_acres, acresDeed: p.tax_acres, address: null, city: p.tax_twpcityname, use: p.gis_ownertype, emv: p.gis_emv, year: p.tax_taxyear, legal: p.tax_legaldesc, extra: p.gis_watershedhuc12name }) },
  "27065": { name: "Kanabec", url: "https://wfs.schneidercorp.com/arcgis/rest/services/KanabecCountyMN_WFS/MapServer/0", fields: "PIN,OwnerName1,OwnerName2,ACRES_MAP,ACRES_DEED,SiteAddress,SiteCityStZip,ESTIMATEDTOTAL,SALEDATE",
    map: (p) => ({ pin: p.PIN, owner: [p.OwnerName1, p.OwnerName2].filter(Boolean).join(" & "), acres: p.ACRES_MAP, acresDeed: p.ACRES_DEED, address: p.SiteAddress, city: p.SiteCityStZip, emv: p.ESTIMATEDTOTAL }) },
};
// Pine County: no public service; the county Auditor's Office exports the parcel layer to us, converted by
// tools/build_pine_parcels.py into WGS84 GeoJSON chunks under data/pine_parcels (0.1 degree cells) read from this origin.
const STATIC = { "27115": { name: "Pine", base: "data/pine_parcels", note: "Pine County parcels are a county export dated 2026-09-09, not a live feed." } };
export const NO_SERVICE = {};
// Attribute search (PIN or owner) across every county: field names per live service; Pine from its static search index.
const SEARCH_FIELDS = {
  "27137": { pin: "PRCL_NBR", owners: ["OWNAME"], addr: "PHYSADDR" }, "27031": { pin: "COUNTY_PIN", owners: ["OWNER_NAME"], addr: null },
  "27017": { pin: "PARCELID", owners: ["OWNAME", "TXNAME"], addr: "PHYSADDR" }, "27001": { pin: "PRCL_NBR", owners: ["OWNNAME"], addr: "Physical_Address" },
  "27095": { pin: "dbo.tblParcelJoin.PARCEL_NUMBER", owners: ["dbo.tblParcelJoin.OWNER_NAME", "dbo.tblParcelJoin.TAXPAYER_NAME"], addr: null },
  "27075": { pin: "gis_pid", owners: ["tax_ownname", "tax_taxname"], addr: null }, "27065": { pin: "PIN", owners: ["OwnerName1", "OwnerName2"], addr: "SiteAddress" },
};
let pineSearch = null;
function centerOf(g) { if (!g) return null; const bb = bboxOf(g); return [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]; }
export function looksLikePin(q) { return /\d/.test(q) && /^[\d.\-\s]+$/.test(q.trim()) && q.replace(/\D/g, "").length >= 5; }
export async function searchParcels(q, { limitPerCounty = 5, signal, onPartial } = {}) {
  const raw = q.trim().replace(/'/g, "''"); const isPin = looksLikePin(q); const digits = raw.replace(/\D/g, "");
  const upper = raw.toUpperCase();
  const jobs = Object.entries(SERVICES).map(async ([fips, s]) => {
    const f = SEARCH_FIELDS[fips]; if (!f) return [];
    const where = isPin ? `${f.pin} LIKE '%${raw}%'${digits !== raw ? ` OR ${f.pin} LIKE '%${digits}%'` : ""}` : f.owners.map((o) => `UPPER(${o}) LIKE '%${upper}%'`).join(" OR ");
    const p = new URLSearchParams({ where, outFields: [f.pin, ...f.owners, f.addr].filter(Boolean).join(","), returnGeometry: "true", outSR: "4326", geometryPrecision: "4", f: "json" });
    if (!s.noPaging) p.set("resultRecordCount", String(limitPerCounty));
    const r = await fetch(`${s.url}/query?${p}`, { signal }); if (!r.ok) throw new Error(`${s.name} ${r.status}`);
    const d = await r.json(); if (d.error) throw new Error(`${s.name}: ${d.error.message}`);
    return (d.features || []).slice(0, limitPerCounty).map((ft) => {
      const a = ft.attributes || {}; const g = ft.geometry?.rings ? { type: "Polygon", coordinates: ft.geometry.rings } : null; const c = centerOf(g); if (!c) return null;
      const owner = f.owners.map((o) => a[o]).filter(Boolean).join(" & ");
      return { kind: "parcel", label: owner || a[f.pin], sub: `Parcel · ${s.name} County · PIN ${a[f.pin] || "?"}${f.addr && a[f.addr] ? " · " + String(a[f.addr]).trim() : ""}`, lon: c[0], lat: c[1], zoom: 16, s: 5, pin: a[f.pin] };
    }).filter(Boolean);
  });
  jobs.push((async () => {
    if (!pineSearch) { const r = await fetch(`${STATIC["27115"].base}/search.json`, { signal }); if (!r.ok) return []; pineSearch = await r.json(); }
    const hits = [];
    for (const [pin, owner, addr, lon, lat] of pineSearch) {
      if (isPin ? (pin.includes(raw) || (digits && pin.replace(/\D/g, "").includes(digits))) : owner.toUpperCase().includes(upper)) { hits.push({ kind: "parcel", label: owner || pin, sub: `Parcel · Pine County · PIN ${pin}${addr ? " · " + addr : ""}`, lon, lat, zoom: 16, s: 5, pin }); if (hits.length >= limitPerCounty) break; }
    }
    return hits;
  })());
  // report each county as it answers (Lake County takes ~5 s) so the search box can fill in progressively
  const found = [];
  const results = await Promise.allSettled(jobs.map((j) => j.then((hits) => { found.push(...hits); onPartial?.(found.slice()); return hits; })));
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
const staticCache = { index: {}, cells: {} };
async function staticIndex(fips) {
  const s = STATIC[fips]; if (staticCache.index[fips]) return staticCache.index[fips];
  const r = await fetch(`${s.base}/index.json`); if (!r.ok) throw new Error(`${s.name} index ${r.status}`);
  return (staticCache.index[fips] = await r.json());
}
async function staticCell(fips, name) {
  const key = fips + "/" + name; if (staticCache.cells[key]) return staticCache.cells[key];
  const r = await fetch(`${STATIC[fips].base}/${name}`); if (!r.ok) throw new Error(`${STATIC[fips].name} ${name} ${r.status}`);
  const fc = await r.json();
  if (Object.keys(staticCache.cells).length > 12) delete staticCache.cells[Object.keys(staticCache.cells)[0]];
  return (staticCache.cells[key] = fc);
}
function bboxOf(g) { let w = 180, s = 90, e = -180, n = -90; const walk = (c) => { if (typeof c[0] === "number") { if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1]; } else c.forEach(walk); }; walk(g.coordinates); return [w, s, e, n]; }
function pointInPoly(pt, g) {
  const inRing = (r) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys.some((p) => inRing(p[0]) && !p.slice(1).some(inRing));
}
async function fetchStatic(fips, bbox) {
  const s = STATIC[fips]; const idx = await staticIndex(fips);
  const cells = idx.cells.filter((c) => c.bbox[0] <= bbox[2] && c.bbox[2] >= bbox[0] && c.bbox[1] <= bbox[3] && c.bbox[3] >= bbox[1]);
  const seen = new Set(); const feats = [];
  for (const fc of await Promise.all(cells.map((c) => staticCell(fips, c.f)))) {
    for (const f of fc.features) {
      const p = f.properties; if (seen.has(p.pin)) continue;
      const bb = bboxOf(f.geometry); if (bb[0] > bbox[2] || bb[2] < bbox[0] || bb[1] > bbox[3] || bb[3] < bbox[1]) continue;
      seen.add(p.pin);
      const props = { kind: "parcel", county: s.name, fips, pin: p.pin || "", owner: p.owner || "", acres: p.acres ?? p.acresDeed ?? approxAcres(f.geometry), acresDeed: p.acresDeed ?? null, address: [p.address, p.city].filter(Boolean).join(", "), use: p.use || "", homestead: "" };
      props.label = props.owner ? props.owner.slice(0, 28) : props.pin;
      props.popup = `<div class="popup-title">${escapeHtml(props.owner || "(no owner listed)")}</div><div class="popup-sub">PIN ${escapeHtml(props.pin)} · ${fmt(props.acres, 1)} ac${props.address ? " · " + escapeHtml(props.address) : ""}</div><div class="popup-sub">${escapeHtml(s.name)} County export</div>`;
      feats.push({ type: "Feature", geometry: f.geometry, properties: props });
    }
  }
  return { feats, exceeded: false };
}
export const MIN_ZOOM = 14;

let enabled = false, lastKey = null, inflight = null;
export function initParcels() { map.on("moveend", debounce(() => { if (enabled) refresh(); }, 350)); }
export function setParcelsEnabled(on) { enabled = on; if (on) refresh(); else { setParcels({ type: "FeatureCollection", features: [] }); lastKey = null; note(""); } }
function note(t) { const el = $("parcels-note"); if (el) el.textContent = t; }

function countiesFor(bbox) {
  const out = [];
  for (const [fips, cb] of Object.entries(countyBboxes())) {
    if (cb[0] <= bbox[2] && cb[2] >= bbox[0] && cb[1] <= bbox[3] && cb[3] >= bbox[1]) out.push(fips);
  }
  return out;
}
async function fetchCounty(fips, bbox) {
  const s = SERVICES[fips];
  const q = new URLSearchParams({ geometry: bbox.map((v) => v.toFixed(6)).join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: s.fields, outSR: "4326", geometryPrecision: "6", f: "geojson" });
  if (!s.noPaging) q.set("resultRecordCount", "2000");
  const r = await fetch(`${s.url}/query?${q}`);
  if (!r.ok) throw new Error(`${s.name} ${r.status}`);
  const d = await r.json();
  if (d.error) throw new Error(`${s.name}: ${d.error.message}`);
  const feats = (d.features || []).map((f) => {
    const m = s.map(f.properties || {});
    const acres = m.acres ?? m.acresDeed ?? approxAcres(f.geometry);
    const props = { kind: "parcel", county: s.name, fips, pin: m.pin || "", owner: m.owner || "", acres, acresDeed: m.acresDeed ?? null, address: [m.address, m.city].filter(Boolean).join(", "), use: m.use || "", homestead: m.homestead || "", emv: m.emv ?? null, year: m.year ?? null, legal: m.legal || "", lake: m.lake || "", district: m.district || "", extra: m.extra || "" };
    props.label = props.owner ? props.owner.slice(0, 28) : props.pin;
    props.popup = `<div class="popup-title">${escapeHtml(props.owner || "(no owner listed)")}</div><div class="popup-sub">PIN ${escapeHtml(props.pin)} · ${fmt(acres, 1)} ac${props.address ? " · " + escapeHtml(props.address) : ""}</div><div class="popup-sub">${escapeHtml(props.use)}${props.homestead ? " · " + escapeHtml(props.homestead) : ""}${props.emv ? " · EMV $" + fmtNum(props.emv) : ""} · ${s.name} County</div>`;
    return { type: "Feature", geometry: f.geometry, properties: props };
  });
  return { feats, exceeded: !!d.properties?.exceededTransferLimit || feats.length >= 1000 };
}
async function refresh() {
  const z = map.getZoom();
  const b = map.getBounds();
  if (z < MIN_ZOOM) { setParcels({ type: "FeatureCollection", features: [] }); lastKey = null; note(`Parcels: zoom in (${MIN_ZOOM}+) to load`); return; }
  const pad = 0.1;
  const bbox = [b.getWest() - (b.getEast() - b.getWest()) * pad, b.getSouth() - (b.getNorth() - b.getSouth()) * pad, b.getEast() + (b.getEast() - b.getWest()) * pad, b.getNorth() + (b.getNorth() - b.getSouth()) * pad];
  const key = bbox.map((v) => v.toFixed(4)).join(",");
  if (key === lastKey) return;
  lastKey = key;
  const counties = countiesFor(bbox);
  const have = counties.filter((f) => SERVICES[f] || STATIC[f]);
  const missing = counties.filter((f) => !SERVICES[f] && !STATIC[f]).map((f) => NO_SERVICE[f] || `no service for county ${f}`);
  if (!have.length) { setParcels({ type: "FeatureCollection", features: [] }); note(missing[0] || "Parcels: outside the covered counties"); return; }
  const nameOf = (f) => (SERVICES[f] || STATIC[f]).name;
  note(`Parcels: loading ${have.map(nameOf).join(", ")}…`);
  const mine = (inflight = Promise.allSettled(have.map((f) => (STATIC[f] ? fetchStatic(f, bbox) : fetchCounty(f, bbox)))));
  const results = await mine;
  if (inflight !== mine || !enabled) return;
  const feats = []; let exceeded = false; const errs = [];
  results.forEach((r, i) => { if (r.status === "fulfilled") { feats.push(...r.value.feats); exceeded ||= r.value.exceeded; } else errs.push(r.reason?.message || String(r.reason)); });
  setParcels({ type: "FeatureCollection", features: feats });
  note(`Parcels: ${feats.length} from ${have.map(nameOf).join(", ")}${exceeded ? " (limit hit, zoom in for all)" : ""}${errs.length ? " · failed: " + errs.join("; ") : ""}${missing.length ? " · " + missing.join(" ") : ""}`);
}
function approxAcres(g) {
  if (!g) return null;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  const ring = (r) => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(s) / 2; };
  let a = 0, lat = 47;
  for (const p of polys) { if (!p.length) continue; lat = p[0][0][1]; a += ring(p[0]) - p.slice(1).reduce((s, h) => s + ring(h), 0); }
  return a * 111320 * Math.cos((lat * Math.PI) / 180) * 110570 / 4046.86;
}

export function parcelsLegendHtml() {
  return `<h4>Parcels (county tax parcels)</h4><div class="legend-row"><span class="swatch sq" style="background:none;border:2px solid #f59e0b"></span>Parcel boundary · owner labels at 16+</div><div class="small">Pine County from the county's 2026-09-09 export; others live from each county's GIS: St. Louis, Cook, Lake, Carlton, Aitkin, Mille Lacs, Kanabec. Pine has no public service. Loads at zoom ${MIN_ZOOM}+. <span id="parcels-note"></span></div>`;
}

// ---- Point panel section ----
export async function renderParcelAt(container, lon, lat) {
  const here = countiesFor([lon, lat, lon, lat]);
  const sfips = here.find((f) => STATIC[f]);
  if (sfips) {
    const s = STATIC[sfips];
    container.innerHTML = `<h3>Parcel at this point · ${escapeHtml(s.name)} County</h3><div class="spinner">Reading county export…</div>`;
    try {
      const { feats } = await fetchStatic(sfips, [lon - 1e-6, lat - 1e-6, lon + 1e-6, lat + 1e-6]);
      const f = feats.find((x) => pointInPoly([lon, lat], x.geometry));
      if (!f) { container.innerHTML = `<h3>Parcel at this point · ${escapeHtml(s.name)} County</h3><div class="notice">No parcel polygon here (water, road right-of-way, or unmapped).</div>`; return; }
      const p = f.properties; const idx = await staticIndex(sfips);
      const cell = (await Promise.all(idx.cells.filter((c) => c.bbox[0] <= lon && c.bbox[2] >= lon && c.bbox[1] <= lat && c.bbox[3] >= lat).map((c) => staticCell(sfips, c.f)))).flatMap((fc) => fc.features).find((x) => x.properties.pin === p.pin)?.properties || {};
      const rows = [["PIN", p.pin], ["Owner", p.owner], ["Site address", p.address], ["Acres (GIS / deeded)", `${p.acres != null ? fmt(p.acres, 2) : "–"} / ${p.acresDeed != null ? fmt(p.acresDeed, 2) : "–"}`], ["Class code", p.use], ["Taxing district", cell.district], ["Sec-Twp-Rng", cell.str], ["Year built", cell.year || "–"], ["Legal", cell.legal]].filter(([, v]) => v != null && v !== "");
      container.innerHTML = `<h3>Parcel at this point · ${escapeHtml(s.name)} County</h3>
        <table class="data"><tbody>${rows.map(([k, v]) => `<tr><td class="small" style="white-space:nowrap">${k}</td><td>${escapeHtml(String(v))}</td></tr>`).join("")}</tbody></table>
        <div class="small">${escapeHtml(idx.source || s.note)}. Ownership and values are as published by the county assessor and can lag recent transfers.</div>`;
    } catch (e) { container.innerHTML = `<h3>Parcel at this point · ${escapeHtml(s.name)} County</h3><div class="notice">County export unavailable: ${escapeHtml(e.message)}</div>`; }
    return;
  }
  const fips = here.find((f) => SERVICES[f]);
  const missing = here.map((f) => NO_SERVICE[f]).find(Boolean);
  if (!fips) { container.innerHTML = `<h3>Parcel at this point</h3><div class="notice">${escapeHtml(missing || "No parcel service for this county.")}</div>`; return; }
  const s = SERVICES[fips];
  container.innerHTML = `<h3>Parcel at this point · ${escapeHtml(s.name)} County</h3><div class="spinner">Querying county GIS…</div>`;
  try {
    const q = new URLSearchParams({ geometry: `${lon.toFixed(6)},${lat.toFixed(6)}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: s.fields, returnGeometry: "false", f: "json" });
    const r = await fetch(`${s.url}/query?${q}`); const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    const f = (d.features || [])[0];
    if (!f) { container.innerHTML = `<h3>Parcel at this point · ${escapeHtml(s.name)} County</h3><div class="notice">No parcel polygon here (water, road right-of-way, or unmapped).</div>`; return; }
    const m = s.map(f.attributes || {});
    const rows = [["PIN", m.pin], ["Owner", m.owner], ["Site address", [m.address, m.city].filter(Boolean).join(", ")], ["Acres (GIS / deeded)", `${m.acres != null ? fmt(m.acres, 2) : "–"} / ${m.acresDeed != null ? fmt(m.acresDeed, 2) : "–"}`], ["Use / ownership", m.use], ["Homestead", m.homestead], ["Tax district", m.district], ["Estimated market value", m.emv ? "$" + fmtNum(m.emv) : null], ["Tax year", m.year], ["Lake", m.lake], ["Legal", m.legal], ["HUC-12", m.extra]].filter(([, v]) => v != null && v !== "");
    container.innerHTML = `<h3>Parcel at this point · ${escapeHtml(s.name)} County</h3>
      <table class="data"><tbody>${rows.map(([k, v]) => `<tr><td class="small" style="white-space:nowrap">${k}</td><td>${escapeHtml(String(v))}</td></tr>`).join("")}</tbody></table>
      <div class="small">Live from the county's GIS service; ownership and values are as published by the county assessor and can lag recent transfers.</div>`;
  } catch (e) { container.innerHTML = `<h3>Parcel at this point · ${escapeHtml(s.name)} County</h3><div class="notice">County GIS request failed: ${escapeHtml(e.message)}</div>`; }
}
