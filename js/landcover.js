// NLCD 2021 land cover (MRLC): the map layer's legend, and the class mix inside a delineated basin for a land-cover
// curve number. The basin mix comes from MRLC's WCS (CORS *) as an uncompressed EPSG:4326 GeoTIFF (~30 m cells,
// downscaled for big basins), parsed with geotiff.js and counted by scanline fill of the basin outline.
import { escapeHtml } from "./util.js";

export const NLCD_YEAR = 2021;
const WCS = "https://www.mrlc.gov/geoserver/mrlc_download/wcs";
export const WMS_TILES = `https://www.mrlc.gov/geoserver/mrlc_display/NLCD_${NLCD_YEAR}_Land_Cover_L48/ows?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=NLCD_${NLCD_YEAR}_Land_Cover_L48&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512&FORMAT=image/png&TRANSPARENT=true`;

// NLCD class → name, color, and the TR-55 (Table 2-2a/2-2c) cover used for its curve number by HSG, AMC II.
// Analogs follow common NLCD→CN practice; forests are "woods, good" (typical for NE Minnesota), wetlands their
// vegetated analog unless the "wetlands saturated" option is on (then CN 98, like open water).
export const NLCD = {
  11: { name: "Open water", color: "#466b9f", tr55: "Water surface", cn: { A: 98, B: 98, C: 98, D: 98 } },
  12: { name: "Perennial ice/snow", color: "#d1def8", tr55: "Water surface", cn: { A: 98, B: 98, C: 98, D: 98 } },
  21: { name: "Developed, open space", color: "#dec5c5", tr55: "Open space, fair (lawns, parks)", cn: { A: 49, B: 69, C: 79, D: 84 } },
  22: { name: "Developed, low intensity", color: "#d99282", tr55: "Residential ¼ ac (38% impervious)", cn: { A: 61, B: 75, C: 83, D: 87 } },
  23: { name: "Developed, medium intensity", color: "#eb0000", tr55: "Residential ⅛ ac (65% impervious)", cn: { A: 77, B: 85, C: 90, D: 92 } },
  24: { name: "Developed, high intensity", color: "#ab0000", tr55: "Commercial (85% impervious)", cn: { A: 89, B: 92, C: 94, D: 95 } },
  31: { name: "Barren (rock, sand, clay)", color: "#b3ac9f", tr55: "Newly graded / bare", cn: { A: 77, B: 86, C: 91, D: 94 } },
  41: { name: "Deciduous forest", color: "#68ab5f", tr55: "Woods, good", cn: { A: 30, B: 55, C: 70, D: 77 } },
  42: { name: "Evergreen forest", color: "#1c5f2c", tr55: "Woods, good", cn: { A: 30, B: 55, C: 70, D: 77 } },
  43: { name: "Mixed forest", color: "#b5c58f", tr55: "Woods, good", cn: { A: 30, B: 55, C: 70, D: 77 } },
  52: { name: "Shrub/scrub", color: "#ccb879", tr55: "Brush, fair", cn: { A: 35, B: 56, C: 70, D: 77 } },
  71: { name: "Grassland/herbaceous", color: "#dfdfc2", tr55: "Meadow", cn: { A: 30, B: 58, C: 71, D: 78 } },
  81: { name: "Pasture/hay", color: "#dcd939", tr55: "Pasture, fair", cn: { A: 49, B: 69, C: 79, D: 84 } },
  82: { name: "Cultivated crops", color: "#ab6c28", tr55: "Row crops, straight row, good", cn: { A: 67, B: 78, C: 85, D: 89 } },
  90: { name: "Woody wetlands", color: "#b8d9eb", tr55: "Woods, good (wetland)", cn: { A: 30, B: 55, C: 70, D: 77 }, wetland: true },
  95: { name: "Emergent herbaceous wetlands", color: "#6c9fb8", tr55: "Meadow (wetland)", cn: { A: 30, B: 58, C: 71, D: 78 }, wetland: true },
};
export const SATURATED = { A: 98, B: 98, C: 98, D: 98 };

export function landcoverLegendHtml() {
  return `<h4>Land cover (NLCD ${NLCD_YEAR})</h4>${Object.entries(NLCD).filter(([k]) => k !== "12").map(([, c]) => `<div class="legend-row"><span class="swatch sq" style="background:${c.color}"></span>${escapeHtml(c.name)}</div>`).join("")}
    <div class="small">USGS/MRLC National Land Cover Database, 30 m, from 2021 imagery. Delineated basins use it for the runoff tool's curve number.</div>`;
}

