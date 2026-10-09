// Worker for lidar watershed delineation (js/demshed.js): depression filling (priority-flood with an epsilon
// gradient, Barnes et al. 2014, so flats and filled pits still drain), D8 flow directions on the filled surface,
// flow accumulation, the upstream catchment of a pour cell, and basin metrics from the original (unfilled) DEM.
// Input: DEM in metres on a square UTM grid, row 0 at the north edge. Output: catchment mask + metrics.
// The outlet is a small disc (outletCells radius) lowered to its lowest ground: lidar is bare earth without culverts, so
// a road fill would otherwise dam the drainage at a crossing; the watershed is everything draining into the disc.
self.onmessage = (e) => { try { const r = run(e.data); self.postMessage(r, [r.mask.buffer]); } catch (err) { self.postMessage({ error: err.message || String(err) }); } };

function run({ z, w, h, cell, px, py, snapCells, outletCells = 0 }) {
  const n = w * h, nod = new Uint8Array(n);
  let nNod = 0; for (let i = 0; i < n; i++) if (!(z[i] > -1000)) { nod[i] = 1; nNod++; } // NaN or the -9999 nodata
  if (nNod > n * 0.9) throw new Error("no lidar elevations here");
  const DX = [-1, 0, 1, -1, 1, -1, 0, 1], DY = [-1, -1, -1, 0, 0, 1, 1, 1];
  const DL = DX.map((dx, k) => (dx && DY[k] ? Math.SQRT2 : 1) * cell);

  // ---- outlet disc lowered to its lowest cell (the breach through a road fill at a culvert) ----
  const f = new Float64Array(n); for (let i = 0; i < n; i++) f[i] = z[i];
  const disc = [];
  if (outletCells > 0 && snapCells === 0) {
    let zmin = Infinity; for (let dy = -outletCells; dy <= outletCells; dy++) for (let dx = -outletCells; dx <= outletCells; dx++) { if (dx * dx + dy * dy > outletCells * outletCells) continue; const x = px + dx, y = py + dy; if (x < 0 || y < 0 || x >= w || y >= h) continue; const j = y * w + x; if (nod[j]) continue; disc.push(j); if (z[j] < zmin) zmin = z[j]; }
    for (const j of disc) f[j] = zmin;
  }
  // ---- priority-flood fill with epsilon (cells on the grid edge or next to nodata are outlets) ----
  const closed = new Uint8Array(n);
  const hk = new Float64Array(n), hi = new Int32Array(n); let hn = 0;
  const push = (i, k) => { let c = hn++; hk[c] = k; hi[c] = i; while (c > 0) { const p = (c - 1) >> 1; if (hk[p] <= hk[c]) break; [hk[p], hk[c]] = [hk[c], hk[p]]; [hi[p], hi[c]] = [hi[c], hi[p]]; c = p; } };
  const pop = () => { const top = hi[0]; hn--; if (hn > 0) { hk[0] = hk[hn]; hi[0] = hi[hn]; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < hn && hk[l] < hk[m]) m = l; if (r < hn && hk[r] < hk[m]) m = r; if (m === c) break; [hk[m], hk[c]] = [hk[c], hk[m]]; [hi[m], hi[c]] = [hi[c], hi[m]]; c = m; } } return top; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (nod[i]) { closed[i] = 1; continue; }
    let edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    if (!edge) for (let k = 0; k < 8; k++) if (nod[(y + DY[k]) * w + x + DX[k]]) { edge = true; break; }
    if (edge) { closed[i] = 1; push(i, f[i]); }
  }
  const EPS = 1e-4;
  while (hn > 0) {
    const c = pop(), cx = c % w, cy = (c - cx) / w;
    for (let k = 0; k < 8; k++) {
      const x = cx + DX[k], y = cy + DY[k]; if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const j = y * w + x; if (closed[j]) continue; closed[j] = 1;
      if (f[j] <= f[c]) f[j] = f[c] + EPS;
      push(j, f[j]);
    }
  }

  // ---- D8: steepest descent on the filled surface; -1 = flows off the grid (edge / nodata outlet) ----
  const dir = new Int32Array(n).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (nod[i]) continue; let best = 0, bj = -1;
    for (let k = 0; k < 8; k++) { const xx = x + DX[k], yy = y + DY[k]; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy * w + xx; if (nod[j]) continue; const s = (f[i] - f[j]) / DL[k]; if (s > best) { best = s; bj = j; } }
    dir[i] = bj;
  }

  // ---- flow accumulation (cells), for snapping the pour point onto the drainage line ----
  const indeg = new Int32Array(n); for (let i = 0; i < n; i++) if (dir[i] >= 0) indeg[dir[i]]++;
  const acc = new Float32Array(n).fill(1); const q = new Int32Array(n); let qh = 0, qt = 0;
  for (let i = 0; i < n; i++) if (!nod[i] && indeg[i] === 0) q[qt++] = i;
  while (qh < qt) { const c = q[qh++], d = dir[c]; if (d < 0) continue; acc[d] += acc[c]; if (--indeg[d] === 0) q[qt++] = d; }

  let pour = py * w + px;
  if (snapCells > 0) { let best = -1; for (let dy = -snapCells; dy <= snapCells; dy++) for (let dx = -snapCells; dx <= snapCells; dx++) {
    if (dx * dx + dy * dy > snapCells * snapCells) continue; const x = px + dx, y = py + dy; if (x < 0 || y < 0 || x >= w || y >= h) continue; const j = y * w + x; if (!nod[j] && acc[j] > best) { best = acc[j]; pour = j; } } }
  if (nod[pour]) throw new Error("the point is on a lidar data gap (often open water)");

  // ---- upstream catchment, flow length to the pour cell ----
  const mask = new Uint8Array(n), dist = new Float32Array(n); qh = 0; qt = 0;
  for (const j of disc.length ? disc : [pour]) { mask[j] = 1; q[qt++] = j; }
  let touches = false, far = pour;
  while (qh < qt) {
    const c = q[qh++], cx = c % w, cy = (c - cx) / w;
    if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) touches = true;
    for (let k = 0; k < 8; k++) {
      const x = cx + DX[k], y = cy + DY[k]; if (x < 0 || y < 0 || x >= w || y >= h) continue; const j = y * w + x;
      if (nod[j]) { touches = true; continue; }
      if (!mask[j] && dir[j] === c) { mask[j] = 1; dist[j] = dist[c] + DL[7 - k]; if (dist[j] > dist[far]) far = j; q[qt++] = j; }
    }
  }
  const count = qt;

  // ---- metrics from the original DEM: relief, mean land slope (Horn, ~2 m baseline), longest flow path ----
  const step = Math.max(1, Math.round(2 / cell)), L = step * cell;
  let zMin = Infinity, zMax = -Infinity, sSum = 0, sN = 0;
  const Z = (x, y) => { x = Math.min(w - 1, Math.max(0, x)); y = Math.min(h - 1, Math.max(0, y)); const v = z[y * w + x]; return v > -1000 ? v : null; };
  for (let s = 0; s < count; s++) {
    const i = q[s], x = i % w, y = (i - x) / w, v = z[i];
    if (v < zMin) zMin = v; if (v > zMax) zMax = v;
    const a = Z(x - step, y - step), b = Z(x, y - step), c = Z(x + step, y - step), d = Z(x - step, y), e2 = Z(x + step, y), g = Z(x - step, y + step), hh = Z(x, y + step), ii = Z(x + step, y + step);
    if ([a, b, c, d, e2, g, hh, ii].some((t) => t == null)) continue;
    const dzdx = ((c + 2 * e2 + ii) - (a + 2 * d + g)) / (8 * L), dzdy = ((g + 2 * hh + ii) - (a + 2 * b + c)) / (8 * L);
    sSum += Math.hypot(dzdx, dzdy); sN++;
  }
  const px2 = pour % w, py2 = (pour - px2) / w;
  return { mask, count, touches, pour: [px2, py2], areaM2: count * cell * cell, reliefM: zMax - zMin, zMin, zMax, slopePct: sN ? (100 * sSum) / sN : null,
    lfpM: dist[far], lfpDropM: z[far] - (disc.length ? Math.min(...disc.map((j) => z[j])) : z[pour]), nodFrac: nNod / n };
}
