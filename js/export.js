// Area-of-interest export for AutoCAD: aerial imagery (JPG + world file), lidar DEM (GeoTIFF and ASCII grid),
// and contours (DXF), all in NAD83 UTM zone 15N, US survey feet (Civil 3D "UTM83-15F"), elevations NAVD88 ft.
// Sources: MnGeo WMS (imagery, EPSG:26915) and the MnTOPO 2nd-generation seamless lidar DEM ImageServer.
import { $, escapeHtml, fmt, fmtNum } from "./util.js";
import { startRectDraw, setAoi, map } from "./map.js";
import { authState } from "./projects.js";

const FT = 3937 / 1200;                 // meters → US survey feet
const UTM15 = "+proj=utm +zone=15 +datum=NAD83 +units=m +no_defs";
const WMS = "https://imageserver.gisdata.mn.gov/cgi-bin/wms";
const WMS_COMP = "https://imageserver.gisdata.mn.gov/cgi-bin/mncomp";
const DEM2 = "https://enterprise.gisdata.mn.gov/agsimg/rest/services/MnTopo/2nd_Generation_Seamless_Lidar_DEM/ImageServer/exportImage";
const DEM1 = "https://enterprise.gisdata.mn.gov/agsimg/rest/services/MnTopo/1st_Generation_DEM_Data/ImageServer/exportImage";
const IMAGERY = [
  { id: "comp", label: "Composite (latest available, best resolution)", url: WMS_COMP, layer: "mncomp" },
  { id: "fsa2025", label: "FSA/NAIP 2025", url: WMS, layer: "fsa2025" }, { id: "fsa2023", label: "FSA/NAIP 2023", url: WMS, layer: "fsa2023" },
  { id: "fsa2021", label: "FSA/NAIP 2021", url: WMS, layer: "fsa2021" }, { id: "fsa2019", label: "FSA/NAIP 2019", url: WMS, layer: "fsa2019" },
  { id: "fsa2017", label: "FSA/NAIP 2017", url: WMS, layer: "fsa2017" }, { id: "fsa2015", label: "FSA/NAIP 2015", url: WMS, layer: "fsa2015" },
];
const PRJ_USFT = 'PROJCS["NAD_1983_UTM_Zone_15N_USFT",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",1640416.666666667],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-93.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Foot_US",0.3048006096012192]]';

const CAD_STEPS_HTML = `<details class="steps"><summary>Bringing these into Civil 3D (step by step)</summary>
<ol>
<li><b>Set the drawing coordinate system first.</b> Toolspace → Settings → right-click the drawing → Edit Drawing Settings → Units and Zone: units Feet, zone <b>UTM83-15F</b> (USA, Minnesota: NAD83 UTM Zone 15N, US Foot). Use a fresh drawing or your survey template.</li>
<li><b>Aerial imagery.</b> Insert → Attach, pick the JPG. The JGW world file beside it (same base name) is read automatically and places the image. If it lands at 0,0 or looks scaled, use <code>MAPIINSERT</code> instead, or <code>IMAGEATTACH</code> with "Use correlation file".</li>
<li><b>Contours as a surface.</b> Insert the DXF (Insert → Block, or copy/paste at 0,0; never "specify on-screen"). Prospector → Surfaces → Create Surface (TIN). Expand it → Definition → Contours → Add; select the polylines on CONTOUR-INDEX and CONTOUR-INTER. Z values are elevations in feet. Freeze the DXF layers once the surface exists.</li>
<li><b>DEM as a surface</b> (use for the full 0.5 m or 1 m grid). Create Surface (TIN) → Definition → DEM Files → Add → pick the <code>.asc</code> file; coordinate system UTM83-15F; leave elevations as-is. The <code>.tif</code> is in UTM meters (code UTM83-15) and Civil 3D would not convert its elevations, so prefer the <code>.asc</code>. A 0.5 m grid over a large box makes a slow surface; use 1 m for site scale or add a surface boundary.</li>
<li><b>Check.</b> <code>ID</code> a contour vertex: eastings around 1.8–1.9 million ft and northings around 17.0 million ft for the Duluth area, Z near the elevations shown here. The DXF carries a text note with the coordinate system and date on layer AOI-BOUNDARY.</li>
</ol></details>`;
const CAD_STEPS_TEXT = `BRINGING THESE INTO CIVIL 3D
 1. Set the drawing coordinate system first: Toolspace > Settings > right-click drawing > Edit Drawing Settings > Units and Zone:
    units Feet, zone UTM83-15F (USA, Minnesota: NAD83 UTM Zone 15N, US Foot). Use a fresh drawing or your survey template.
 2. Imagery: Insert > Attach, pick the JPG. The JGW world file (same base name) is read automatically. If it lands at 0,0 or
    looks scaled, use MAPIINSERT, or IMAGEATTACH with "Use correlation file".
 3. Contours as a surface: insert the DXF at 0,0 (never "specify on-screen"). Prospector > Surfaces > Create Surface (TIN) >
    Definition > Contours > Add; select polylines on CONTOUR-INDEX and CONTOUR-INTER. Z = elevation in feet. Freeze the DXF layers after.
 4. DEM as a surface: Create Surface (TIN) > Definition > DEM Files > Add > the .asc file; coordinate system UTM83-15F; elevations as-is.
    The .tif is UTM meters (UTM83-15) and Civil 3D does not convert its elevations, so prefer the .asc. Use 1 m cells for site scale.
 5. Check with ID on a contour vertex: E ~1.8-1.9 million ft, N ~17.0 million ft near Duluth, Z near the elevations reported on the site.
`;

