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

// Component-weighted HSG mix: every component of every map unit counts by its share of the map unit (comppct_r) times
// the map unit's area inside the basin. (Web Soil Survey's default map uses the "dominant condition", one group per map
// unit from its largest component, which can turn a 55% D / 25% B/D / 10% C unit into 100% D; that result is kept as
// `dominant` for comparison.) Two Soil Data Access queries: map-unit areas in the basin, then their components.
export async function basinHsg(geometry) {
  const { wkt, vertices, polygons } = basinWkt(geometry);
  const key = "w2:" + wkt.slice(0, 200) + wkt.length;
  if (cache.has(key)) return cache.get(key);
  const areas = await query(`SELECT mp.mukey, SUM(mp.mupolygongeo.STIntersection(geometry::STGeomFromText('${wkt}', 4326)).STArea()) AS a, COUNT(*) AS n
    FROM mupolygon mp WHERE mp.mupolygongeo.STIntersects(geometry::STGeomFromText('${wkt}', 4326)) = 1 GROUP BY mp.mukey`, { ttl: 24 * 3600_000 });
  const keys = areas.map((r) => String(r.mukey)).filter((k) => /^\d+$/.test(k));
  const comps = keys.length ? await query(`SELECT mukey, hydgrp, comppct_r FROM component WHERE mukey IN (${keys.map((k) => `'${k}'`).join(",")})`, { ttl: 24 * 3600_000 }) : [];
  const byMu = new Map(); for (const c of comps) { const k = String(c.mukey); if (!byMu.has(k)) byMu.set(k, []); byMu.get(k).push({ hsg: c.hydgrp || null, pct: Number(c.comppct_r) || 0 }); }
  const w = new Map(), wn = new Map(), dom = new Map(), dn = new Map(); let total = 0;
  const add = (m, g, v) => m.set(g, (m.get(g) || 0) + v);
  for (const r of areas) {
    const a = Number(r.a || 0), n = Number(r.n || 0); total += a;
    const cs = byMu.get(String(r.mukey)) || []; const sum = cs.reduce((t, c) => t + c.pct, 0);
    if (!cs.length || !sum) { add(w, null, a); add(wn, null, n); add(dom, null, a); add(dn, null, n); continue; }
    const seen = new Set();
    for (const c of cs) { add(w, c.hsg, (a * c.pct) / sum); if (!seen.has(c.hsg)) { add(wn, c.hsg, n); seen.add(c.hsg); } }
    const top = cs.slice().sort((x, y) => y.pct - x.pct)[0]; add(dom, top.hsg, a); add(dn, top.hsg, n);
  }
  const toGroups = (m, nm) => [...m.entries()].map(([hsg, v]) => ({ hsg, frac: total ? v / total : 0, n: nm.get(hsg) || 0 })).filter((g) => g.frac > 0.0005).sort((x, y) => y.frac - x.frac);
  const groups = toGroups(w, wn), domGroups = toGroups(dom, dn);
  // Effective single-letter split: dual groups count as their undrained (D) side for runoff unless drained.
  const split = (gs) => { const eff = { A: 0, B: 0, C: 0, D: 0, unrated: 0 }, dr = { A: 0, B: 0, C: 0, D: 0, unrated: 0 };
    for (const g of gs) { if (!g.hsg) { eff.unrated += g.frac; dr.unrated += g.frac; continue; } const [first, second] = g.hsg.split("/"); eff[second || first] += g.frac; dr[first] += g.frac; } return [eff, dr]; };
  const [eff, effDrained] = split(groups);
  const out = { groups, eff, effDrained, dominant: { groups: domGroups, eff: split(domGroups)[0] }, method: "component-weighted", vertices, polygons, total };
  cache.set(key, out);
  return out;
}

// CN by cover for the effective split (TR-55 Table 2-2 / 2-2a, AMC II). A handful of covers engineers ask for.
export const CN = {
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
export function composite(split, table) { const r = 1 - split.unrated; if (r <= 0) return null; return (split.A * table.A + split.B * table.B + split.C * table.C + split.D * table.D) / r; }

export async function renderBasinSoils(container, geometry, daSqMi) {
  container.innerHTML = `<h3>Basin soils · hydrologic soil groups (SSURGO)</h3><div class="spinner">Weighting soil components across the basin (Soil Data Access, 3–10 s)…</div>`;
  try {
    const r = await basinHsg(geometry);
    if (!container.isConnected) return;
    const bar = r.groups.map((g) => `<span title="${escapeHtml((g.hsg || "Not rated") + (g.hsg ? ": " + (HSG_NOTE[g.hsg] || "") : ""))}" style="display:inline-block;height:100%;width:${(100 * g.frac).toFixed(2)}%;background:${HSG_COLORS[g.hsg] || "#9e9e9e"}"></span>`).join("");
    container.innerHTML = `<h3>Basin soils · hydrologic soil groups (SSURGO)</h3>
      <div style="height:16px;border-radius:4px;overflow:hidden;background:#333;white-space:nowrap;font-size:0">${bar}</div>
      <table class="data"><thead><tr><th>HSG</th><th class="num">% of basin</th><th class="num">mi²</th><th class="num">soil polygons with it</th><th>Runoff character</th></tr></thead><tbody>
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
      <div class="small">Every soil component counted by its share of its map unit (SSURGO comppct_r) times the map unit's area inside the basin outline (${r.vertices} vertices${r.polygons > 1 ? `, largest of ${r.polygons} polygons` : ""}). ${r.dominant?.groups?.length ? `For comparison, Web Soil Survey's default "dominant condition" map (one group per map unit, from its largest component) gives ${r.dominant.groups.map((g) => `${escapeHtml(g.hsg || "not rated")} ${fmt(100 * g.frac, 0)}%`).join(" · ")}.` : ""} Source: NRCS Soil Data Access.</div>`;
  } catch (e) { container.innerHTML = `<h3>Basin soils · hydrologic soil groups (SSURGO)</h3><div class="notice">Soil Data Access failed: ${escapeHtml(e.message)}</div>`; }
}
