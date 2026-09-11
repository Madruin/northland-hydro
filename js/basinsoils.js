// Area-weighted hydrologic-soil-group breakdown for a delineated basin, via one Soil Data Access spatial query.
import { $, escapeHtml, fmt, fmtNum } from "./util.js";
import { query } from "./api/sda.js";
import { HSG_COLORS, HSG_NOTE } from "./soils.js";

const cache = new Map();

// Outer ring of the largest polygon, thinned to ~600 vertices for the WKT (area breakdown is insensitive to thinning).
function basinWkt(geometry) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const ring = polys.map((p) => p[0]).sort((a, b) => b.length - a.length)[0];
  const step = Math.max(1, Math.ceil(ring.length / 600));
  const pts = ring.filter((_, i) => i % step === 0);
  if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) pts.push(pts[0]);
  return { wkt: `POLYGON((${pts.map(([x, y]) => `${x.toFixed(5)} ${y.toFixed(5)}`).join(", ")}))`, vertices: pts.length, polygons: polys.length };
}

export async function basinHsg(geometry) {
  const { wkt, vertices, polygons } = basinWkt(geometry);
  const key = wkt.slice(0, 200) + wkt.length;
  if (cache.has(key)) return cache.get(key);
  const sql = `SELECT c.hydgrp, SUM(mp.mupolygongeo.STIntersection(geometry::STGeomFromText('${wkt}', 4326)).STArea()) AS a, COUNT(*) AS n
    FROM mupolygon mp INNER JOIN mapunit m ON m.mukey = mp.mukey
    OUTER APPLY (SELECT TOP 1 hydgrp FROM component WHERE mukey = m.mukey ORDER BY comppct_r DESC) c
    WHERE mp.mupolygongeo.STIntersects(geometry::STGeomFromText('${wkt}', 4326)) = 1 GROUP BY c.hydgrp`;
  const rows = await query(sql, { ttl: 24 * 3600_000 });
  const total = rows.reduce((s, r) => s + Number(r.a || 0), 0);
  const groups = rows.map((r) => ({ hsg: r.hydgrp || null, frac: total ? Number(r.a) / total : 0, n: Number(r.n) })).sort((x, y) => y.frac - x.frac);
  // Effective single-letter split: dual groups count as their undrained (D) side for runoff unless drained.
  const eff = { A: 0, B: 0, C: 0, D: 0, unrated: 0 };
  const effDrained = { A: 0, B: 0, C: 0, D: 0, unrated: 0 };
  for (const g of groups) {
    if (!g.hsg) { eff.unrated += g.frac; effDrained.unrated += g.frac; continue; }
    const [first, second] = g.hsg.split("/");
    eff[second || first] += g.frac; effDrained[first] += g.frac;
  }
  const out = { groups, eff, effDrained, vertices, polygons, total };
  cache.set(key, out);
  return out;
}

// CN by cover for the effective split (TR-55 Table 2-2 / 2-2a, AMC II). A handful of covers engineers ask for.
const CN = {
  "Woods, good condition": { A: 30, B: 55, C: 70, D: 77 },
  "Woods, fair condition": { A: 36, B: 60, C: 73, D: 79 },
  "Brush, fair": { A: 35, B: 56, C: 70, D: 77 },
  "Pasture, fair": { A: 49, B: 69, C: 79, D: 84 },
  "Meadow (continuous grass)": { A: 30, B: 58, C: 71, D: 78 },
  "Open space, good (lawns, parks)": { A: 39, B: 61, C: 74, D: 80 },
  "Row crops, straight row, good": { A: 67, B: 78, C: 85, D: 89 },
  "Gravel roads": { A: 76, B: 85, C: 89, D: 91 },
  "Impervious": { A: 98, B: 98, C: 98, D: 98 },
};
function composite(split, table) { const r = 1 - split.unrated; if (r <= 0) return null; return (split.A * table.A + split.B * table.B + split.C * table.C + split.D * table.D) / r; }

export async function renderBasinSoils(container, geometry, daSqMi) {
  container.innerHTML = `<h3>Basin soils · hydrologic soil groups (SSURGO)</h3><div class="spinner">Area-weighting map units across the basin (Soil Data Access, 3–10 s)…</div>`;
  try {
    const r = await basinHsg(geometry);
    if (!container.isConnected) return;
    const bar = r.groups.map((g) => `<span title="${escapeHtml((g.hsg || "Not rated") + (g.hsg ? ": " + (HSG_NOTE[g.hsg] || "") : ""))}" style="display:inline-block;height:100%;width:${(100 * g.frac).toFixed(2)}%;background:${HSG_COLORS[g.hsg] || "#9e9e9e"}"></span>`).join("");
    container.innerHTML = `<h3>Basin soils · hydrologic soil groups (SSURGO)</h3>
      <div style="height:16px;border-radius:4px;overflow:hidden;background:#333;white-space:nowrap;font-size:0">${bar}</div>
      <table class="data"><thead><tr><th>HSG</th><th class="num">% of basin</th><th class="num">mi²</th><th class="num">map units</th><th>Runoff character</th></tr></thead><tbody>
        ${r.groups.map((g) => `<tr><td><b style="color:${HSG_COLORS[g.hsg] || "#9e9e9e"}">${escapeHtml(g.hsg || "Not rated")}</b></td><td class="num">${fmt(100 * g.frac, 1)}</td><td class="num">${daSqMi ? fmt(daSqMi * g.frac, 2) : "–"}</td><td class="num">${g.n}</td><td class="small">${escapeHtml(g.hsg ? HSG_NOTE[g.hsg] || "" : "water, pits, urban land or unmapped")}</td></tr>`).join("")}
      </tbody></table>
      <div class="stat-row">
        ${["A", "B", "C", "D"].map((k) => `<div class="stat"><div class="v" style="color:${HSG_COLORS[k]}">${fmt(100 * r.eff[k], 0)}%</div><div class="l">effective ${k}</div><div class="s">${r.eff[k] !== r.effDrained[k] ? `${fmt(100 * r.effDrained[k], 0)}% if drained` : ""}</div></div>`).join("")}
      </div>
      <details><summary class="small" style="cursor:pointer">Composite curve numbers for this HSG mix (TR-55, AMC II)</summary>
        <table class="data"><thead><tr><th>Cover (whole basin)</th><th class="num">CN undrained</th><th class="num">CN if drained</th></tr></thead><tbody>
          ${Object.entries(CN).map(([name, t]) => `<tr><td>${escapeHtml(name)}</td><td class="num">${fmt(composite(r.eff, t), 0)}</td><td class="num">${fmt(composite(r.effDrained, t), 0)}</td></tr>`).join("")}
        </tbody></table>
        <div class="small">Single-cover composites to show how the soils alone move the number; a real CN needs the cover split (NLCD or field). Dual groups (A/D, B/D, C/D) are treated as their D side undrained and their first letter if artificially drained.</div>
      </details>
      <div class="small">Dominant component of each map unit, area-weighted by planar intersection with the basin outline (${r.vertices} vertices${r.polygons > 1 ? `, largest of ${r.polygons} polygons` : ""}). Source: NRCS Soil Data Access.</div>`;
  } catch (e) { container.innerHTML = `<h3>Basin soils · hydrologic soil groups (SSURGO)</h3><div class="notice">Soil Data Access failed: ${escapeHtml(e.message)}</div>`; }
}
