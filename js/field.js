// Field notes on this device: GPS points (averaged fixes), route tracks (start/stop, screen kept awake), and geotagged
// photos (location and compass direction read from the photo's EXIF, e.g. Solocator). Everything is kept in this
// browser's IndexedDB (nothing leaves the phone) and exports to Google Earth (KMZ with photos), GPX, CSV and Civil 3D
// (PNEZD points, DXF in UTM 15N NAD83 US survey feet with lidar ground elevations, NAVD88).
import { $, escapeHtml, fmt, fmtNum, haversineKm, on } from "./util.js";
import { map, setPickMode } from "./map.js";
import { showTab } from "./panels.js";
import { toUtm, utmFeet, FT_PER_M } from "./coords.js";
import { pointElevation } from "./elevation.js";

// ---------- storage (IndexedDB) ----------
let dbp = null;
function db() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open("nh-field", 1);
    r.onupgradeneeded = () => { const d = r.result; for (const s of ["items", "blobs"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: "id" }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
async function store(name, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(name, mode); const s = t.objectStore(name); const out = fn(s); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => rej(t.error); });
}
const put = (name, v) => store(name, "readwrite", (s) => s.put(v));
const del = (name, id) => store(name, "readwrite", (s) => s.delete(id));
const all = (name) => store(name, "readonly", (s) => s.getAll());
const get = (name, id) => store(name, "readonly", (s) => s.get(id));

let items = []; const thumbs = {}; // id → object URL
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
async function save(it) { const i = items.findIndex((x) => x.id === it.id); if (i >= 0) items[i] = it; else items.push(it); await put("items", it); draw(); render(); askPersist(); }
async function remove(id) { items = items.filter((x) => x.id !== id); await del("items", id); await del("blobs", id).catch(() => {}); if (thumbs[id]) { URL.revokeObjectURL(thumbs[id]); delete thumbs[id]; } draw(); render(); }
let persistAsked = false;
function askPersist() { if (persistAsked) return; persistAsked = true; navigator.storage?.persist?.().catch(() => {}); }

