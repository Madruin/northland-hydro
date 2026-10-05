// Team field records: everyone's uploaded points, tracks and photos as a map layer (blue-ringed, under this device's
// own notes), and the project page's "Field records" section: visits with their notes and photos, partner access by
// email, and a ZIP for the shared drive (CSV, KML for Google Earth, the photos). Visibility is enforced by Supabase RLS:
// TSA3 members see every project, partners only the projects they were added to.
import { $, escapeHtml, fmt, fmtNum, fmtDate, on, emit } from "./util.js";
import * as db from "./api/supabase.js";
import { map } from "./map.js";
import { kmlFor, trackLen, localRids, teamOn, setTeam, loadScript, download, stamp, dayOf } from "./field.js";
import { utmFeet } from "./coords.js";

let ctx = { user: null, member: false, projects: [] };
let rows = []; // remote items visible to this user, in field.js item shape
const EMPTY = { type: "FeatureCollection", features: [] };
const who = (email) => (email || "?").split("@")[0];
const projName = (id) => ctx.projects.find((p) => p.id === id)?.name || "project";
const when = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const ICON = { point: "📍", track: "〰", photo: "📷" };

function toItem(r) {
  return { id: r.id, rid: r.id, type: r.kind, name: r.name || "", note: r.note || "", t: Date.parse(r.taken_at || r.created_at), lon: r.lon, lat: r.lat, acc: r.acc, alt: r.alt, dir: r.dir,
    segs: r.geom || [], file: r.photo_file, photo_path: r.photo_path, thumb_path: r.thumb_path, by: r.created_by, projectId: r.project_id, visitId: r.visit_id };
}

