// TSA 3 soil and water conservation districts: the nine district boundaries (data/layers/swcd.json, a snapshot of the
// statewide SWCD polygons; St. Louis County is split into North and South St. Louis SWCDs) and a point lookup, so a
// project's district and county fill in from its location.
export const SWCDS = ["Aitkin SWCD", "Carlton SWCD", "Cook SWCD", "Kanabec SWCD", "Lake SWCD", "Mille Lacs SWCD", "North St. Louis SWCD", "Pine SWCD", "South St. Louis SWCD"];
export const swcdCounty = (s) => (SWCDS.includes(s) ? s.replace(/^(North|South) /, "").replace(/ SWCD$/, "") : null);

let fc = null;
const load = () => (fc ||= fetch("data/layers/swcd.json").then((r) => { if (!r.ok) throw new Error("SWCD boundaries unavailable"); return r.json(); }).catch((e) => { fc = null; throw e; }));
function inRing(x, y, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [x1, y1] = r[i], [x2, y2] = r[j]; if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) c = !c; }
  return c;
}
const polys = (g) => (g.type === "MultiPolygon" ? g.coordinates : [g.coordinates]);

// District containing the point; on the Lake Superior shore (outside the simplified outline) the nearest within ~3 km
export async function swcdAt(lon, lat) {
  const d = await load();
  for (const f of d.features) if (polys(f.geometry).some((p) => inRing(lon, lat, p[0]) && !p.slice(1).some((h) => inRing(lon, lat, h)))) return f.properties.name;
  let best = null, bd = Infinity; const k = Math.cos((lat * Math.PI) / 180);
  for (const f of d.features) for (const p of polys(f.geometry)) for (const [x, y] of p[0]) { const dd = ((x - lon) * k) ** 2 + (y - lat) ** 2; if (dd < bd) { bd = dd; best = f.properties.name; } }
  return Math.sqrt(bd) * 111 <= 3 ? best : null;
}
