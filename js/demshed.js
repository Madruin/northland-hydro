// Small-watershed delineation from lidar, in the browser: for off-stream swales, ditches and culverts on small
// drainages that StreamStats' stream grid doesn't reach. The MnTOPO lidar DEM (2nd generation 0.5 m, or 1st
// generation 1 m where the 0.5 m has gaps, e.g. Pine County) is read around the point; a worker fills sinks, routes
// D8 flow and traces everything draining to the point (js/demshed-worker.js), after breaching road and rail fills.
// If the watershed reaches the edge of the window, the window grows (with coarser cells) up to ~7 km across. The
// outline comes from d3-contour. DNR's stream lines traced from lidar (water_dnr_hydrography_from_lidar: watercourses,
// detailed stream lines, flow-accumulation lines) are burned in first, so water follows mapped streams through road
// crossings the lidar shows as solid fill.
import { toUtm, fromUtm } from "./coords.js";
import { loadScript } from "./field.js";

const IMG = "https://enterprise.gisdata.mn.gov/agsimg/rest/services/MnTopo";
const DEMS = [{ url: `${IMG}/2nd_Generation_Seamless_Lidar_DEM/ImageServer/exportImage`, label: "0.5 m lidar (2021–24, MnTOPO 2nd generation)", min: 0.5 },
  { url: `${IMG}/1st_Generation_DEM_Data/ImageServer/exportImage`, label: "1 m lidar (2008–12, MnTOPO 1st generation)", min: 1 }];
// window half-width (m) and cell size (m) for each try; ~1,000-1,400 cells across
export const STAGES = [{ half: 250, cell: 0.5 }, { half: 600, cell: 1 }, { half: 1500, cell: 2.5 }, { half: 3500, cell: 6 }];
const cache = new Map();
const HYD = "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/water_dnr_hydrography_from_lidar/MapServer";
const BURN_LAYERS = [1, 2]; // DNR watercourses from lidar and additional detailed stream lines

// DNR lidar stream lines in a UTM box, as arrays of [x, y] paths (paged; capped so a huge window can't stall)
async function streamPaths(box, signal) {
  const out = [];
  await Promise.all(BURN_LAYERS.map(async (layer) => {
    for (let page = 0, offset = 0; page < 8; page++) {
      const q = new URLSearchParams({ geometry: box.map((v) => v.toFixed(1)).join(","), geometryType: "esriGeometryEnvelope", inSR: "26915", outSR: "26915", spatialRel: "esriSpatialRelIntersects", returnGeometry: "true", outFields: "objectid", geometryPrecision: "1", resultOffset: String(offset), resultRecordCount: "2000", f: "json" });
      const r = await fetch(`${HYD}/${layer}/query?${q}`, { signal }); if (!r.ok) return;
      const d = await r.json(); if (d.error) return;
      for (const f of d.features || []) for (const p of f.geometry?.paths || []) out.push(p);
      if (!d.exceededTransferLimit) return; offset += (d.features || []).length;
    }
  }));
  return out;
}
// Rasterize paths onto the grid (cells touched by each segment, stepped at a third of a cell)
function burnMask(paths, g) {
  const m = new Uint8Array(g.w * g.h); let k = 0;
  for (const p of paths) for (let i = 1; i < p.length; i++) {
    const [ax, ay] = p[i - 1], [bx, by] = p[i]; const steps = Math.max(1, Math.ceil((Math.hypot(bx - ax, by - ay) / g.cell) * 3));
    for (let s = 0; s <= steps; s++) { const x = ax + ((bx - ax) * s) / steps, y = ay + ((by - ay) * s) / steps;
      const c = Math.floor((x - g.x0) / g.cell), r = Math.floor((g.y0 - y) / g.cell); if (c >= 0 && r >= 0 && c < g.w && r < g.h && !m[r * g.w + c]) { m[r * g.w + c] = 1; k++; } }
  }
  return k ? m : null;
}