let aoi = null; // { m: [xmin,ymin,xmax,ymax] in UTM meters, ft: [...] , lonlat: [[...]] }

export function initExport() {
  window.__nhExport = { setAoiFromLonLat: (b) => { setAoiFromLonLat(b); showTab(); renderPanel(); } };
  $("btn-export").addEventListener("click", () => { showTab(); if (!aoi) draw(); });
}
function showTab() {
  document.querySelectorAll(".tab").forEach((t) => { t.classList.toggle("on", t.dataset.tab === "export"); if (t.dataset.tab === "export") t.disabled = false; });
  document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("on", p.id === "tab-export"));
  $("panel").classList.add("open");
  if (window.matchMedia("(max-width: 900px)").matches && ($("panel").dataset.sheet || "peek") === "peek") $("panel").dataset.sheet = "half";
  if (!aoi) renderIntro();
}
function renderIntro() {
  $("tab-export").innerHTML = `<h2>Export for AutoCAD</h2>
    <div class="muted">Draw a rectangle on the map, then download aerial imagery, the lidar DEM and contours clipped to it, in NAD83 UTM zone 15N, US survey feet (Civil 3D UTM83-15F), elevations NAVD88 feet.</div>
    <div class="actions"><button class="btn primary" id="ex-draw">Draw area on map</button></div>
    <div class="small">Click one corner, then the opposite corner. Esc cancels. Keep the area under about 2 km on a side for 0.5 m data.</div>
    ${CAD_STEPS_HTML}`;
  $("ex-draw").onclick = draw;
}
function draw() {
  const msg = $("status-text"); const prev = msg.textContent;
  msg.textContent = "Click the first corner of the export area…";
  startRectDraw((bbox) => {
    msg.textContent = prev;
    if (!bbox) { if (!aoi) renderIntro(); return; }
    setAoiFromLonLat(bbox);
    renderPanel();
  }, () => { msg.textContent = "Now click the opposite corner…"; });
}
export function setAoiFromLonLat([w, s, e, n]) {
  const p = window.proj4;
  const corners = [[w, s], [e, s], [e, n], [w, n]].map((c) => p("WGS84", UTM15, c));
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  // axis-aligned in UTM, snapped to whole meters
  const m = [Math.floor(Math.min(...xs)), Math.floor(Math.min(...ys)), Math.ceil(Math.max(...xs)), Math.ceil(Math.max(...ys))];
  const ll = [[m[0], m[1]], [m[2], m[1]], [m[2], m[3]], [m[0], m[3]]].map((c) => p(UTM15, "WGS84", c));
  aoi = { m, ft: m.map((v) => v * FT), lonlat: ll, w: m[2] - m[0], h: m[3] - m[1] };
  setAoi({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...ll, ll[0]]] }, properties: {} });
}