// ---------- map layer ----------
function fcTeam() {
  if (!teamOn()) return EMPTY;
  const mine = localRids(); const f = [];
  for (const it of rows) {
    if (mine.has(it.id)) continue; // already drawn by the device layer
    if (it.type === "track") { const segs = it.segs.filter((s) => s.length > 1); if (segs.length) f.push({ type: "Feature", geometry: { type: "MultiLineString", coordinates: segs.map((s) => s.map((p) => [p[0], p[1]])) }, properties: { id: it.id, kind: "track" } }); }
    else if (it.lon != null) f.push({ type: "Feature", geometry: { type: "Point", coordinates: [it.lon, it.lat] }, properties: { id: it.id, kind: it.type } });
  }
  return { type: "FeatureCollection", features: f };
}
function ensureLayers() {
  if (!map?.getStyle()) return;
  if (map.getSource("team")) { draw(); return; }
  map.addSource("team", { type: "geojson", data: fcTeam() });
  const before = map.getLayer("field-trk") ? "field-trk" : undefined;
  const kind = (k) => ["==", ["get", "kind"], k];
  map.addLayer({ id: "team-trk", type: "line", source: "team", filter: kind("track"), layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#fb7185", "line-width": 2.5, "line-opacity": 0.8, "line-dasharray": [2, 1.2] } }, before);
  map.addLayer({ id: "team-pts", type: "circle", source: "team", filter: kind("point"), paint: { "circle-radius": 6, "circle-color": "#fde68a", "circle-stroke-color": "#0369a1", "circle-stroke-width": 2 } }, before);
  map.addLayer({ id: "team-photo", type: "circle", source: "team", filter: kind("photo"), paint: { "circle-radius": 6, "circle-color": "#d8b4fe", "circle-stroke-color": "#0369a1", "circle-stroke-width": 2 } }, before);
}
function draw() { map?.getSource("team")?.setData(fcTeam()); }
let loading = null;
async function load() {
  if (!teamOn()) { draw(); return; }
  try { rows = (await (loading ||= db.listFieldItems())).map(toItem); } catch (e) { console.warn("team field records", e); rows = []; } finally { loading = null; }
  draw();
}

let popup = null;
async function showPopup({ id, lngLat }) {
  const it = rows.find((r) => r.id === id); if (!it) return; popup?.remove();
  const html = `<div class="popup-title">${ICON[it.type] || ""} ${escapeHtml(it.name)}</div>${it.thumb_path ? `<img alt="" style="width:100%;max-width:220px;min-height:60px;border-radius:4px;display:block;margin:4px 0;cursor:zoom-in;background:#222">` : ""}
    <div class="popup-sub">${escapeHtml(projName(it.projectId))} · ${when(it.t)} · ${escapeHtml(who(it.by))}${it.type === "track" ? ` · ${fmt(trackLen(it) / 1609.344, 2)} mi` : ""}${it.dir != null ? ` · facing ${Math.round(it.dir)}°` : ""}</div>
    ${it.note ? `<div class="popup-sub">${escapeHtml(it.note)}</div>` : ""}<div style="margin-top:6px"><button class="chip" data-open-proj>Open project</button></div>`;
  popup = new maplibregl.Popup({ closeButton: true, maxWidth: "240px", offset: 10 }).setLngLat(it.type === "track" ? lngLat : [it.lon, it.lat]).setHTML(html).addTo(map);
  const el = popup.getElement();
  el.querySelector("[data-open-proj]").onclick = () => { popup.remove(); emit("select:project", { id: it.projectId }); };
  if (it.thumb_path) {
    const u = await db.signedPhotoUrls([it.thumb_path, it.photo_path].filter(Boolean)).catch(() => ({}));
    const img = el.querySelector("img"); if (img && u[it.thumb_path]) { img.src = u[it.thumb_path]; img.onclick = () => lightbox(u[it.photo_path], it); }
  }
}
function lightbox(url, it) {
  if (!url) return;
  const o = document.createElement("div"); o.className = "fd-lightbox";
  o.innerHTML = `<img src="${escapeHtml(url)}" alt=""><div class="fd-cap">${escapeHtml(it.name)} · ${escapeHtml(who(it.by))} · ${when(it.t)}${it.note ? " · " + escapeHtml(it.note) : ""} · tap to close</div>`;
  o.onclick = () => o.remove(); document.body.append(o);
}

export function initTeamLayer() {
  map.on("style.load", ensureLayers); map.once("load", ensureLayers); map.once("idle", ensureLayers); try { ensureLayers(); } catch {} // the load event may have passed already (isStyleLoaded stays false while tiles load)
  on("projects:state", (s) => { ctx = s; if (!s.user) { rows = []; draw(); } else load(); });
  on("field:team", () => load());
  on("field:synced", () => load());
  on("select:team", showPopup);
}

// ---------- project page ----------
export async function renderFieldRecords(p, box, { member, me }) {
  box.innerHTML = `<div class="spinner">Loading…</div>`;
  let visits, list;
  try { [visits, list] = await Promise.all([db.listVisits(p.id), db.listFieldItems(p.id)]); } catch (e) { box.innerHTML = `<div class="notice">${escapeHtml(e.message)}</div>`; return; }
  list = list.map(toItem).sort((a, b) => a.t - b.t);
  if (!list.length && !visits.length) { box.innerHTML = `<div class="small">None yet. In the Field tab (📍 button on the map), choose this project under "Upload to team project"; points, tracks and photos taken from then on upload here, and teammates see them on the map.</div>`; return; }
  const urls = await db.signedPhotoUrls(list.filter((i) => i.thumb_path).map((i) => i.thumb_path)).catch(() => ({}));
  const groups = visits.map((v) => ({ v, items: list.filter((i) => i.visitId === v.id) }));
  const loose = list.filter((i) => !visits.some((v) => v.id === i.visitId));
  if (loose.length) groups.push({ v: null, items: loose });
  const n = (k) => list.filter((i) => i.type === k).length;
  const canDel = (it) => member || (me && it.by === me);
  const row = (it) => `<div class="fr-row" data-id="${it.id}">
      ${it.thumb_path && urls[it.thumb_path] ? `<img class="fr-thumb" src="${escapeHtml(urls[it.thumb_path])}" alt="" title="View photo">` : `<span class="fr-ico">${ICON[it.type] || ""}</span>`}
      <div class="fr-main"><a href="#" class="fr-go">${escapeHtml(it.name || it.type)}</a> <span class="small">${new Date(it.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${it.type === "track" ? ` · ${fmt(trackLen(it) / 1609.344, 2)} mi` : it.lon == null ? " · no location" : ""}${it.acc ? ` · ±${fmtNum(it.acc * 3.281)} ft` : ""}${it.dir != null ? ` · facing ${Math.round(it.dir)}°` : ""}</span>
        ${it.note ? `<div class="small">${escapeHtml(it.note)}</div>` : ""}</div>
      ${canDel(it) ? `<button class="chip fr-del" title="Delete from the project">✕</button>` : ""}</div>`;
  box.innerHTML = `<div class="small">${n("point")} points · ${n("track")} tracks · ${n("photo")} photos · ${visits.length} visit${visits.length === 1 ? "" : "s"}</div>
    <div class="actions"><button class="btn" id="fr-map">Show on map</button><button class="btn" id="fr-zip" title="Notes CSV, Google Earth KML and the photos, for the shared drive">Download for shared drive (ZIP)</button><span id="fr-msg" class="small"></span></div>
    ${groups.map(({ v, items }) => `<div class="fr-visit"><div class="fr-vhead">${v ? `<b>${fmtDate(v.visit_date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</b> · ${escapeHtml(who(v.created_by))}` : "<b>Not linked to a visit</b>"} <span class="small">${items.length} record${items.length === 1 ? "" : "s"}</span></div>
      ${v?.note ? `<div class="fr-vnote">${escapeHtml(v.note)}</div>` : ""}${items.map(row).join("")}</div>`).join("")}`;
  const byId = Object.fromEntries(list.map((i) => [i.id, i]));
  $("fr-map").onclick = () => {
    setTeam(true);
    const pts = list.flatMap((i) => i.type === "track" ? i.segs.flat().map((q) => [q[0], q[1]]) : i.lon != null ? [[i.lon, i.lat]] : []);
    if (!pts.length) return; const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 17 });
  };
  $("fr-zip").onclick = () => exportZip(p, visits, list).catch((e) => ($("fr-msg").textContent = "Download failed: " + e.message));
  box.querySelectorAll(".fr-row").forEach((r) => {
    const it = byId[r.dataset.id];
    r.querySelector(".fr-go").onclick = (e) => { e.preventDefault(); setTeam(true); if (it.type === "track") { const q = it.segs.flat(); if (q.length) map.fitBounds([[Math.min(...q.map((x) => x[0])), Math.min(...q.map((x) => x[1]))], [Math.max(...q.map((x) => x[0])), Math.max(...q.map((x) => x[1]))]], { padding: 60, maxZoom: 18 }); } else if (it.lon != null) map.easeTo({ center: [it.lon, it.lat], zoom: Math.max(map.getZoom(), 17) }); };
    r.querySelector(".fr-thumb")?.addEventListener("click", async () => { const u = await db.signedPhotoUrls([it.photo_path]).catch(() => ({})); lightbox(u[it.photo_path], it); });
    r.querySelector(".fr-del")?.addEventListener("click", async () => {
      if (!confirm(`Delete ${it.name || it.type} (${who(it.by)}, ${when(it.t)}) from ${p.name}? Teammates will no longer see it.`)) return;
      try { await db.deleteFieldItems([it.id]); if (it.photo_path) await db.removeFieldPhotos([it.photo_path, it.thumb_path].filter(Boolean)).catch(() => {}); emit("field:synced"); renderFieldRecords(p, box, { member, me }); }
      catch (e) { alert(e.message); }
    });
  });
}