const fetchDem = (dem, e, n, half, cell, signal) => fetchBox(dem, [e - half, n - half, e + half, n + half], cell, signal);
async function fetchBox(dem, bbox, cell, signal) {
  cell = Math.max(cell, dem.min);
  const sw = Math.round((bbox[2] - bbox[0]) / cell), sh = Math.round((bbox[3] - bbox[1]) / cell);
  const r = await fetch(`${dem.url}?bbox=${bbox.map((v) => v.toFixed(2)).join(",")}&bboxSR=26915&imageSR=26915&size=${sw},${sh}&format=tiff&pixelType=F32&noData=-9999&interpolation=RSP_BilinearInterpolation&f=image`, { signal });
  if (!r.ok) throw new Error(`lidar service ${r.status}`);
  const buf = await r.arrayBuffer();
  let z, w = sw, h = sh;
  try { const img = await (await GeoTIFF.fromArrayBuffer(buf)).getImage(); const [ras] = await img.readRasters(); w = img.getWidth(); h = img.getHeight(); z = ras instanceof Float32Array ? ras : Float32Array.from(ras); }
  catch { z = new Float32Array(sw * sh).fill(-9999); } // where a DEM has no coverage the service sends a tiny empty TIFF (e.g. 0.5 m in Pine County)
  return { z, w, h, cell: (bbox[2] - bbox[0]) / w, x0: bbox[0], y0: bbox[3] };
}
function runWorker(msg) {
  return new Promise((res, rej) => {
    const wk = new Worker(new URL("./demshed-worker.js", import.meta.url));
    wk.onmessage = (ev) => { wk.terminate(); ev.data.error ? rej(new Error(ev.data.error)) : res(ev.data); };
    wk.onerror = (ev) => { wk.terminate(); rej(new Error(ev.message || "worker failed")); };
    wk.postMessage(msg, [msg.z.buffer, ...(msg.burn ? [msg.burn.buffer] : [])]);
  });
}
// Douglas-Peucker on a closed ring of [x, y]
function simplify(ring, tol) {
  if (ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length); keep[0] = keep[ring.length - 1] = 1; const st = [[0, ring.length - 1]];
  while (st.length) { const [a, b] = st.pop(); let md = 0, mi = -1; const [ax, ay] = ring[a], [bx, by] = ring[b]; const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * ring[i][0] - dx * ring[i][1] + bx * ay - by * ax) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); } }
  const out = ring.filter((_, i) => keep[i]); return out.length >= 4 ? out : ring;
}