function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("failed to load " + src)); document.head.appendChild(s); });
}
const cache = new Map();
// Fractions of each NLCD class inside the basin: { frac: {code: 0..1}, cells, cellM, year }
export async function basinLandCover(geometry) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const p of polys) for (const [x, y] of p[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const key = [x0, y0, x1, y1].map((v) => v.toFixed(5)).join(",") + ":" + polys.reduce((n, p) => n + p[0].length, 0);
  if (cache.has(key)) return cache.get(key);
  const pad = 0.002; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  // native cells are ~0.00037° × 0.00027° here; keep the request under ~1.5 M cells
  const est = ((x1 - x0) / 0.000376) * ((y1 - y0) / 0.00027);
  const scale = est > 1.5e6 ? Math.sqrt(1.5e6 / est) : 1;
  const url = `${WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=mrlc_download__NLCD_${NLCD_YEAR}_Land_Cover_L48&subset=Long(${x0.toFixed(5)},${x1.toFixed(5)})&subset=Lat(${y0.toFixed(5)},${y1.toFixed(5)})&subsettingCrs=http://www.opengis.net/def/crs/EPSG/0/4326&format=image/geotiff${scale < 1 ? `&SCALEFACTOR=${scale.toFixed(4)}` : ""}`;
  const p = (async () => {
    const [r] = await Promise.all([fetch(url, { signal: AbortSignal.timeout(60000) }).catch(() => { throw new Error("MRLC's land-cover service is not answering; try again later"); }), loadScript("https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js", "GeoTIFF")]);
    if (!r.ok) throw new Error(`MRLC ${r.status}`);
    const tiff = await GeoTIFF.fromArrayBuffer(await r.arrayBuffer()); const img = await tiff.getImage();
    const W = img.getWidth(), H = img.getHeight(); const [bx0, by0, bx1, by1] = img.getBoundingBox();
    const [ras] = await img.readRasters(); const dx = (bx1 - bx0) / W, dy = (by1 - by0) / H;
    const counts = {}; let n = 0;
    for (let row = 0; row < H; row++) {
      const y = by1 - (row + 0.5) * dy; const xs = [];
      for (const poly of polys) for (const ring of poly) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xa, ya] = ring[i], [xb, yb] = ring[j]; if ((ya > y) !== (yb > y)) xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya)); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - bx0) / dx - 0.5)), c1 = Math.min(W - 1, Math.floor((xs[k + 1] - bx0) / dx - 0.5));
        for (let col = c0; col <= c1; col++) { const v = ras[row * W + col]; if (NLCD[v]) { counts[v] = (counts[v] || 0) + 1; n++; } }
      }
    }
    if (!n) throw new Error("no land-cover cells inside the basin");
    const frac = Object.fromEntries(Object.entries(counts).map(([k, c]) => [k, c / n]));
    return { frac, cells: n, cellM: Math.round(dy * 111000), year: NLCD_YEAR };
  })();
  cache.set(key, p); p.catch(() => cache.delete(key));
  if (cache.size > 20) cache.delete(cache.keys().next().value);
  return p;
}
// Composite CN = Σ over land-cover classes and HSGs of (class fraction × HSG fraction × CN). Land cover and soils
// are crossed assuming they are independent across the basin, the usual screening simplification.
export function landCoverCN(lc, hsgSplit, { saturatedWetlands = false } = {}) {
  const rated = 1 - hsgSplit.unrated; if (rated <= 0) return null;
  let cn = 0; const rows = [];
  for (const [code, f] of Object.entries(lc.frac).sort((a, b) => b[1] - a[1])) {
    const c = NLCD[code]; const t = c.wetland && saturatedWetlands ? SATURATED : c.cn;
    const cls = (hsgSplit.A * t.A + hsgSplit.B * t.B + hsgSplit.C * t.C + hsgSplit.D * t.D) / rated;
    cn += f * cls; rows.push({ code, name: c.name, color: c.color, tr55: c.wetland && saturatedWetlands ? "Saturated (CN 98)" : c.tr55, frac: f, cn: cls, t });
  }
  return { cn, rows };
}