function renderPanel() {
  const a = aoi;
  const acres = (a.w * a.h) / 4046.856;
  const auth = authState();
  const fname = `${(auth.projects?.[0] && false) || "aoi"}_${Math.round(a.m[0])}_${Math.round(a.m[1])}`;
  $("tab-export").innerHTML = `<h2>Export for AutoCAD</h2>
    <div class="muted">NAD83 UTM 15N, US survey feet · elevations NAVD88 ft · Civil 3D coordinate system <b>UTM83-15F</b></div>
    <div class="stat-row">
      <div class="stat"><div class="v">${fmtNum(a.w * FT)} × ${fmtNum(a.h * FT)}</div><div class="l">area, ft</div><div class="s">${fmtNum(a.w)} × ${fmtNum(a.h)} m · ${fmt(acres, 1)} ac</div></div>
      <div class="stat"><div class="v" style="font-size:13px">${fmtNum(a.ft[0], 1)}, ${fmtNum(a.ft[1], 1)}</div><div class="l">SW corner E, N (ft)</div><div class="s">NE ${fmtNum(a.ft[2], 1)}, ${fmtNum(a.ft[3], 1)}</div></div>
    </div>
    <div class="actions"><button class="btn" id="ex-redraw">Redraw area</button><button class="btn" id="ex-clear">Clear</button></div>
    ${a.w > 2500 || a.h > 2500 ? `<div class="notice">Large area. 0.5 m products are capped at 4,000 pixels a side; choose a coarser resolution or a smaller rectangle.</div>` : ""}
    <div class="form">
      <label>File name prefix<input id="ex-name" value="${escapeHtml(fname)}" /></label>
      <h3>Aerial imagery → JPG + JGW world file</h3>
      <div class="row2">
        <label>Source<select id="ex-img-src">${IMAGERY.map((i) => `<option value="${i.id}">${i.label}</option>`).join("")}</select></label>
        <label>Pixel size<select id="ex-img-res"><option value="0.3">0.3 m (1 ft)</option><option value="0.5" selected>0.5 m</option><option value="1">1 m</option></select></label>
      </div>
      <h3>Lidar DEM → GeoTIFF (m, EPSG 26915) + ASCII grid (ft)</h3>
      <div class="row2">
        <label>Generation<select id="ex-dem-gen"><option value="2">2nd gen 0.5 m (2021–24)</option><option value="1">1st gen 1 m (2008–12)</option></select></label>
        <label>Cell size<select id="ex-dem-res"><option value="0.5">0.5 m</option><option value="1" selected>1 m</option><option value="2">2 m</option></select></label>
      </div>
      <h3>Contours → DXF R12 (3D polylines, Z = elevation)</h3>
      <div class="row2">
        <label>Interval<select id="ex-ct-int"><option value="0.5">0.5 ft</option><option value="1" selected>1 ft</option><option value="2">2 ft</option><option value="5">5 ft</option></select></label>
        <label>From DEM cell size<select id="ex-ct-res"><option value="0.5">0.5 m</option><option value="1" selected>1 m</option><option value="2">2 m</option></select></label>
      </div>
      <label class="chk"><input type="checkbox" id="ex-inc-img" checked /> imagery</label>
      <label class="chk"><input type="checkbox" id="ex-inc-dem" checked /> DEM</label>
      <label class="chk"><input type="checkbox" id="ex-inc-ct" checked /> contours</label>
      <div class="actions"><button class="btn primary" id="ex-go">Build ZIP</button><span id="ex-msg" class="small"></span></div>
      <div id="ex-log" class="small"></div>
    </div>
    <div class="small">Imagery: MnGeo WMS (composite = most recent, highest-resolution available per area; FSA/NAIP by year). DEM: MnTOPO seamless lidar via MnGeo ImageServer, float32. Contours are generated here from the DEM (marching squares, light simplification) and are not an official product; index contours every 5th interval on layer CONTOUR-INDEX. A README in the ZIP repeats the coordinate-system details and the Civil 3D steps below.</div>
    ${CAD_STEPS_HTML}`;
  $("ex-redraw").onclick = draw;
  $("ex-clear").onclick = () => { aoi = null; setAoi(null); renderIntro(); };
  $("ex-go").onclick = build;
}

