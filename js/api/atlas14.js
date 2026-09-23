// NOAA Atlas 14 lookups from the precomputed regional grid (tools/build_atlas14_grid.py).
// The PFDS CGI has no CORS header, so live lookups from the browser are not possible.
import { ENDPOINTS } from "../config.js";
import { getJSON } from "../util.js";

let grid = null;
export async function loadAtlas14() {
  if (grid) return grid;
  try { grid = await getJSON(ENDPOINTS.atlas14Grid, { ttl: 86400e3 }); }
  catch (e) { console.warn("Atlas 14 grid unavailable", e); return { grid: {} }; } // not cached: retry on the next point
  return grid;
}
// Nearest grid node's depth table: { lat, lon, durations[], aris[], q[dur][ari], step } or null
export function nearest(lat, lon) {
  if (!grid || !grid.lats) return null;
  // Nearest node that exists: shoreline points can snap to a node over Lake Superior, which the grid omits
  // (Silver Bay and Beaver Bay did), so take the closest populated node within 1.5 grid steps.
  const kx = Math.cos((lat * Math.PI) / 180); let best = null, bd = Infinity;
  for (const la of grid.lats) { if (Math.abs(la - lat) > grid.step * 1.5) continue;
    for (const lo of grid.lons) { if (Math.abs(lo - lon) > grid.step * 1.5) continue;
      const q = grid.grid[`${la.toFixed(3)},${lo.toFixed(3)}`]; if (!q) continue;
      const d = (la - lat) ** 2 + ((lo - lon) * kx) ** 2; if (d < bd) { bd = d; best = { la, lo, q }; } } }
  if (!best) return null;
  return { lat: best.la, lon: best.lo, durations: grid.durations, aris: grid.aris, q: best.q, step: grid.step };
}
// Interpolate return period (years) for a depth at a duration index. Log-linear in ARI.
export function returnPeriod(table, durIdx, depth) {
  if (!table || depth == null) return null;
  const row = table.q[durIdx], aris = table.aris;
  if (depth < row[0]) return { years: null, text: "< 1-yr" };
  for (let i = 0; i < row.length - 1; i++) {
    if (depth >= row[i] && depth < row[i + 1]) {
      const f = (depth - row[i]) / (row[i + 1] - row[i]);
      const y = Math.exp(Math.log(aris[i]) + f * (Math.log(aris[i + 1]) - Math.log(aris[i])));
      return { years: y, text: `~${y < 10 ? y.toFixed(1) : Math.round(y)}-yr` };
    }
  }
  return { years: aris[aris.length - 1], text: `> ${aris[aris.length - 1]}-yr` };
}
export const pfdsUrl = (lat, lon) => `https://hdsc.nws.noaa.gov/pfds/pfds_map_cont.html?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&data=depth&units=english&series=pds`;
