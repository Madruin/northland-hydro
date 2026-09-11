// Coordinate helpers: WGS84 lat/lon ↔ UTM zone 15N (NAD83), metres and US survey feet. NAD83 and WGS84 are treated as
// identical here (they differ by about a metre in Minnesota, below the accuracy of anything on this map).
export const UTM15 = "+proj=utm +zone=15 +datum=NAD83 +units=m +no_defs";
export const FT_PER_M = 3937 / 1200; // US survey foot
export function toUtm(lon, lat) { return proj4("EPSG:4326", UTM15, [lon, lat]); }
export function fromUtm(e, n) { const [lon, lat] = proj4(UTM15, "EPSG:4326", [e, n]); return { lon, lat }; }
export function utmFeet(lon, lat) { const [e, n] = toUtm(lon, lat); return { e: e * FT_PER_M, n: n * FT_PER_M }; }
const num = (s) => Number(String(s).replace(/,/g, ""));

// Parse typed coordinates: "46.9476, -91.7849" · "46.9476 N 91.7849 W" · "592123, 5200456" (UTM m) · "1943000 17062000" (UTM US ft) · "E 592123 N 5200456"
export function parseCoords(q) {
  let s = q.trim().replace(/[°]/g, "");
  if (!/\d/.test(s)) return null;
  const en = s.match(/^\s*[EeXx]\s*:?\s*([-\d.,]+)\s*[,; ]+\s*[NnYy]\s*:?\s*([-\d.,]+)\s*$/) || s.match(/^\s*[NnYy]\s*:?\s*([-\d.,]+)\s*[,; ]+\s*[EeXx]\s*:?\s*([-\d.,]+)\s*$/);
  let a, b, aTag = "", bTag = "";
  if (en) { const swapped = /^\s*[NnYy]/.test(s); a = num(en[swapped ? 2 : 1]); b = num(en[swapped ? 1 : 2]); return utmGuess(a, b, "E/N"); }
  const m = s.match(/^\s*(-?[\d.,]+)\s*([NSns])?\s*[,;\s]+\s*(-?[\d.,]+)\s*([EWew])?\s*$/);
  if (!m) return null;
  a = num(m[1]); b = num(m[3]); aTag = (m[2] || "").toUpperCase(); bTag = (m[4] || "").toUpperCase();
  if (!isFinite(a) || !isFinite(b)) return null;
  // lat/lon in decimal degrees
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180 && (aTag || bTag || Math.abs(a) < 1000)) {
    let lat = aTag === "S" ? -Math.abs(a) : a, lon = bTag === "W" ? -Math.abs(b) : b;
    if (lon > 0 && lat > 0 && lon > 80 && lon < 100 && !bTag) lon = -lon; // Minnesota longitudes typed without the sign
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lon, lat, kind: "Lat/lon", input: `${lat}, ${lon}` };
  }
  return utmGuess(a, b, "");
}
function utmGuess(a, b, tag) {
  const inM = (e, n) => e > 150000 && e < 850000 && n > 4700000 && n < 5600000;
  const inFt = (e, n) => e > 490000 && e < 2800000 && n > 15400000 && n < 18400000;
  let e = a, n = b, unit = null;
  if (inM(a, b)) unit = "m"; else if (inM(b, a)) { e = b; n = a; unit = "m"; } else if (inFt(a, b)) unit = "ft"; else if (inFt(b, a)) { e = b; n = a; unit = "ft"; }
  if (!unit) return null;
  const em = unit === "ft" ? e / FT_PER_M : e, nm = unit === "ft" ? n / FT_PER_M : n;
  const { lon, lat } = fromUtm(em, nm);
  if (!isFinite(lon) || !isFinite(lat)) return null;
  return { lon, lat, kind: `UTM 15N ${unit === "ft" ? "US ft" : "m"}${tag ? " " + tag : ""}`, input: `${Math.round(e).toLocaleString()} E, ${Math.round(n).toLocaleString()} N` };
}
export function coordSummary(lon, lat) {
  const [e, n] = toUtm(lon, lat); const f = utmFeet(lon, lat);
  return { latlon: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, utmM: `${Math.round(e).toLocaleString()} E, ${Math.round(n).toLocaleString()} N`, utmFt: `${Math.round(f.e).toLocaleString()} E, ${Math.round(f.n).toLocaleString()} N`, utmFtRaw: `${f.e.toFixed(1)},${f.n.toFixed(1)}` };
}
