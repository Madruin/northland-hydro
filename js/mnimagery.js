// MnGeo statewide composite aerial imagery (best available, down to 0.15 m in places) as a Web Mercator tile source.
// The MnGeo WMS only serves EPSG:26915 (UTM 15N), so each map tile is fetched as a UTM image covering the tile's
// footprint and warped onto the 256×256 Mercator tile in a canvas. The warp uses a 9×9 grid of exact proj4 transforms
// with bilinear interpolation in between (the projection difference is smooth), so it costs a few milliseconds per tile.
import { UTM15 } from "./coords.js";

const WMS = "https://imageserver.gisdata.mn.gov/cgi-bin/mncomp";
const SIZE = 256, OVERSAMPLE = 1.5, GRID = 8;
const EMPTY = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 96, 0, 0, 0, 2, 0, 1, 229, 39, 222, 252, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
const MN = { w: -97.3, s: 43.4, e: -89.4, n: 49.5 };

const tile2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const tile2lat = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / 2 ** z; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
function toUtm(lon, lat) { return proj4("EPSG:4326", UTM15, [lon, lat]); }

export function registerMnImagery() {
  if (registerMnImagery.done) return; registerMnImagery.done = true;
  maplibregl.addProtocol("mnimg", async (params, abort) => {
    const m = params.url.match(/^mnimg:\/\/(\d+)\/(\d+)\/(\d+)$/);
    if (!m) throw new Error("bad mnimg url " + params.url);
    const z = +m[1], x = +m[2], y = +m[3];
    const w = tile2lon(x, z), e = tile2lon(x + 1, z), n = tile2lat(y, z), s = tile2lat(y + 1, z);
    if (e < MN.w || w > MN.e || n < MN.s || s > MN.n) return { data: EMPTY };
    // exact UTM coordinates on a (GRID+1)² lattice over the tile, in Mercator-linear (lon, mercY) space
    const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const my0 = mercY(n), my1 = mercY(s);
    const g = [];
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
    for (let j = 0; j <= GRID; j++) {
      const lat = (Math.atan(Math.sinh(my0 + ((my1 - my0) * j) / GRID)) * 180) / Math.PI; const row = [];
      for (let i = 0; i <= GRID; i++) { const u = toUtm(w + ((e - w) * i) / GRID, lat); row.push(u); if (u[0] < minE) minE = u[0]; if (u[0] > maxE) maxE = u[0]; if (u[1] < minN) minN = u[1]; if (u[1] > maxN) maxN = u[1]; }
      g.push(row);
    }
    const pxW = Math.min(2048, Math.round(SIZE * OVERSAMPLE)), pxH = Math.min(2048, Math.round((SIZE * OVERSAMPLE * (maxN - minN)) / (maxE - minE)));
    const url = `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=mncomp&STYLES=&CRS=EPSG:26915&BBOX=${minE.toFixed(2)},${minN.toFixed(2)},${maxE.toFixed(2)},${maxN.toFixed(2)}&WIDTH=${pxW}&HEIGHT=${pxH}&FORMAT=image/jpeg`;
    const r = await fetch(url, { signal: abort?.signal });
    if (!r.ok) throw new Error(`imagery ${r.status}`);
    const bmp = await createImageBitmap(await r.blob());
    const src = new OffscreenCanvas(pxW, pxH); const sctx = src.getContext("2d", { willReadFrequently: true }); sctx.drawImage(bmp, 0, 0);
    const sd = sctx.getImageData(0, 0, pxW, pxH).data;
    const out = new OffscreenCanvas(SIZE, SIZE); const octx = out.getContext("2d"); const od = octx.createImageData(SIZE, SIZE); const dd = od.data;
    const sx = pxW / (maxE - minE), sy = pxH / (maxN - minN);
    for (let py = 0; py < SIZE; py++) {
      const gy = (py / SIZE) * GRID, j = Math.min(GRID - 1, Math.floor(gy)), fy = gy - j;
      for (let px = 0; px < SIZE; px++) {
        const gx = (px / SIZE) * GRID, i = Math.min(GRID - 1, Math.floor(gx)), fx = gx - i;
        const a = g[j][i], b = g[j][i + 1], c = g[j + 1][i], d = g[j + 1][i + 1];
        const E = (a[0] * (1 - fx) + b[0] * fx) * (1 - fy) + (c[0] * (1 - fx) + d[0] * fx) * fy;
        const N = (a[1] * (1 - fx) + b[1] * fx) * (1 - fy) + (c[1] * (1 - fx) + d[1] * fx) * fy;
        const qx = Math.min(pxW - 1, Math.max(0, Math.round((E - minE) * sx))), qy = Math.min(pxH - 1, Math.max(0, Math.round((maxN - N) * sy)));
        const si = (qy * pxW + qx) * 4, di = (py * SIZE + px) * 4;
        dd[di] = sd[si]; dd[di + 1] = sd[si + 1]; dd[di + 2] = sd[si + 2]; dd[di + 3] = 255;
      }
    }
    octx.putImageData(od, 0, 0);
    const blob = await out.convertToBlob({ type: "image/jpeg", quality: 0.88 });
    return { data: await blob.arrayBuffer() };
  });
}