// Delineate. onStatus(text) reports progress. Returns the basin feature (lon/lat) and metrics.
// outletM: radius of the outlet disc lowered through road fills (a culvert or outlet at the point)
export async function delineateLidar(lon, lat, { snapM = 10, outletM = 8, onStatus = () => {}, signal } = {}) {
  const key = `${lon.toFixed(5)},${lat.toFixed(5)},${snapM},${outletM}`; if (cache.has(key)) return cache.get(key);
  await loadScript("https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js", "GeoTIFF");
  if (!window.d3?.contours) { // d3-contour needs d3-array loaded first
    await loadScript("https://cdn.jsdelivr.net/npm/d3-array@3.2.4/dist/d3-array.min.js", "__none");
    await loadScript("https://cdn.jsdelivr.net/npm/d3-contour@4.0.2/dist/d3-contour.min.js", "__none");
  }
  const [e, n] = toUtm(lon, lat);
  let dem = DEMS[0], res = null, g = null, stage = null, outlet = null;
  for (const [si, s] of STAGES.entries()) {
    stage = s; onStatus(`Reading lidar ${s.cell} m cells over ${((2 * s.half) / 1000).toFixed(1)} km (try ${si + 1} of ${STAGES.length})…`);
    g = await fetchDem(dem, e, n, s.half, s.cell, signal);
    const gapsOf = (r) => { let k = 0; for (const v of r.z) if (!(v > -1000)) k++; return k / r.z.length; };
    if (dem === DEMS[0] && gapsOf(g) > 0.02) { // holes in the 0.5 m (e.g. Pine County): use the statewide 1 m if it covers more (open water is a gap in both)
      onStatus("Gaps in the 0.5 m lidar here; checking the statewide 1 m lidar…");
      const g1 = await fetchDem(DEMS[1], e, n, s.half, s.cell, signal);
      if (gapsOf(g1) < gapsOf(g) * 0.5) { dem = DEMS[1]; g = g1; }
    }
    onStatus(`Routing flow over ${(g.w * g.h / 1e6).toFixed(1)} million cells…`);
    // the outlet is snapped once, on the finest grid; bigger windows keep it (re-snapping on coarse cells can jump to another flow line)
    const cellOf = ([x, y]) => [Math.floor((x - g.x0) / g.cell), Math.floor((g.y0 - y) / g.cell)];
    // first try: breach and fill, then snap to the strongest flow line within snapM of the click; later (bigger, coarser)
    // tries keep that outlet so they trace the same watershed
    const [px, py] = cellOf(outlet || [e, n]);
    const burn = burnMask(await streamPaths([e - s.half, n - s.half, e + s.half, n + s.half], signal).catch(() => []), g);
    res = await runWorker({ z: g.z, w: g.w, h: g.h, cell: g.cell, px, py, snapCells: outlet ? 0 : Math.round(snapM / g.cell), outletCells: Math.max(1, Math.round(outletM / g.cell)), burn });
    outlet ||= [g.x0 + (res.pour[0] + 0.5) * g.cell, g.y0 - (res.pour[1] + 0.5) * g.cell];
    if (!res.touches) break;
  }
  // A watershed found on a coarse grid is traced again over just its extent (+25%) at the finest cells that stay
  // under ~1.6 million, so the outline and numbers aren't limited by the big search window's cell size.
  if (!res.touches && g.cell > Math.max(1, dem.min)) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < res.mask.length; i++) if (res.mask[i]) { const x = i % g.w, y = (i - x) / g.w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const bw = (x1 - x0 + 1) * g.cell, bh = (y1 - y0 + 1) * g.cell, m = 0.25 * Math.max(bw, bh) + 50;
    const box = [g.x0 + x0 * g.cell - m, g.y0 - (y1 + 1) * g.cell - m, g.x0 + (x1 + 1) * g.cell + m, g.y0 - y0 * g.cell + m];
    const fine = Math.max(dem.min, Math.ceil(Math.sqrt(((box[2] - box[0]) * (box[3] - box[1])) / 1.6e6) * 2) / 2);
    if (fine < g.cell * 0.8) try {
      onStatus(`Refining the outline at ${fine} m cells…`);
      const g2 = await fetchBox(dem, box, fine, signal);
      const px = Math.floor((outlet[0] - g2.x0) / g2.cell), py = Math.floor((g2.y0 - outlet[1]) / g2.cell);
      const burn2 = burnMask(await streamPaths(box, signal).catch(() => []), g2);
      const r2 = await runWorker({ z: g2.z, w: g2.w, h: g2.h, cell: g2.cell, px, py, snapCells: 0, outletCells: Math.max(1, Math.round(outletM / g2.cell)), burn: burn2 });
      if (!r2.touches) { res = r2; g = g2; }
    } catch (err) { console.warn("lidar refine pass skipped", err); }
  }
  // outline: d3-contour on the mask, grid units → UTM → lon/lat
  const mask = Float64Array.from(res.mask);
  const mp = d3.contours().size([g.w, g.h]).thresholds([0.5])(mask)[0];
  const toLL = ([x, y]) => { const p = fromUtm(g.x0 + x * g.cell, g.y0 - y * g.cell); return [+p.lon.toFixed(7), +p.lat.toFixed(7)]; };
  // keep the main outline; drop slivers joined only at a cell corner (< 1% of the area)
  const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(a / 2); };
  const parts = mp.coordinates.map((poly) => ({ poly, a: ringArea(poly[0]) })).sort((x, y) => y.a - x.a);
  const polys = parts.filter((p, i) => i === 0 || p.a > parts[0].a * 0.01).map(({ poly }) => poly.filter((ring, i) => i === 0 || ringArea(ring) > 4).map((ring) => simplify(ring, 0.75).map(toLL)));
  const geometry = polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
  const pourUtm = outlet; const pp = fromUtm(...pourUtm);
  const snappedM = Math.hypot(pourUtm[0] - e, pourUtm[1] - n);
  const out = { basin: { type: "Feature", geometry, properties: { source: "lidar" } }, pour: [pp.lon, pp.lat], snappedM,
    areaSqMi: res.areaM2 / 2589988.11, acres: res.areaM2 / 4046.856, reliefFt: res.reliefM * 3.28084, slopePct: res.slopePct,
    lfpFt: res.lfpM * 3.28084, lfpSlopePct: res.lfpM > 0 ? (100 * res.lfpDropM) / res.lfpM : null,
    cell: g.cell, windowKm: (2 * stage.half) / 1000, dem: dem.label, touches: res.touches, burned: res.burned ?? 0, carved: res.breached?.carved ?? 0, click: [lon, lat], budgetHit: !!res.breached?.budgetHit };
  cache.set(key, out); return out;
}