async function exportZip(p, visits, list) {
  const m = $("fr-msg"); m.textContent = "Preparing…";
  await loadScript("https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js", "fflate");
  const safe = (s) => String(s || "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  const root = `${safe(p.name) || "project"}_field_records_${stamp()}/`;
  const files = {}; const names = new Map(); const used = new Set();
  for (const it of list.filter((i) => i.photo_path)) { const base = `${dayOf(it.t)}_${safe(it.name) || "photo"}`; let nm = base, k = 2; while (used.has(nm)) nm = `${base}_${k++}`; used.add(nm); names.set(it.id, `photos/${nm}.jpg`); }
  const ph = list.filter((i) => names.has(i.id)); let done = 0, failed = 0;
  for (let k = 0; k < ph.length; k += 4) await Promise.all(ph.slice(k, k + 4).map(async (it) => {
    try { const b = await db.downloadFieldPhoto(it.photo_path); files[root + names.get(it.id)] = new Uint8Array(await b.arrayBuffer()); } catch { names.delete(it.id); failed++; }
    m.textContent = `Downloading photos ${++done} of ${ph.length}…`;
  }));
  const vById = Object.fromEntries(visits.map((v) => [v.id, v]));
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = (rows) => "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const head = ["Visit_date", "Kind", "Name", "Note", "Time", "Recorded_by", "Latitude", "Longitude", "Northing_USft", "Easting_USft", "GPS_accuracy_ft", "Facing_deg", "Track_mi", "Photo_file", "Original_file"];
  const recs = list.map((it) => { const f = it.lon != null ? utmFeet(it.lon, it.lat) : null; const v = vById[it.visitId];
    return [v?.visit_date || dayOf(it.t), it.type, it.name, it.note, new Date(it.t).toISOString(), it.by, it.lat?.toFixed(7) ?? "", it.lon?.toFixed(7) ?? "", f ? f.n.toFixed(2) : "", f ? f.e.toFixed(2) : "", it.acc ? (it.acc * 3.281).toFixed(1) : "", it.dir != null ? Math.round(it.dir) : "", it.type === "track" ? (trackLen(it) / 1609.344).toFixed(2) : "", names.get(it.id) || "", it.file || ""]; });
  files[root + "field_records.csv"] = fflate.strToU8(csv([head, ...recs]));
  files[root + "visits.csv"] = fflate.strToU8(csv([["Date", "By", "Note", "Records"], ...visits.map((v) => [v.visit_date, v.created_by, v.note, list.filter((i) => i.visitId === v.id).length])]));
  files[root + "field_records.kml"] = fflate.strToU8(kmlFor(list, (it) => names.get(it.id) || null, `${p.name}: field records`));
  files[root + "README.txt"] = fflate.strToU8([
    `${p.name}: field records from Northland Eco (northland.eco), downloaded ${new Date().toLocaleString()} by ${ctx.user?.email || "?"}.`, "",
    "field_records.csv  every point, track and photo: time, who, note, lat/lon (WGS84) and NAD83 UTM 15N US survey feet.",
    "visits.csv         one row per person per site day, with the visit note.",
    "field_records.kml  open in Google Earth; keep it next to the photos folder so the photo pop-ups work.",
    "photos/            resized copies (about 1600 px) named by date and name. Originals stay with the photographer / team drive.", "",
    "GPS positions are phone-grade (accuracy per record in the CSV), not survey control.", ""].join("\r\n"));
  download(new Blob([fflate.zipSync(files, { level: 0 })], { type: "application/zip" }), `${root.slice(0, -1)}.zip`);
  m.textContent = `Downloaded ${list.length} records${ph.length ? ` and ${ph.length - failed} photos` : ""}${failed ? ` (${failed} photos could not be fetched)` : ""}.`;
}

export async function renderPartners(p, box, me) {
  let list = [];
  try { list = await db.listPartners(p.id); } catch (e) { box.innerHTML = `<div class="notice">${escapeHtml(e.message)}</div>`; return; }
  box.innerHTML = `<div class="small">Partner agency staff added here sign in on the Projects tab with that email (a code is emailed). They see this project and its field records and can add their own notes and photos. They can't see other projects or saved analyses, or edit the project.</div>
    ${list.length ? `<table class="data"><tbody>${list.map((x) => `<tr><td>${escapeHtml(x.email)}</td><td class="small">added ${fmtDate(x.added_at.slice(0, 10))}${x.added_by ? " by " + escapeHtml(who(x.added_by)) : ""}</td><td class="num"><button class="chip" data-rm="${escapeHtml(x.email)}" title="Remove access">✕</button></td></tr>`).join("")}</tbody></table>` : ""}
    <div class="form pt-form"><label>Partner email<input id="pt-email" type="email" autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore="true" placeholder="name@agency.gov" /></label><div class="actions"><button class="btn" id="pt-add">Give access</button></div><div id="pt-msg" class="small"></div></div>`;
  $("pt-add").onclick = async () => {
    const email = $("pt-email").value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $("pt-msg").textContent = "Enter an email address."; return; }
    try { await db.addPartner(p.id, email, me); await renderPartners(p, box, me); $("pt-msg").textContent = `Added. Send ${email} the link to northland.eco; they sign in on the Projects tab.`; }
    catch (e) { $("pt-msg").textContent = /duplicate/i.test(e.message) ? "Already added." : e.message; }
  };
  box.querySelectorAll("[data-rm]").forEach((b) => b.onclick = async () => {
    if (!confirm(`Remove ${b.dataset.rm}'s access to ${p.name}? Records they already added stay.`)) return;
    try { await db.removePartner(p.id, b.dataset.rm); renderPartners(p, box, me); } catch (e) { alert(e.message); }
  });
}