// ---------- map ----------
const EMPTY = { type: "FeatureCollection", features: [] };
function fc() {
  const f = [];
  for (const it of items) {
    if (it.type === "track") { const segs = (it.segs || []).filter((s) => s.length > 1); if (segs.length) f.push({ type: "Feature", geometry: { type: "MultiLineString", coordinates: segs.map((s) => s.map((p) => [p[0], p[1]])) }, properties: { id: it.id, kind: "track", popup: popupFor(it) } }); }
    else if (it.lon != null) f.push({ type: "Feature", geometry: { type: "Point", coordinates: [it.lon, it.lat] }, properties: { id: it.id, kind: it.type, popup: popupFor(it) } });
  }
  return { type: "FeatureCollection", features: f };
}
function popupFor(it) {
  const when = new Date(it.t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  if (it.type === "photo") return `<div class="popup-title">📷 ${escapeHtml(it.name)}</div>${thumbs[it.id] ? `<img src="${thumbs[it.id]}" style="width:100%;max-width:220px;border-radius:4px;display:block;margin:4px 0">` : ""}<div class="popup-sub">${when}${it.dir != null ? ` · facing ${Math.round(it.dir)}°` : ""}${it.note ? " · " + escapeHtml(it.note) : ""}</div>`;
  if (it.type === "track") return `<div class="popup-title">〰 ${escapeHtml(it.name)}</div><div class="popup-sub">${when} · ${fmt(trackLen(it) / 1609.344, 2)} mi${it.note ? " · " + escapeHtml(it.note) : ""}</div>`;
  return `<div class="popup-title">📍 ${escapeHtml(it.name)}</div><div class="popup-sub">${when}${it.acc ? ` · GPS ±${fmtNum(it.acc * 3.281)} ft` : ""}${it.note ? " · " + escapeHtml(it.note) : ""}</div>`;
}
function ensureLayers() {
  if (!map?.getStyle()) return;
  if (!map.getSource("field")) {
    map.addSource("field", { type: "geojson", data: fc() });
    map.addSource("field-live", { type: "geojson", data: EMPTY });
    map.addLayer({ id: "field-trk", type: "line", source: "field", filter: ["==", ["get", "kind"], "track"], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#f43f5e", "line-width": 3, "line-opacity": 0.9 } });
    map.addLayer({ id: "field-live-line", type: "line", source: "field-live", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#f43f5e", "line-width": 4, "line-dasharray": [1, 1.5] } });
    map.addLayer({ id: "field-pts", type: "circle", source: "field", filter: ["==", ["get", "kind"], "point"], paint: { "circle-radius": 7, "circle-color": "#facc15", "circle-stroke-color": "#111", "circle-stroke-width": 2 } });
    map.addLayer({ id: "field-photo", type: "circle", source: "field", filter: ["==", ["get", "kind"], "photo"], paint: { "circle-radius": 7, "circle-color": "#a855f7", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
  } else draw();
}
function draw() { map?.getSource("field")?.setData(fc()); }

// ---------- points: averaged GPS fix ----------
function averagedFix(seconds = 8, good = 4, onProgress = () => {}) {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("this browser has no location support"));
    const fixes = []; const t0 = Date.now(); let done = false;
    const finish = () => {
      if (done) return; done = true; navigator.geolocation.clearWatch(w); clearTimeout(timer);
      if (!fixes.length) return rej(new Error("no GPS fix; check that location is allowed for northland.eco"));
      const best = Math.min(...fixes.map((f) => f.acc)); const use = fixes.filter((f) => f.acc <= best * 2); // drop outliers
      let sw = 0, x = 0, y = 0, z = 0, zw = 0; for (const f of use) { const w = 1 / Math.max(1, f.acc) ** 2; sw += w; x += f.lon * w; y += f.lat * w; if (f.alt != null) { z += f.alt * w; zw += w; } }
      res({ lon: x / sw, lat: y / sw, alt: zw ? z / zw : null, acc: best, n: use.length /* phone GPS errors are correlated, so averaging does not shrink the stated accuracy */ });
    };
    const w = navigator.geolocation.watchPosition((p) => {
      fixes.push({ lon: p.coords.longitude, lat: p.coords.latitude, acc: p.coords.accuracy, alt: p.coords.altitude });
      onProgress(fixes.length, Math.min(...fixes.map((f) => f.acc)), (Date.now() - t0) / 1000);
      if (fixes.length >= 3 && Math.min(...fixes.map((f) => f.acc)) <= good) finish();
    }, (e) => { if (!fixes.length) { done = true; navigator.geolocation.clearWatch(w); clearTimeout(timer); rej(new Error(e.code === 1 ? "location is blocked for this site; allow it from the lock icon in the address bar" : e.message)); } }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    const timer = setTimeout(finish, seconds * 1000);
  });
}
const nextName = (type, prefix) => `${prefix}${items.filter((i) => i.type === type).length + 1}`;
async function dropPointHere() {
  msg("Averaging GPS fixes…");
  try {
    const f = await averagedFix(8, 4, (n, best, s) => msg(`Averaging GPS: ${n} fixes, best ±${fmtNum(best * 3.281)} ft (${Math.round(s)} s)…`));
    const it = { id: uid(), type: "point", name: nextName("point", "P"), note: "", t: Date.now(), lon: f.lon, lat: f.lat, acc: f.acc, alt: f.alt, src: `GPS, ${f.n} fixes averaged` };
    await save(it); map.easeTo({ center: [f.lon, f.lat], zoom: Math.max(map.getZoom(), 16) }); msg(`Saved ${it.name} (±${fmtNum(f.acc * 3.281)} ft).`);
  } catch (e) { msg("Could not get a position: " + e.message, true); }
}
function tapToPlace(existing) {
  msg(existing ? `Tap the map where "${existing.name}" was taken.` : "Tap the map to place a point.");
  peek(); pickMsg = existing ? `Tap where ${existing.name} was taken` : "Tap the map to place a point"; banner();
  setPickMode(async ({ lon, lat }) => {
    pickMsg = null; banner();
    if (existing) { existing.lon = lon; existing.lat = lat; existing.placed = "by hand"; await save(existing); msg(`Placed ${existing.name}.`); }
    else { const it = { id: uid(), type: "point", name: nextName("point", "P"), note: "", t: Date.now(), lon, lat, acc: null, src: "placed on the map" }; await save(it); msg(`Saved ${it.name}.`); }
    showTab("field");
  });
}

// ---------- tracks ----------
let rec = null; // { it, watch, lock, last }
const trackLen = (it) => (it.segs || []).reduce((sum, s) => { let d = 0; for (let i = 1; i < s.length; i++) d += haversineKm(s[i - 1][1], s[i - 1][0], s[i][1], s[i][0]) * 1000; return sum + d; }, 0);
function trackArea(it) { // acres, only when the track ends within 30 m of its start (a walked boundary)
  const pts = (it.segs || []).flat(); if (pts.length < 4) return null;
  const a = pts[0], b = pts[pts.length - 1]; if (haversineKm(a[1], a[0], b[1], b[0]) * 1000 > 30) return null;
  const u = pts.map((p) => toUtm(p[0], p[1])); let s = 0; for (let i = 0; i < u.length; i++) { const [x1, y1] = u[i], [x2, y2] = u[(i + 1) % u.length]; s += x1 * y2 - x2 * y1; }
  return Math.abs(s) / 2 / 4046.856;
}
async function wake() { try { rec.lock = await navigator.wakeLock?.request("screen"); } catch { rec.lock = null; } }
async function startTrack(resumeId) {
  if (rec) return;
  if (!navigator.geolocation) { msg("This browser has no location support.", true); return; }
  const it = resumeId ? items.find((i) => i.id === resumeId) : { id: uid(), type: "track", name: nextName("track", "Track "), note: "", t: Date.now(), segs: [] };
  it.segs.push([]); it.open = true; await save(it);
  rec = { it, last: null, tick: setInterval(() => banner(), 30000) };
  await wake();
  rec.watch = navigator.geolocation.watchPosition(async (p) => {
    if (!rec) return; const c = p.coords; if (c.accuracy > 50) { msg(`Waiting for a better GPS fix (±${fmtNum(c.accuracy * 3.281)} ft)…`); return; }
    const pt = [+c.longitude.toFixed(7), +c.latitude.toFixed(7), p.timestamp, Math.round(c.accuracy * 10) / 10, c.altitude != null ? Math.round(c.altitude * 10) / 10 : null];
    const seg = rec.it.segs[rec.it.segs.length - 1]; const prev = seg[seg.length - 1];
    if (prev && p.timestamp - prev[2] > 60000) rec.it.segs.push([pt]); // gap (screen off / app switched): start a new segment
    else if (!prev || haversineKm(prev[1], prev[0], pt[1], pt[0]) * 1000 >= Math.max(3, c.accuracy / 2)) seg.push(pt); else return;
    rec.last = pt; await put("items", rec.it); liveDraw(); render(); banner(); map.easeTo({ center: [pt[0], pt[1]], duration: 400 });
  }, (e) => msg("GPS error: " + (e.code === 1 ? "location is blocked for this site" : e.message), true), { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  document.addEventListener("visibilitychange", onVis);
  banner(); msg("Recording. Keep this page open with the screen on; if the phone locks, the track pauses and resumes when you return.");
  render();
}
function onVis() { if (rec && document.visibilityState === "visible") wake(); }
async function stopTrack() {
  if (!rec) return; navigator.geolocation.clearWatch(rec.watch); clearInterval(rec.tick); try { await rec.lock?.release(); } catch {}
  document.removeEventListener("visibilitychange", onVis);
  const it = rec.it; rec = null; banner(); it.segs = it.segs.filter((s) => s.length); it.open = false;
  if (!it.segs.length) { await remove(it.id); msg("No GPS points recorded; track discarded."); return; }
  await save(it); map.getSource("field-live")?.setData(EMPTY);
  const ac = trackArea(it); msg(`Saved ${it.name}: ${fmt(trackLen(it) / 1609.344, 2)} mi${ac ? `, encloses ${fmt(ac, 2)} ac` : ""}.`);
}
function liveDraw() { if (!rec) return; map.getSource("field-live")?.setData({ type: "FeatureCollection", features: rec.it.segs.filter((s) => s.length > 1).map((s) => ({ type: "Feature", geometry: { type: "LineString", coordinates: s.map((p) => [p[0], p[1]]) }, properties: {} })) }); draw(); }

// ---------- photos ----------
function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("failed to load " + src)); document.head.appendChild(s); });
}
async function resized(file, max) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height)); const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, "image/jpeg", max > 400 ? 0.85 : 0.7));
}
async function addPhotos(files) {
  if (!files?.length) return;
  await loadScript("https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.js", "exifr");
  let placed = 0, missing = 0;
  for (const [i, file] of [...files].entries()) {
    msg(`Reading photo ${i + 1} of ${files.length}…`);
    let ex = null; try { ex = await exifr.parse(file, { gps: true, exif: true, tiff: true, xmp: false, icc: false, iptc: false }) /* no `pick`: it stops exifr deriving latitude/longitude */; } catch { ex = null; }
    const [full, thumb] = await Promise.all([resized(file, 1600), resized(file, 360)]);
    const t = (ex?.DateTimeOriginal || ex?.CreateDate || new Date(file.lastModified)).valueOf();
    const it = { id: uid(), type: "photo", name: file.name.replace(/\.[^.]+$/, ""), file: file.name.replace(/\.[^.]+$/, "") + ".jpg", note: "", t,
      lon: ex?.longitude ?? null, lat: ex?.latitude ?? null, alt: ex?.GPSAltitude ?? null, dir: ex?.GPSImgDirection ?? null, src: ex?.latitude != null ? "photo GPS (EXIF)" : null };
    await put("blobs", { id: it.id, full, thumb }); thumbs[it.id] = URL.createObjectURL(thumb);
    await save(it); if (it.lon != null) placed++; else missing++;
  }
  const withLoc = items.filter((i) => i.type === "photo" && i.lon != null);
  if (placed) { const b = withLoc.slice(-placed); const xs = b.map((i) => i.lon), ys = b.map((i) => i.lat); map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 17 }); }
  msg(`${placed} photo${placed === 1 ? "" : "s"} placed from their GPS tags${missing ? `; ${missing} had no location (the phone may have removed it when sharing; on iPhone, pick them through Files instead of Photos, or use "Place on map")` : ""}.`, !!missing);
}

