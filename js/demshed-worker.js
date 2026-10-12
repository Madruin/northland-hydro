// Worker for lidar watershed delineation (js/demshed.js): depression filling (priority-flood with an epsilon
// gradient, Barnes et al. 2014, so flats and filled pits still drain), D8 flow directions on the filled surface,
// flow accumulation, the upstream catchment of a pour cell, and basin metrics from the original (unfilled) DEM.
// Input: DEM in metres on a square UTM grid, row 0 at the north edge. Output: catchment mask + metrics.
// Bare-earth lidar has road and rail fills but no culverts, so before filling, depressions are breached by the least-cost
// cut (Lindsay 2016, as in WhiteboxTools BreachDepressionsLeastCost): from each pit, the cheapest path (sum of cut depth)
// to lower ground within maxDist and maxDepth is carved; what can't be breached is then filled. The outlet is a small
// disc lowered to its lowest ground, and the pour cell snaps to the strongest flow line within snapCells.
self.onmessage = (e) => { try { const r = run(e.data); self.postMessage(r, [r.mask.buffer]); } catch (err) { self.postMessage({ error: err.message || String(err) }); } };

function run({ z, w, h, cell, px, py, snapCells, outletCells = 0, burn = null, altCells = 0 }) {
  const n = w * h, nod = new Uint8Array(n);
  let nNod = 0; for (let i = 0; i < n; i++) if (!(z[i] > -1000)) { nod[i] = 1; nNod++; } // NaN or the -9999 nodata
  if (nNod > n * 0.9) throw new Error("no lidar elevations here");
  const DX = [-1, 0, 1, -1, 1, -1, 0, 1], DY = [-1, -1, -1, 0, 0, 1, 1, 1];
  const DL = DX.map((dx, k) => (dx && DY[k] ? Math.SQRT2 : 1) * cell);

  // ---- outlet disc lowered to its lowest cell (the breach through a road fill at a culvert) ----
  const f = new Float64Array(n); for (let i = 0; i < n; i++) f[i] = z[i];
  const disc = [];
  if (outletCells > 0) {
    let zmin = Infinity; for (let dy = -outletCells; dy <= outletCells; dy++) for (let dx = -outletCells; dx <= outletCells; dx++) { if (dx * dx + dy * dy > outletCells * outletCells) continue; const x = px + dx, y = py + dy; if (x < 0 || y < 0 || x >= w || y >= h) continue; const j = y * w + x; if (nod[j]) continue; disc.push(j); if (z[j] < zmin) zmin = z[j]; }
    for (const j of disc) f[j] = zmin;
  }
  // mapped streams (DNR, traced from lidar) burned 3 m in: flow follows them, and the bump left where one crosses a road
  // fill is a short, cheap breach along the line instead of a dam
  let burned = 0; if (burn) for (let i = 0; i < n; i++) if (burn[i] && !nod[i]) { f[i] -= 3; burned++; }
  const breached = breach(f, w, h, nod, cell, DX, DY, DL);
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
  // snap: the nearest cell that is on the main flow line within the radius (at least a quarter of the largest flow there),
  // not the largest one, so the outlet moves as little as possible and nearby clicks give their own outlets
  if (snapCells > 0) {
    const cand = []; let mx = 0;
    for (let dy = -snapCells; dy <= snapCells; dy++) for (let dx = -snapCells; dx <= snapCells; dx++) {
      const d2 = dx * dx + dy * dy; if (d2 > snapCells * snapCells) continue; const x = px + dx, y = py + dy; if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const j = y * w + x; if (nod[j]) continue; cand.push([j, d2]); if (acc[j] > mx) mx = acc[j]; }
    let bd = Infinity; for (const [j, d2] of cand) if (acc[j] >= mx * 0.25 && d2 < bd) { bd = d2; pour = j; }
  }
  if (nod[pour]) throw new Error("the point is on a lidar data gap (often open water)");
  // the largest flow line within altCells (~60 m): offered when it drains much more than the chosen outlet
  let alt = -1; if (altCells > 0) { let best = 0; for (let dy = -altCells; dy <= altCells; dy++) for (let dx = -altCells; dx <= altCells; dx++) {
    if (dx * dx + dy * dy > altCells * altCells) continue; const x = px + dx, y = py + dy; if (x < 0 || y < 0 || x >= w || y >= h) continue; const j = y * w + x; if (!nod[j] && acc[j] > best) { best = acc[j]; alt = j; } } }

  // ---- upstream catchment, flow length to the pour cell ----
  const mask = new Uint8Array(n), dist = new Float32Array(n); qh = 0; qt = 0;
  const seeds = disc.length && pour === py * w + px ? disc : [pour]; // a snapped outlet traces from its own cell
  for (const j of seeds) { mask[j] = 1; q[qt++] = j; }
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
  // ---- drainage lines (≥ ~2 acres) as chains of cell centres, for the map: where the lidar routes water ----
  let thr = Math.max(4, Math.round(8000 / (cell * cell)));
  const lines = [];
  for (let tries = 0; tries < 3; tries++) {
    lines.length = 0; const upCh = new Uint8Array(n), seen = new Uint8Array(n); let pts = 0;
    for (let i = 0; i < n; i++) if (acc[i] >= thr && dir[i] >= 0 && acc[dir[i]] >= thr) upCh[dir[i]] = 1;
    for (let i = 0; i < n && pts < 250000; i++) {
      if (acc[i] < thr || upCh[i] || nod[i]) continue; // start only at channel heads
      const xy = []; let c = i;
      for (;;) { const x = c % w, y = (c - x) / w; xy.push(x + 0.5, y + 0.5); pts++; if (seen[c]) break; seen[c] = 1; const d = dir[c]; if (d < 0 || acc[d] < thr) break; c = d; }
      if (xy.length >= 4) lines.push({ xy: Float32Array.from(xy), acc: acc[c] * cell * cell });
    }
    if (pts < 250000) break; thr *= 4; // too dense for the map: keep only bigger drainages
  }
  const px2 = pour % w, py2 = (pour - px2) / w;
  return { mask, count, touches, pour: [px2, py2], areaM2: count * cell * cell, reliefM: zMax - zMin, zMin, zMax, slopePct: sN ? (100 * sSum) / sN : null,
    lines, lineThrM2: thr * cell * cell, alt: alt >= 0 ? { x: alt % w, y: Math.floor(alt / w), accM2: acc[alt] * cell * cell } : null, lfpM: dist[far], lfpDropM: z[far] - (seeds.length > 1 ? Math.min(...disc.map((j) => z[j])) : z[pour]), nodFrac: nNod / n, breached, burned };
}