async function build() {
  const log = (t) => { $("ex-log").innerHTML += `<div>${escapeHtml(t)}</div>`; };
  $("ex-log").innerHTML = ""; $("ex-msg").textContent = "Working…";
  const btn = $("ex-go"); btn.disabled = true;
  try {
    await Promise.all([loadScript("https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js", "fflate"), loadScript("https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js", "GeoTIFF")]);
    const name = ($("ex-name").value.trim() || "aoi").replace(/[^A-Za-z0-9_-]+/g, "_");
    const files = {};
    const a = aoi;
    files[`${name}_README.txt`] = strToU8(readme(name));
    if ($("ex-inc-img").checked) {
      const src = IMAGERY.find((i) => i.id === $("ex-img-src").value); const res = Number($("ex-img-res").value);
      const { w, h } = dims(res, 8191);
      log(`Imagery: ${src.label}, ${w}×${h} px at ${res} m…`);
      const url = `${src.url}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${src.layer}&STYLES=&CRS=EPSG:26915&BBOX=${a.m.join(",")}&WIDTH=${w}&HEIGHT=${h}&FORMAT=image/jpeg`;
      const r = await fetch(url); if (!r.ok) throw new Error("imagery " + r.status);
      files[`${name}_${src.id}.jpg`] = new Uint8Array(await r.arrayBuffer());
      const rx = (a.w / w) * FT, ry = (a.h / h) * FT;
      files[`${name}_${src.id}.jgw`] = strToU8([rx.toFixed(6), 0, 0, (-ry).toFixed(6), (a.ft[0] + rx / 2).toFixed(4), (a.ft[3] - ry / 2).toFixed(4)].join("\n") + "\n");
      files[`${name}_${src.id}.prj`] = strToU8(PRJ_USFT);
      log(`  ok, ${(files[`${name}_${src.id}.jpg`].length / 1e6).toFixed(1)} MB`);
    }
    let demCache = {};
    const getDem = async (res, gen) => {
      const key = `${gen}-${res}`;
      if (demCache[key]) return demCache[key];
      const { w, h } = dims(res, 4000);
      log(`DEM: ${gen === "2" ? "2nd gen" : "1st gen"}, ${w}×${h} cells at ${res} m…`);
      const url = `${gen === "2" ? DEM2 : DEM1}?bbox=${a.m.join(",")}&bboxSR=26915&imageSR=26915&size=${w},${h}&format=tiff&pixelType=F32&noData=-9999&interpolation=RSP_BilinearInterpolation&f=image`;
      const r = await fetch(url); if (!r.ok) throw new Error("DEM " + r.status);
      const buf = await r.arrayBuffer();
      const tiff = await GeoTIFF.fromArrayBuffer(buf); const img = await tiff.getImage();
      const data = (await img.readRasters())[0];
      demCache[key] = { buf, data, w: img.getWidth(), h: img.getHeight(), res, origin: safe(() => img.getOrigin()), resolution: safe(() => img.getResolution()) };
      if (demCache[key].w !== w || demCache[key].h !== h) log(`  note: server returned ${demCache[key].w}×${demCache[key].h}`);
      log(`  ok, ${(buf.byteLength / 1e6).toFixed(1)} MB`);
      return demCache[key];
    };
    if ($("ex-inc-dem").checked) {
      const res = Number($("ex-dem-res").value), gen = $("ex-dem-gen").value;
      const d = await getDem(res, gen);
      files[`${name}_dem_${res}m_gen${gen}_utm15m.tif`] = new Uint8Array(d.buf);
      if (d.w * d.h <= 2.5e6) {
        files[`${name}_dem_${res}m_gen${gen}_utm15ft.asc`] = strToU8(asciiGrid(d));
      } else log("  ASCII grid skipped (over 2.5 M cells); use the GeoTIFF or a coarser cell size.");
    }
    if ($("ex-inc-ct").checked) {
      const res = Number($("ex-ct-res").value), interval = Number($("ex-ct-int").value), gen = $("ex-dem-gen").value;
      const d = await getDem(res, gen);
      log(`Contours at ${interval} ft from ${res} m cells…`);
      const t0 = performance.now();
      const { dxf, count, vertices } = contoursDxf(d, interval, name);
      files[`${name}_contours_${String(interval).replace(".", "p")}ft_utm15ft.dxf`] = strToU8(dxf);
      log(`  ${count.toLocaleString()} polylines, ${vertices.toLocaleString()} vertices, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    }
    window.__nhExport.last = { files, demCache };
    log("Zipping…");
    const zip = fflate.zipSync(files, { level: 1 });
    const blob = new Blob([zip], { type: "application/zip" });
    const aEl = document.createElement("a"); aEl.href = URL.createObjectURL(blob); aEl.download = `${name}_utm15ft.zip`; aEl.click();
    setTimeout(() => URL.revokeObjectURL(aEl.href), 5000);
    $("ex-msg").textContent = `Done: ${(blob.size / 1e6).toFixed(1)} MB`;
  } catch (e) { $("ex-msg").textContent = "Failed: " + e.message; console.error(e); }
  btn.disabled = false;
}

function dims(res, cap) {
  let w = Math.round(aoi.w / res), h = Math.round(aoi.h / res);
  const s = Math.max(w, h) / cap;
  if (s > 1) { w = Math.floor(w / s); h = Math.floor(h / s); }
  return { w: Math.max(1, w), h: Math.max(1, h) };
}
function readme(name) {
  const a = aoi;
  return `Northland Hydro AOI export: ${name}
Generated ${new Date().toISOString()} from https://northland.eco/

COORDINATE SYSTEM
  Horizontal: NAD83 UTM zone 15N, US survey feet (Civil 3D / Map 3D code UTM83-15F). 1 m = 3937/1200 ft.
  Vertical:   NAVD88, US survey feet.
  The GeoTIFF DEM is the exception: it is left as served, EPSG:26915 (meters) with meter elevations, so GIS software reads it natively.
  Assign UTM83-15F to the drawing; attach the JPG with its JGW world file; import the .asc grid or the DXF contours as a surface.

AREA (UTM 15N)
  meters: E ${a.m[0]}–${a.m[2]}, N ${a.m[1]}–${a.m[3]}  (${a.w} x ${a.h} m)
  feet:   E ${a.ft[0].toFixed(2)}–${a.ft[2].toFixed(2)}, N ${a.ft[1].toFixed(2)}–${a.ft[3].toFixed(2)}

${CAD_STEPS_TEXT}
SOURCES
  Imagery: MnGeo Geospatial Image Service (imageserver.gisdata.mn.gov), WMS GetMap in EPSG:26915.
  DEM: MnTOPO lidar via MnGeo ImageServer (enterprise.gisdata.mn.gov/agsimg), 2nd generation 0.5 m (2021-2024 3DEP) or 1st generation 1 m (2008-2012).
  Contours: generated in the browser from the DEM by marching squares with light simplification; not an official MnGeo product. Check against the 2 ft MnTOPO contours before relying on them.
`;
}
function asciiGrid(d) {
  const a = aoi; const cell = (a.w / d.w) * FT;
  const out = [`ncols ${d.w}`, `nrows ${d.h}`, `xllcorner ${a.ft[0].toFixed(4)}`, `yllcorner ${a.ft[1].toFixed(4)}`, `cellsize ${cell.toFixed(6)}`, `NODATA_value -9999`];
  const rows = new Array(d.h);
  for (let j = 0; j < d.h; j++) {
    const row = new Array(d.w);
    for (let i = 0; i < d.w; i++) { const v = d.data[j * d.w + i]; row[i] = v < -9000 || !isFinite(v) ? "-9999" : (v * FT).toFixed(2); }
    rows[j] = row.join(" ");
  }
  return out.join("\n") + "\n" + rows.join("\n") + "\n";
}

// ---- contours: marching squares on the DEM (feet), segments joined into polylines ----
function contoursDxf(d, interval, name) {
  const a = aoi; const { w, h } = d; const cx = a.w / w, cy = a.h / h; // meters per cell
  const z = new Float32Array(w * h);
  let zmin = Infinity, zmax = -Infinity;
  for (let k = 0; k < z.length; k++) { const v = d.data[k]; if (v < -9000 || !isFinite(v)) { z[k] = NaN; continue; } z[k] = v * FT; if (z[k] < zmin) zmin = z[k]; if (z[k] > zmax) zmax = z[k]; }
  const levels = [];
  for (let l = Math.ceil(zmin / interval) * interval; l <= zmax; l += interval) levels.push(Number(l.toFixed(4)));
  const px = (i) => a.ft[0] + i * cx * FT;            // grid x (cell edges) → ft; cell centers at i+0.5
  const py = (j) => a.ft[3] - j * cy * FT;            // row 0 = north
  const lines = []; let vertices = 0;
  for (const level of levels) {
    const segs = isolines(z, w, h, level);
    const polys = joinSegments(segs);
    for (let p of polys) {
      p = simplify(p, 0.25);
      const closed = p.length > 2 && Math.abs(p[0][0] - p[p.length - 1][0]) < 1e-6 && Math.abs(p[0][1] - p[p.length - 1][1]) < 1e-6;
      const pts = (closed ? p.slice(0, -1) : p).map(([i, j]) => [px(i + 0.5), py(j + 0.5)]);
      if (pts.length < 2) continue;
      vertices += pts.length;
      const idx = Math.round(level / interval) % 5 === 0;
      lines.push({ level, closed, pts, layer: idx ? "CONTOUR-INDEX" : "CONTOUR-INTER" });
    }
  }
  return { dxf: writeDxf(lines, name), count: lines.length, vertices };
}
// Returns segments [[x1,y1],[x2,y2]] in grid-cell coordinates (cell centers = integer indices)
function isolines(z, w, h, level) {
  const segs = [];
  const interp = (i1, j1, v1, i2, j2, v2) => { const t = (level - v1) / (v2 - v1); return [i1 + (i2 - i1) * t, j1 + (j2 - j1) * t]; };
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    const tl = z[j * w + i], tr = z[j * w + i + 1], br = z[(j + 1) * w + i + 1], bl = z[(j + 1) * w + i];
    if (isNaN(tl) || isNaN(tr) || isNaN(br) || isNaN(bl)) continue;
    const c = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
    if (c === 0 || c === 15) continue;
    const top = () => interp(i, j, tl, i + 1, j, tr), right = () => interp(i + 1, j, tr, i + 1, j + 1, br), bottom = () => interp(i, j + 1, bl, i + 1, j + 1, br), left = () => interp(i, j, tl, i, j + 1, bl);
    switch (c) {
      case 1: case 14: segs.push([left(), bottom()]); break;
      case 2: case 13: segs.push([bottom(), right()]); break;
      case 3: case 12: segs.push([left(), right()]); break;
      case 4: case 11: segs.push([top(), right()]); break;
      case 5: { const avg = (tl + tr + br + bl) / 4; if (avg >= level) { segs.push([left(), top()]); segs.push([bottom(), right()]); } else { segs.push([left(), bottom()]); segs.push([top(), right()]); } break; }
      case 6: case 9: segs.push([top(), bottom()]); break;
      case 7: case 8: segs.push([left(), top()]); break;
      case 10: { const avg = (tl + tr + br + bl) / 4; if (avg >= level) { segs.push([top(), right()]); segs.push([left(), bottom()]); } else { segs.push([left(), top()]); segs.push([bottom(), right()]); } break; }
    }
  }
  return segs;
}
function joinSegments(segs) {
  const key = (p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  const byStart = new Map(), byEnd = new Map();
  const polys = [];
  for (const [p, q] of segs) {
    const kp = key(p), kq = key(q);
    let A = byEnd.get(kp), B = byStart.get(kq);
    if (A && B && A !== B) {              // p continues A, q starts B → merge A + B
      byEnd.delete(kp); byStart.delete(kq); byStart.delete(key(A[0])); byEnd.delete(key(B[B.length - 1]));
      A.push(...B); B.length = 0; B.dead = true;
      byStart.set(key(A[0]), A); byEnd.set(key(A[A.length - 1]), A);
    } else if (A && A === B) {            // closes a ring
      byEnd.delete(kp); byStart.delete(kq); A.push(q);
      byStart.set(key(A[0]), A); byEnd.set(key(A[A.length - 1]), A);
    } else if (A) { byEnd.delete(kp); A.push(q); byEnd.set(kq, A); }
    else if (B) { byStart.delete(kq); B.unshift(p); byStart.set(kp, B); }
    else {
      const A2 = byEnd.get(kq), B2 = byStart.get(kp);   // reversed orientation
      if (A2 && !B2) { byEnd.delete(kq); A2.push(p); byEnd.set(kp, A2); }
      else if (B2 && !A2) { byStart.delete(kp); B2.unshift(q); byStart.set(kq, B2); }
      else { const P = [p, q]; polys.push(P); byStart.set(kp, P); byEnd.set(kq, P); }
    }
  }
  return polys.filter((p) => !p.dead && p.length > 1);
}
function simplify(pts, tol) { // Douglas–Peucker, tol in grid cells
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop(); let maxD = 0, idx = -1;
    const [x1, y1] = pts[s], [x2, y2] = pts[e]; const dx = x2 - x1, dy = y2 - y1; const L = Math.hypot(dx, dy) || 1e-9;
    for (let k = s + 1; k < e; k++) { const d = Math.abs(dy * pts[k][0] - dx * pts[k][1] + x2 * y1 - y2 * x1) / L; if (d > maxD) { maxD = d; idx = k; } }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, k) => keep[k]);
}
function writeDxf(lines, name) {
  // DXF R12 (AC1009): universally readable; contours as 3D POLYLINE/VERTEX with Z = elevation (ft).
  const a = aoi;
  const o = [];
  const add = (c, v) => { o.push(String(c), String(v)); };
  add(0, "SECTION"); add(2, "HEADER"); add(9, "$ACADVER"); add(1, "AC1009"); add(9, "$INSUNITS"); add(70, 21);
  add(9, "$EXTMIN"); add(10, a.ft[0].toFixed(3)); add(20, a.ft[1].toFixed(3)); add(30, 0); add(9, "$EXTMAX"); add(10, a.ft[2].toFixed(3)); add(20, a.ft[3].toFixed(3)); add(30, 0);
  add(0, "ENDSEC");
  add(0, "SECTION"); add(2, "TABLES"); add(0, "TABLE"); add(2, "LAYER"); add(70, 3);
  for (const [ln, color] of [["CONTOUR-INDEX", 30], ["CONTOUR-INTER", 8], ["AOI-BOUNDARY", 1]]) { add(0, "LAYER"); add(2, ln); add(70, 0); add(62, color); add(6, "CONTINUOUS"); }
  add(0, "ENDTAB"); add(0, "ENDSEC");
  add(0, "SECTION"); add(2, "ENTITIES");
  const poly = (layer, pts, z, closed) => {
    add(0, "POLYLINE"); add(8, layer); add(66, 1); add(10, 0); add(20, 0); add(30, 0); add(70, (closed ? 1 : 0) | 8);
    for (const [x, y] of pts) { add(0, "VERTEX"); add(8, layer); add(10, x.toFixed(3)); add(20, y.toFixed(3)); add(30, z.toFixed(3)); add(70, 32); }
    add(0, "SEQEND"); add(8, layer);
  };
  for (const l of lines) poly(l.layer, l.pts, l.level, l.closed);
  poly("AOI-BOUNDARY", [[a.ft[0], a.ft[1]], [a.ft[2], a.ft[1]], [a.ft[2], a.ft[3]], [a.ft[0], a.ft[3]]], 0, true);
  add(0, "TEXT"); add(8, "AOI-BOUNDARY"); add(10, a.ft[0].toFixed(3)); add(20, (a.ft[3] + 20).toFixed(3)); add(30, 0); add(40, 10); add(1, `${name} - NAD83 UTM 15N US ft, NAVD88 ft - Northland Hydro ${new Date().toISOString().slice(0, 10)}`);
  add(0, "ENDSEC"); add(0, "EOF");
  return o.join("\r\n") + "\r\n";
}
function safe(fn) { try { return fn(); } catch { return null; } }
function strToU8(s) { return new TextEncoder().encode(s); }
function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("failed to load " + src)); document.head.appendChild(s); });
}