// ---------- exports ----------
const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");
function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
const xml = (s) => String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
const iso = (t) => new Date(t).toISOString();
const c7 = (v) => (+v).toFixed(7);
async function withElevations() { // lidar ground elevation (NAVD88 ft) for points and photos, fetched once and kept
  const need = items.filter((i) => i.type !== "track" && i.lon != null && i.elevFt == null);
  for (let k = 0; k < need.length; k += 4) await Promise.all(need.slice(k, k + 4).map(async (it) => { const e = await pointElevation(it.lon, it.lat).catch(() => null); if (e) { it.elevFt = Math.round(e.ft * 100) / 100; it.elevSrc = e.src; await put("items", it); } }));
}
function kml(photoPath) {
  const pts = items.filter((i) => i.type === "point" && i.lon != null), trks = items.filter((i) => i.type === "track"), phs = items.filter((i) => i.type === "photo" && i.lon != null);
  const pm = (it, inner, extra = "") => `<Placemark><name>${xml(it.name)}</name><TimeStamp><when>${iso(it.t)}</when></TimeStamp>${extra}${inner}</Placemark>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Northland Eco field notes ${stamp()}</name>
<Style id="pt"><IconStyle><color>ff15ccfa</color><Icon><href>http://maps.google.com/mapfiles/kml/paddle/ylw-circle.png</href></Icon></IconStyle></Style>
<Style id="ph"><IconStyle><color>fff755a8</color><Icon><href>http://maps.google.com/mapfiles/kml/shapes/camera.png</href></Icon></IconStyle></Style>
<Style id="tk"><LineStyle><color>ff5e3ff4</color><width>3</width></LineStyle></Style>
<Folder><name>Points</name>${pts.map((it) => pm(it, `<Point><coordinates>${c7(it.lon)},${c7(it.lat)}</coordinates></Point>`, `<styleUrl>#pt</styleUrl><description>${xml([it.note, it.acc ? `GPS ±${Math.round(it.acc * 3.281)} ft` : it.src, it.elevFt != null ? `ground ${it.elevFt} ft NAVD88 (lidar)` : ""].filter(Boolean).join(" · "))}</description>`)).join("\n")}</Folder>
<Folder><name>Tracks</name>${trks.map((it) => pm(it, `<MultiGeometry>${it.segs.filter((s) => s.length > 1).map((s) => `<LineString><tessellate>1</tessellate><coordinates>${s.map((p) => `${p[0]},${p[1]}`).join(" ")}</coordinates></LineString>`).join("")}</MultiGeometry>`, `<styleUrl>#tk</styleUrl><description>${xml(`${fmt(trackLen(it) / 1609.344, 2)} mi${trackArea(it) ? `, encloses ${fmt(trackArea(it), 2)} ac` : ""}${it.note ? " · " + it.note : ""}`)}</description>`)).join("\n")}</Folder>
<Folder><name>Photos</name>${phs.map((it) => pm(it, `<Point><coordinates>${c7(it.lon)},${c7(it.lat)}</coordinates></Point>`, `<styleUrl>#ph</styleUrl><description><![CDATA[${photoPath ? `<img src="${photoPath}${it.file}" width="480"/><br/>` : ""}${xml([it.note, it.dir != null ? `facing ${Math.round(it.dir)}°` : "", it.file].filter(Boolean).join(" · "))}]]></description>`)).join("\n")}</Folder>
</Document></kml>`;
}
async function exportKmz() {
  msg("Building Google Earth file…"); await withElevations();
  await loadScript("https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js", "fflate");
  const files = { "doc.kml": fflate.strToU8(kml("files/")) };
  for (const it of items.filter((i) => i.type === "photo" && i.lon != null)) { const b = await get("blobs", it.id); if (b?.full) files[`files/${it.file}`] = new Uint8Array(await b.full.arrayBuffer()); }
  download(new Blob([fflate.zipSync(files, { level: 0 })], { type: "application/vnd.google-earth.kmz" }), `northland-field-${stamp()}.kmz`); exported();
}
async function exportGpx() {
  await withElevations();
  const wpt = items.filter((i) => i.type !== "track" && i.lon != null).map((it) => `<wpt lat="${c7(it.lat)}" lon="${c7(it.lon)}">${it.elevFt != null ? `<ele>${(it.elevFt / FT_PER_M).toFixed(2)}</ele>` : ""}<time>${iso(it.t)}</time><name>${xml(it.name)}</name><desc>${xml([it.type === "photo" ? "photo " + it.file : "", it.note].filter(Boolean).join(" · "))}</desc></wpt>`).join("\n");
  const trk = items.filter((i) => i.type === "track").map((it) => `<trk><name>${xml(it.name)}</name>${it.segs.map((s) => `<trkseg>${s.map((p) => `<trkpt lat="${p[1]}" lon="${p[0]}">${p[4] != null ? `<ele>${p[4]}</ele>` : ""}<time>${iso(p[2])}</time></trkpt>`).join("")}</trkseg>`).join("")}</trk>`).join("\n");
  download(new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Northland Eco" xmlns="http://www.topografix.com/GPX/1/1">\n${wpt}\n${trk}\n</gpx>`], { type: "application/gpx+xml" }), `northland-field-${stamp()}.gpx`); exported();
}
function rowsForCad() {
  let n = 1; return items.filter((i) => i.type !== "track" && i.lon != null).map((it) => { const f = utmFeet(it.lon, it.lat); return { n: n++, it, N: f.n, E: f.e }; });
}
async function exportCsv() {
  await withElevations();
  const head = ["Point", "Northing_USft", "Easting_USft", "Elev_ft_NAVD88_lidar", "Description", "Type", "Latitude", "Longitude", "Time", "GPS_accuracy_ft", "Note", "Photo_file", "Facing_deg"];
  const rows = rowsForCad().map(({ n, it, N, E }) => [n, N.toFixed(2), E.toFixed(2), it.elevFt ?? "", it.name, it.type, it.lat.toFixed(7), it.lon.toFixed(7), iso(it.t), it.acc ? (it.acc * 3.281).toFixed(1) : "", it.note || "", it.type === "photo" ? it.file : "", it.dir != null ? Math.round(it.dir) : ""]);
  const trk = items.filter((i) => i.type === "track").flatMap((it) => it.segs.flatMap((s, si) => s.map((p, pi) => { const f = utmFeet(p[0], p[1]); return [`${it.name}.${si + 1}.${pi + 1}`, f.n.toFixed(2), f.e.toFixed(2), "", it.name, "track vertex", p[1], p[0], iso(p[2]), (p[3] * 3.281).toFixed(1), "", "", ""]; })));
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  download(new Blob([[head, ...rows, ...trk].map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv" }), `northland-field-${stamp()}_utm15n_usft.csv`); exported();
}
async function exportCad() { // Civil 3D: PNEZD points (comma delimited) + DXF of points, labels and track polylines, UTM 15N NAD83 US ft
  msg("Building CAD files (lidar elevations)…"); await withElevations();
  const pts = rowsForCad();
  const pnezd = pts.map(({ n, it, N, E }) => [n, N.toFixed(3), E.toFixed(3), it.elevFt != null ? it.elevFt.toFixed(2) : "0", `${it.name}${it.note ? " " + it.note : ""}`.replace(/,/g, " ")].join(",")).join("\r\n");
  const L = []; const g = (c, v) => L.push(String(c), String(v));
  g(0, "SECTION"); g(2, "ENTITIES");
  for (const { it, N, E } of pts) { const lay = it.type === "photo" ? "FIELD_PHOTOS" : "FIELD_POINTS"; const z = it.elevFt ?? 0;
    g(0, "POINT"); g(8, lay); g(10, E.toFixed(3)); g(20, N.toFixed(3)); g(30, z.toFixed(2));
    g(0, "TEXT"); g(8, lay); g(10, (E + 3).toFixed(3)); g(20, (N + 3).toFixed(3)); g(30, z.toFixed(2)); g(40, "4"); g(1, it.name.replace(/\n/g, " ")); }
  for (const it of items.filter((i) => i.type === "track")) for (const s of it.segs.filter((x) => x.length > 1)) {
    g(0, "POLYLINE"); g(8, "FIELD_TRACKS"); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, 0);
    for (const p of s) { const f = utmFeet(p[0], p[1]); g(0, "VERTEX"); g(8, "FIELD_TRACKS"); g(10, f.e.toFixed(3)); g(20, f.n.toFixed(3)); g(30, 0); }
    g(0, "SEQEND"); g(8, "FIELD_TRACKS"); }
  g(0, "ENDSEC"); g(0, "EOF");
  await loadScript("https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js", "fflate");
  const readme = `Northland Eco field notes, ${new Date().toLocaleString()}\r\nCoordinate system: NAD83 UTM zone 15N, US survey feet (EPSG:26915 in US ft; AutoCAD/Civil 3D: UTM83-15F).\r\nElevations: ground from MnTOPO lidar (NAVD88 ft) at each point; 0 where no lidar was available. Track vertices are 2D.\r\nfield_points_PNEZD.csv: Civil 3D point import format "PNEZD (comma delimited)".\r\nfield.dxf: layers FIELD_POINTS, FIELD_PHOTOS (points + labels) and FIELD_TRACKS (polylines). Insert at 0,0, scale 1.\r\nGPS positions are phone-grade (accuracy recorded per point in the CSV export); not survey control.\r\n`;
  download(new Blob([fflate.zipSync({ "field_points_PNEZD.csv": fflate.strToU8(pnezd), "field.dxf": fflate.strToU8(L.join("\r\n")), "README.txt": fflate.strToU8(readme) })], { type: "application/zip" }), `northland-field-${stamp()}_cad_utm15n_usft.zip`); exported();
}
function exported() { try { localStorage.setItem("nh-field-exported", String(Date.now())); } catch {} msg("Exported. Keep the file; the notes also stay on this device until you delete them."); render(); }

// ---------- panel ----------
let lastMsg = "", lastErr = false;
function msg(t, err = false) { lastMsg = t; lastErr = err; const el = $("fd-msg"); if (el) { el.textContent = t; el.className = "small" + (err ? " fd-err" : ""); } }
function render() {
  const c = $("tab-field"); if (!c) return;
  const pts = items.filter((i) => i.type === "point"), trks = items.filter((i) => i.type === "track"), phs = items.filter((i) => i.type === "photo");
  let exp = null; try { exp = Number(localStorage.getItem("nh-field-exported")) || null; } catch {}
  const dur = rec ? Math.round((Date.now() - rec.it.t) / 60000) : 0;
  const row = (it) => `<div class="fd-row" data-id="${it.id}">
      ${it.type === "photo" && thumbs[it.id] ? `<img class="fd-thumb" src="${thumbs[it.id]}" alt="">` : `<span class="fd-ico">${it.type === "track" ? "〰" : "📍"}</span>`}
      <div class="fd-main"><input class="fd-name" value="${escapeHtml(it.name)}" aria-label="Name">
        <div class="small">${new Date(it.t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${it.type === "track" ? ` · ${fmt(trackLen(it) / 1609.344, 2)} mi${trackArea(it) ? ` · ${fmt(trackArea(it), 2)} ac enclosed` : ""}${it.segs.length > 1 ? ` · ${it.segs.length} segments` : ""}` : it.lon != null ? ` · ${it.lat.toFixed(5)}, ${it.lon.toFixed(5)}${it.acc ? ` · ±${fmtNum(it.acc * 3.281)} ft` : ""}${it.dir != null ? ` · facing ${Math.round(it.dir)}°` : ""}` : ` · <b>no location</b>`}</div>
        <input class="fd-note" value="${escapeHtml(it.note || "")}" placeholder="note" aria-label="Note"></div>
      <div class="fd-btns">${it.lon != null || it.type === "track" ? `<button class="chip fd-go" title="Show on map">Map</button>` : `<button class="chip fd-place" title="Place on map">Place</button>`}${it.type === "track" && !rec ? `<button class="chip fd-resume" title="Continue recording this track">▶</button>` : ""}<button class="chip fd-del" title="Delete">✕</button></div></div>`;
  c.innerHTML = `<h2>Field notes</h2>
    <div class="small">Saved on this device only; nothing is uploaded. Export to Google Earth, GPX or CAD when you are back. ${/iPhone|iPad/.test(navigator.userAgent) ? "On iPhone, add northland.eco to the Home Screen (Share → Add to Home Screen) so Safari does not clear these after a week unused." : ""}</div>
    <div class="fd-actions">
      <button class="btn primary" id="fd-here">📍 Point at my location</button>
      <button class="btn" id="fd-tap">✚ Tap to add point</button>
      ${rec ? `<button class="btn fd-rec" id="fd-stop">■ Stop track</button>` : `<button class="btn" id="fd-start">● Start track</button>`}
      <label class="btn" for="fd-files">📷 Add photos</label><input type="file" id="fd-files" accept="image/*" multiple hidden>
    </div>
    ${rec ? `<div class="notice fd-live">Recording <b>${escapeHtml(rec.it.name)}</b>: ${fmt(trackLen(rec.it) / 1609.344, 2)} mi · ${dur} min · ${rec.it.segs.reduce((n, s) => n + s.length, 0)} fixes${rec.last ? ` · ±${fmtNum(rec.last[3] * 3.281)} ft` : " · waiting for GPS"}. Keep the screen on.</div>` : ""}
    <div id="fd-msg" class="small${lastErr ? " fd-err" : ""}">${escapeHtml(lastMsg)}</div>
    ${items.length ? `<h3>Export</h3><div class="fd-actions">
      <button class="btn" id="fd-kmz" title="Points, tracks and photos (photos embedded)">Google Earth (KMZ)</button>
      <button class="btn" id="fd-cad" title="Civil 3D PNEZD points + DXF, UTM 15N NAD83 US ft, lidar elevations">CAD (UTM 15N US ft)</button>
      <button class="btn" id="fd-csv" title="Every point, photo and track vertex with UTM ft and lat/lon">CSV</button>
      <button class="btn" id="fd-gpx">GPX</button></div>
      <div class="small">${exp ? `Last export ${new Date(exp).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.` : "Not exported yet."}</div>` : ""}
    ${pts.length ? `<h3>Points (${pts.length})</h3>${pts.map(row).join("")}` : ""}
    ${trks.length ? `<h3>Tracks (${trks.length})</h3>${trks.map(row).join("")}` : ""}
    ${phs.length ? `<h3>Photos (${phs.length})</h3>${phs.map(row).join("")}` : ""}
    ${items.length ? `<div class="fd-actions" style="margin-top:12px"><button class="btn" id="fd-clear">Delete all field notes…</button></div>` : `<div class="hint">Drop a point, record a track while walking a site, or add photos from your gallery. Solocator photos carry location and compass direction; they appear as purple dots.</div>`}`;
  $("fd-here").onclick = dropPointHere; $("fd-tap").onclick = () => tapToPlace(null);
  $("fd-start")?.addEventListener("click", () => startTrack()); $("fd-stop")?.addEventListener("click", stopTrack);
  $("fd-files").onchange = (e) => addPhotos(e.target.files).catch((err) => msg("Photos failed: " + err.message, true)).finally(() => (e.target.value = ""));
  $("fd-kmz")?.addEventListener("click", () => exportKmz().catch((e) => msg("Export failed: " + e.message, true)));
  $("fd-cad")?.addEventListener("click", () => exportCad().catch((e) => msg("Export failed: " + e.message, true)));
  $("fd-csv")?.addEventListener("click", () => exportCsv().catch((e) => msg("Export failed: " + e.message, true)));
  $("fd-gpx")?.addEventListener("click", () => exportGpx().catch((e) => msg("Export failed: " + e.message, true)));
  $("fd-clear")?.addEventListener("click", async () => { if (!confirm(`Delete all ${items.length} field notes from this device? Export first if you need them.`)) return; for (const it of [...items]) await remove(it.id); msg("All field notes deleted."); });
  c.querySelectorAll(".fd-row").forEach((r) => {
    const it = items.find((i) => i.id === r.dataset.id); if (!it) return;
    r.querySelector(".fd-name").onchange = (e) => { it.name = e.target.value.trim() || it.name; save(it); };
    r.querySelector(".fd-note").onchange = (e) => { it.note = e.target.value.trim(); save(it); };
    r.querySelector(".fd-del").onclick = () => { if (confirm(`Delete ${it.name}?`)) remove(it.id); };
    r.querySelector(".fd-place")?.addEventListener("click", () => tapToPlace(it));
    r.querySelector(".fd-resume")?.addEventListener("click", () => startTrack(it.id));
    r.querySelector(".fd-go")?.addEventListener("click", () => zoomTo(it));
    r.querySelector(".fd-thumb")?.addEventListener("click", () => viewPhoto(it.id));
  });
}
function zoomTo(it) {
  if (it.type === "track") { const p = it.segs.flat(); if (!p.length) return; const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]); map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 18 }); }
  else map.easeTo({ center: [it.lon, it.lat], zoom: Math.max(map.getZoom(), 17) });
  peek();
}
// Banner over the map: pick-mode instructions and live recording status stay visible when the sheet is collapsed
let pickMsg = null;
function banner() {
  let b = $("fd-banner");
  const text = pickMsg ? `✚ ${pickMsg}` : rec ? `● Recording ${escapeHtml(rec.it.name)} · ${fmt(trackLen(rec.it) / 1609.344, 2)} mi · ${Math.round((Date.now() - rec.it.t) / 60000)} min` : null;
  if (!text) { b?.remove(); return; }
  if (!b) { b = document.createElement("button"); b.id = "fd-banner"; b.type = "button"; document.getElementById("map").append(b);
    b.onclick = () => { if (pickMsg) { pickMsg = null; setPickMode(null); banner(); msg("Placing cancelled."); } openField(); }; }
  b.className = rec && !pickMsg ? "rec" : ""; b.innerHTML = text + (pickMsg ? " <span>· cancel</span>" : "");
}
function peek() { if (!window.matchMedia("(max-width: 900px)").matches) return; const p = $("panel"); p.dataset.sheet = "peek"; p.style.height = ""; p.classList.remove("open"); }
async function viewPhoto(id) {
  const b = await get("blobs", id); if (!b?.full) return; const url = URL.createObjectURL(b.full); const it = items.find((i) => i.id === id);
  const o = document.createElement("div"); o.className = "fd-lightbox"; o.innerHTML = `<img src="${url}" alt=""><div class="fd-cap">${escapeHtml(it?.name || "")}${it?.note ? " · " + escapeHtml(it.note) : ""} · tap to close</div>`;
  o.onclick = () => { o.remove(); URL.revokeObjectURL(url); }; document.body.append(o);
}
let popup = null;
function showPopup(id, lngLat) {
  const it = items.find((i) => i.id === id); if (!it) return; popup?.remove();
  const at = it.type === "track" ? lngLat : [it.lon, it.lat];
  popup = new maplibregl.Popup({ closeButton: true, maxWidth: "240px", offset: 10 }).setLngLat(at).setHTML(popupFor(it) + `<div style="margin-top:6px"><button class="chip" data-fd-open>Open in Field notes</button></div>`).addTo(map);
  const el = popup.getElement(); el.querySelector("img")?.addEventListener("click", () => viewPhoto(id)); if (el.querySelector("img")) el.querySelector("img").style.cursor = "zoom-in";
  el.querySelector("[data-fd-open]").onclick = () => { popup.remove(); openField(id); };
}
export function openField(id) { showTab("field"); render(); const r = id && document.querySelector(`.fd-row[data-id="${id}"]`); r?.scrollIntoView({ block: "center" }); r?.classList.add("fd-hl"); setTimeout(() => r?.classList.remove("fd-hl"), 1600); }

// ---------- control + init ----------
export class FieldControl {
  onAdd() { const c = document.createElement("div"); c.className = "maplibregl-ctrl maplibregl-ctrl-group"; const b = document.createElement("button"); b.type = "button"; b.title = "Field notes: GPS points, tracks and photos"; b.setAttribute("aria-label", b.title); b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2"/></svg>`; b.onclick = () => openField(); c.append(b); this.c = c; return c; }
  onRemove() { this.c.remove(); }
}
export async function initField() {
  try {
    items = await all("items");
    for (const it of items) if (it.open) { it.open = false; it.note = it.note || "recording was interrupted; ▶ continues it"; await put("items", it); }
    const blobs = await all("blobs"); for (const b of blobs) if (b.thumb) thumbs[b.id] = URL.createObjectURL(b.thumb);
  } catch (e) { console.warn("field storage unavailable", e); items = []; }
  on("select:field", ({ id, lngLat }) => showPopup(id, lngLat));
  map.on("style.load", ensureLayers); if (map.isStyleLoaded()) ensureLayers(); else map.once("load", ensureLayers);
  render();
}