// Least-cost depression breaching (Lindsay 2016), constrained: single-cell pits are raised first; then each remaining
// pit (no lower neighbour), lowest first, runs a small Dijkstra search whose cost is the cut depth above the pit, limited
// to maxDistM path length and maxDepthM cut, until it reaches lower ground or the grid edge; that path is carved so it
// descends. A global work budget keeps big flat wetlands from stalling (whatever is left is filled afterwards).
function breach(f, w, h, nod, cell, DX, DY, DL, maxDistM = 100, maxDepthM = 12, budget = 4e7) {
  const n = w * h, inner = (x, y) => x > 0 && y > 0 && x < w - 1 && y < h - 1;
  const lowerNb = (i, x, y) => { for (let k = 0; k < 8; k++) { const j = (y + DY[k]) * w + x + DX[k]; if (!nod[j] && f[j] < f[i]) return true; } return false; };
  const edgeLike = (x, y) => { if (!inner(x, y)) return true; for (let k = 0; k < 8; k++) if (nod[(y + DY[k]) * w + x + DX[k]]) return true; return false; };
  // single-cell pits: raise to the lowest neighbour
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (nod[i]) continue; let m = Infinity;
    for (let k = 0; k < 8; k++) { const j = (y + DY[k]) * w + x + DX[k]; if (!nod[j] && f[j] < m) m = f[j]; }
    if (m > f[i] && m < Infinity) f[i] = m;
  }
  const pits = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (!nod[i] && !edgeLike(x, y) && !lowerNb(i, x, y)) pits.push(i); }
  pits.sort((a, b) => f[a] - f[b]);
  const stamp = new Int32Array(n), cost = new Float32Array(n), par = new Int32Array(n), len = new Float32Array(n), done = new Uint8Array(n);
  const hk = new Float64Array(n), hi = new Int32Array(n); let hn = 0;
  const push = (i, k) => { let c = hn++; hk[c] = k; hi[c] = i; while (c > 0) { const p = (c - 1) >> 1; if (hk[p] <= hk[c]) break; [hk[p], hk[c]] = [hk[c], hk[p]]; [hi[p], hi[c]] = [hi[c], hi[p]]; c = p; } };
  const pop = () => { const top = hi[0]; hn--; if (hn > 0) { hk[0] = hk[hn]; hi[0] = hi[hn]; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < hn && hk[l] < hk[m]) m = l; if (r < hn && hk[r] < hk[m]) m = r; if (m === c) break; [hk[m], hk[c]] = [hk[c], hk[m]]; [hi[m], hi[c]] = [hi[c], hi[m]]; c = m; } } return top; };
  let work = 0, carved = 0, tag = 0;
  for (const p of pits) {
    if (work > budget) break;
    const px = p % w, py = (p - px) / w; if (done[p] || lowerNb(p, px, py)) continue;
    const zp = f[p]; tag++; hn = 0; stamp[p] = tag; cost[p] = 0; len[p] = 0; par[p] = -1; push(p, 0);
    let target = -1;
    while (hn > 0) {
      const c = pop(); work++; const cx = c % w, cy = (c - cx) / w;
      if (c !== p && (f[c] < zp || edgeLike(cx, cy))) { target = c; break; }
      if (f[c] <= zp) done[c] = 1; // the pit's own floor: resolved with it
      for (let k = 0; k < 8; k++) {
        const x = cx + DX[k], y = cy + DY[k]; if (x < 0 || y < 0 || x >= w || y >= h) continue; const j = y * w + x; if (nod[j]) continue;
        const cut = f[j] - zp; if (cut > maxDepthM) continue;
        const L = len[c] + DL[k]; if (L > maxDistM) continue;
        const cc = cost[c] + Math.max(0, cut) * DL[k];
        if (stamp[j] === tag && cc >= cost[j]) continue;
        stamp[j] = tag; cost[j] = cc; len[j] = L; par[j] = c; push(j, cc);
      }
    }
    if (target < 0) continue;
    // carve: walk from the target back to the pit, then lower the path so it descends pit → target
    const path = []; for (let c = target; c !== -1; c = par[c]) path.push(c); path.reverse();
    let zc = zp;
    for (let s = 1; s < path.length; s++) { zc -= 1e-5; if (f[path[s]] > zc) f[path[s]] = zc; else zc = f[path[s]]; }
    carved++;
  }
  return { pits: pits.length, carved, budgetHit: work > budget };
}
