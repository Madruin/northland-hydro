// USDA NRCS Soil Data Access (SSURGO): SQL over HTTPS, CORS-enabled, no key.
// Docs: https://sdmdataaccess.nrcs.usda.gov/WebServiceHelp.aspx
const SDA = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest";
const cache = new Map();

export async function query(sql, { ttl = 10 * 60_000 } = {}) {
  const hit = cache.get(sql);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const r = await fetch(SDA, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format: "JSON+COLUMNNAME", query: sql }) });
  if (!r.ok) throw new Error(`Soil Data Access ${r.status}`);
  const d = await r.json();
  const t = d.Table || [];
  const cols = t[0] || [];
  const rows = t.slice(1).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
  cache.set(sql, { t: Date.now(), v: rows });
  return rows;
}

// Map-unit polygons intersecting a lon/lat bbox, with the dominant component's hydrologic group etc.
export async function polygonsInBbox([w, s, e, n], { tolerance = 0.00004 } = {}) {
  const poly = `POLYGON((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))`;
  const sql = `SELECT mp.mukey, m.musym, m.muname, c.compname, c.comppct_r, c.hydgrp, c.drainagecl, c.hydricrating, c.slope_r,
    mp.mupolygongeo.Reduce(${tolerance}).STAsText() AS wkt
    FROM mupolygon mp INNER JOIN mapunit m ON m.mukey = mp.mukey
    OUTER APPLY (SELECT TOP 1 compname, comppct_r, hydgrp, drainagecl, hydricrating, slope_r FROM component WHERE mukey = m.mukey ORDER BY comppct_r DESC) c
    WHERE mp.mupolygongeo.STIntersects(geometry::STGeomFromText('${poly}', 4326)) = 1`;
  const rows = await query(sql);
  const features = [];
  for (const r of rows) {
    const g = wktToGeometry(r.wkt);
    if (!g) continue;
    features.push({ type: "Feature", geometry: g, properties: { mukey: r.mukey, musym: r.musym, muname: r.muname, compname: r.compname, comppct: Number(r.comppct_r) || null, hydgrp: r.hydgrp || null, drainagecl: r.drainagecl, hydric: r.hydricrating, slope: r.slope_r == null ? null : Number(r.slope_r) } });
  }
  return { type: "FeatureCollection", features };
}

// Components at a point (fast), then slower details per component.
export async function pointBasic(lon, lat) {
  const sql = `SELECT m.mukey, m.musym, m.muname, l.areasymbol, l.areaname, c.cokey, c.compname, c.comppct_r, c.majcompflag, c.hydgrp, c.drainagecl, c.hydricrating, c.slope_r, c.runoff, c.taxclname, c.localphase
    FROM mupolygon mp INNER JOIN mapunit m ON m.mukey = mp.mukey INNER JOIN legend l ON l.lkey = m.lkey INNER JOIN component c ON c.mukey = m.mukey
    WHERE mp.mupolygongeo.STIntersects(geometry::STGeomFromText('POINT(${lon.toFixed(6)} ${lat.toFixed(6)})', 4326)) = 1 ORDER BY c.comppct_r DESC`;
  return query(sql);
}
export async function componentDetails(cokeys) {
  if (!cokeys.length) return [];
  const list = cokeys.map((k) => `'${k}'`).join(",");
  const sql = `SELECT c.cokey,
    (SELECT TOP 1 flodfreqcl FROM comonth WHERE cokey = c.cokey ORDER BY CASE flodfreqcl WHEN 'Frequent' THEN 1 WHEN 'Occasional' THEN 2 WHEN 'Rare' THEN 3 WHEN 'Very rare' THEN 4 ELSE 5 END) AS flodfreq,
    (SELECT MIN(soimoistdept_r) FROM comonth cm INNER JOIN cosoilmoist sm ON sm.comonthkey = cm.comonthkey WHERE cm.cokey = c.cokey AND sm.soimoiststat = 'Wet') AS wtdepth_cm,
    (SELECT TOP 1 kwfact FROM chorizon WHERE cokey = c.cokey ORDER BY hzdept_r) AS kw_surface,
    (SELECT TOP 1 texture FROM chorizon h INNER JOIN chtexturegrp tg ON tg.chkey = h.chkey WHERE h.cokey = c.cokey AND tg.rvindicator = 'Yes' ORDER BY h.hzdept_r) AS surf_texture,
    (SELECT MIN(resdept_r) FROM corestrictions WHERE cokey = c.cokey) AS restr_cm,
    (SELECT TOP 1 ksat_r FROM chorizon WHERE cokey = c.cokey ORDER BY hzdept_r) AS ksat_surface
    FROM component c WHERE c.cokey IN (${list})`;
  return query(sql);
}
export const wssUrl = (lon, lat) => `https://websoilsurvey.sc.egov.usda.gov/App/WebSoilSurvey.aspx?aoicoords=((${(lon - 0.004).toFixed(4)}%20${(lat - 0.003).toFixed(4)},${(lon + 0.004).toFixed(4)}%20${(lat - 0.003).toFixed(4)},${(lon + 0.004).toFixed(4)}%20${(lat + 0.003).toFixed(4)},${(lon - 0.004).toFixed(4)}%20${(lat + 0.003).toFixed(4)},${(lon - 0.004).toFixed(4)}%20${(lat - 0.003).toFixed(4)}))`;

// Minimal WKT → GeoJSON geometry (POLYGON / MULTIPOLYGON)
export function wktToGeometry(wkt) {
  if (!wkt) return null;
  const s = wkt.trim();
  const ring = (txt) => txt.trim().split(",").map((p) => { const [x, y] = p.trim().split(/\s+/).map(Number); return [x, y]; });
  const polygon = (txt) => { const rings = []; const re = /\(([^()]+)\)/g; let m; while ((m = re.exec(txt))) rings.push(ring(m[1])); return rings; };
  if (s.startsWith("MULTIPOLYGON")) {
    const body = s.slice(s.indexOf("(") + 1, s.lastIndexOf(")"));
    const polys = []; let depth = 0, start = -1;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === "(") { if (depth === 0) start = i; depth++; }
      else if (body[i] === ")") { depth--; if (depth === 0) polys.push(polygon(body.slice(start, i + 1))); }
    }
    return { type: "MultiPolygon", coordinates: polys };
  }
  if (s.startsWith("POLYGON")) return { type: "Polygon", coordinates: polygon(s) };
  return null;
}
