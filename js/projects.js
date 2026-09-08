// Team project watch list: Supabase-backed, shared by allowlisted members, pinned on the map.
import { COUNTIES } from "./config.js";
import { $, escapeHtml, fmt, fmtNum, fmtDate, haversineKm, kmToMi, emit, on } from "./util.js";
import * as db from "./api/supabase.js";
import { stations as precipStations, current as precipWindow } from "./precip.js";
import { gauges, gaugeById } from "./gauges.js";
import { setProjects, setPickMode, map } from "./map.js";
import { FLOW_CLASSES } from "./config.js";

export let projects = [];
let user = null;
let member = false;
let editing = null; // project object being edited (or {} for new)
let pendingEmail = null;

const KINDS = { stream: "Stream restoration", culvert: "Culvert / fish passage", shoreline: "Shoreline / bluff", stormwater: "Stormwater", dam: "Dam / outlet", other: "Other" };
const STATUSES = { active: "Active", design: "Design", construction: "Construction", monitoring: "Monitoring", on_hold: "On hold", complete: "Complete" };
const STATUS_COLORS = { active: "#38bdf8", design: "#a78bfa", construction: "#f59e0b", monitoring: "#22c55e", on_hold: "#94a3b8", complete: "#64748b" };

export async function initProjects() {
  const pane = $("tab-projects");
  pane.innerHTML = `<div class="spinner">Connecting…</div>`;
  try {
    user = (await db.session())?.user || null;
    db.onAuth(async (s) => { user = s?.user || null; await refresh(); });
    await refresh();
  } catch (e) { pane.innerHTML = `<div class="notice">Project list unavailable: ${escapeHtml(e.message)}</div>`; }
  on("precip:loaded", () => { if (!editing) renderList(); });
  on("gauges:loaded", () => { if (!editing) renderList(); });
  on("select:project", (p) => openProject(p.id));
}

async function refresh() {
  if (!user) { projects = []; setProjects(toFC()); renderSignIn(); return; }
  member = await db.isMember();
  if (!member) { projects = []; setProjects(toFC()); renderNotMember(); return; }
  try { projects = await db.listProjects(); } catch (e) { $("tab-projects").innerHTML = `<div class="notice">${escapeHtml(e.message)}</div>`; return; }
  setProjects(toFC());
  renderList();
}

// ---------- views ----------
function renderSignIn() {
  const c = $("tab-projects");
  c.innerHTML = `<h2>Team projects</h2>
    <div class="muted">A shared watch list for TSA3 projects: each one pinned on the map with its nearest gauge and rain totals. Sign in with a team email to view and edit.</div>
    <div class="form"><label>Email<input id="pj-email" type="email" placeholder="you@tsa3.org" value="${escapeHtml(pendingEmail || "")}" /></label>
      <div class="actions"><button class="btn primary" id="pj-send">Email me a sign-in code</button></div>
      <div id="pj-msg" class="small"></div>
      <div id="pj-otp" ${pendingEmail ? "" : "hidden"}><label>Code from the email<input id="pj-code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="6 digits" /></label><div class="actions"><button class="btn primary" id="pj-verify">Sign in with code</button></div></div>
      <details id="pj-pw-wrap" ${pendingEmail ? "" : "open"}><summary class="small" style="cursor:pointer">Or sign in with a password</summary>
        <label>Password<input id="pj-pw" type="password" autocomplete="current-password" /></label>
        <div class="actions"><button class="btn" id="pj-pw-go">Sign in with password</button></div></details>
    </div>
    <div class="small">Use the code, not the link: work mailboxes often pre-open links for security scanning, which uses them up before you can click. Access is limited to emails on the team allowlist; ask Matías to add yours.</div>`;
  $("pj-send").onclick = async () => {
    const email = $("pj-email").value.trim();
    if (!email) return;
    pendingEmail = email;
    $("pj-msg").textContent = "Sending…";
    try { await db.signInWithEmail(email); $("pj-msg").textContent = `Sent to ${email}. Paste the code below (the link in the email also works if nothing pre-opened it).`; $("pj-otp").hidden = false; $("pj-code").focus(); }
    catch (e) { $("pj-msg").textContent = "Failed: " + e.message; }
  };
  $("pj-verify").onclick = async () => {
    const code = $("pj-code").value.replace(/\D/g, "");
    if (!pendingEmail) { $("pj-msg").textContent = "Enter your email and request a code first."; return; }
    if (!code) return;
    $("pj-msg").textContent = "Verifying…";
    try { await db.verifyOtp(pendingEmail, code); } catch (e) { $("pj-msg").textContent = "Failed: " + e.message + (/expired|invalid/i.test(e.message) ? " Request a new code." : ""); }
  };
  $("pj-code")?.addEventListener("keydown", (e) => { if (e.key === "Enter") $("pj-verify").click(); });
  $("pj-pw-go").onclick = async () => {
    const email = $("pj-email").value.trim(), pw = $("pj-pw").value;
    if (!email || !pw) { $("pj-msg").textContent = "Enter email and password."; return; }
    $("pj-msg").textContent = "Signing in…";
    try { await db.signInWithPassword(email, pw); } catch (e) { $("pj-msg").textContent = "Failed: " + e.message; }
  };
  $("pj-pw")?.addEventListener("keydown", (e) => { if (e.key === "Enter") $("pj-pw-go").click(); });
}
function renderNotMember() {
  $("tab-projects").innerHTML = `<h2>Team projects</h2><div class="notice">Signed in as ${escapeHtml(user.email)}, but that address is not on the team allowlist yet.</div>
    <div class="actions"><button class="btn" id="pj-out">Sign out</button></div>`;
  $("pj-out").onclick = () => db.signOut();
}

function projectLive(p) {
  const w = precipWindow;
  const near = p.lat != null ? precipStations.filter((s) => !s.missingAll).map((s) => ({ ...s, km: haversineKm(p.lat, p.lon, s.lat, s.lon) })).sort((a, b) => a.km - b.km) : [];
  const chosen = p.station_ids?.length ? near.filter((s) => p.station_ids.includes(s.sid)) : near.slice(0, 3);
  const totals = chosen.map((s) => s.total).filter((v) => v != null);
  const max1 = Math.max(-1, ...chosen.map((s) => s.max1 ?? s.total ?? -1));
  const g = p.gauge_ids?.length ? p.gauge_ids.map(gaugeById).filter(Boolean) : (p.lat != null ? gauges.map((x) => ({ ...x, km: haversineKm(p.lat, p.lon, x.lat, x.lon) })).sort((a, b) => a.km - b.km).slice(0, 1) : []);
  const alert = p.rain_alert_in != null && max1 >= p.rain_alert_in;
  return { stations: chosen, meanTotal: totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null, maxTotal: totals.length ? Math.max(...totals) : null, max1: max1 >= 0 ? max1 : null, gauges: g, alert, days: w.days, endDate: w.endDate };
}

function renderList() {
  if (!user || !member) return;
  const c = $("tab-projects");
  const w = precipWindow;
  const groups = {};
  for (const p of projects) (groups[p.status] ||= []).push(p);
  const order = ["active", "construction", "design", "monitoring", "on_hold", "complete"];
  c.innerHTML = `<h2>Team projects <span class="pill">${projects.length}</span></h2>
    <div class="muted">${escapeHtml(user.email)} · <a href="#" id="pj-out">sign out</a> · <a href="#" id="pj-members">members</a> · <a href="#" id="pj-account">password</a></div>
    <div class="actions"><button class="btn primary" id="pj-new">+ Add project</button><button class="btn" id="pj-csv">Export CSV</button></div>
    <div class="small">Rain totals are ${w.days === 1 ? "for " + fmtDate(w.endDate) : w.days + "-day totals ending " + fmtDate(w.endDate)} at each project's linked stations (or the 3 nearest reporting).</div>
    ${order.filter((s) => groups[s]).map((s) => `<h3>${STATUSES[s]} <span class="pill">${groups[s].length}</span></h3>${groups[s].map(card).join("")}`).join("")}`;
  $("pj-out").onclick = (e) => { e.preventDefault(); db.signOut(); };
  $("pj-new").onclick = () => openEditor({ status: "active", kind: "stream", gauge_ids: [], station_ids: [], tags: [] });
  $("pj-members").onclick = (e) => { e.preventDefault(); renderMembers(); };
  $("pj-account").onclick = (e) => { e.preventDefault(); renderAccount(); };
  $("pj-csv").onclick = () => exportCsv();
  c.querySelectorAll(".pcard").forEach((el) => el.addEventListener("click", () => openProject(el.dataset.id)));
}
function card(p) {
  const live = projectLive(p);
  const g = live.gauges[0];
  return `<div class="pcard ${live.alert ? "alert-on" : ""}" data-id="${p.id}">
    <div class="pcard-head"><span class="dot" style="background:${STATUS_COLORS[p.status] || "#999"}"></span><b>${escapeHtml(p.name)}</b>${live.alert ? `<span class="pill class" style="background:#b91c1c">rain alert</span>` : ""}</div>
    <div class="small">${escapeHtml(KINDS[p.kind] || p.kind)}${p.county ? " · " + escapeHtml(p.county) : ""}${p.lat == null ? " · <i>no location</i>" : ""}</div>
    <div class="pcard-stats">
      <span>${live.maxTotal != null ? `<b>${fmt(live.maxTotal)}"</b> rain` : "<i>no stations</i>"}</span>
      <span>${g ? `<b>${g.flow != null ? fmtNum(g.flow, g.flow < 10 ? 1 : 0) : "–"}</b> cfs <span class="pill class" style="background:${g.color}">${FLOW_CLASSES[g.flowClass].label.split(" (")[0]}</span>` : "<i>no gauge</i>"}</span>
    </div></div>`;
}

export function openProject(id) {
  const p = projects.find((x) => x.id === id);
  if (!p) return;
  if (p.lat != null) map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 11) });
  showProjectsTab();
  const live = projectLive(p);
  const c = $("tab-projects");
  c.innerHTML = `<div class="actions"><button class="btn" id="pj-back">‹ All projects</button><button class="btn" id="pj-edit">Edit</button></div>
    <h2><span class="dot" style="background:${STATUS_COLORS[p.status]}"></span> ${escapeHtml(p.name)}</h2>
    <div class="muted">${escapeHtml(KINDS[p.kind] || p.kind)} · ${STATUSES[p.status] || p.status}${p.county ? " · " + escapeHtml(p.county) + " County" : ""}${p.swcd ? " · " + escapeHtml(p.swcd) : ""}</div>
    <div class="small">${p.lat != null ? `${fmt(p.lat, 4)}, ${fmt(p.lon, 4)}` : "No location set"}${p.location_note ? " · " + escapeHtml(p.location_note) : ""}</div>
    ${p.notes ? `<div class="notice">${escapeHtml(p.notes)}</div>` : ""}
    ${p.tags?.length ? `<div>${p.tags.map((t) => `<span class="pill">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
    <div class="stat-row">
      <div class="stat ${live.alert ? "bad" : ""}"><div class="v">${live.maxTotal != null ? fmt(live.maxTotal) + '"' : "–"}</div><div class="l">${live.days === 1 ? "rain " + fmtDate(live.endDate) : live.days + "-day rain (max of stations)"}</div><div class="s">${p.rain_alert_in != null ? `alert at ${fmt(p.rain_alert_in)}" in a day` : "no alert threshold"}</div></div>
      <div class="stat"><div class="v">${live.gauges[0] && live.gauges[0].flow != null ? fmtNum(live.gauges[0].flow, live.gauges[0].flow < 10 ? 1 : 0) : "–"}</div><div class="l">cfs at ${live.gauges[0] ? escapeHtml(live.gauges[0].name.split(",")[0]) : "gauge"}</div><div class="s">${live.gauges[0] ? FLOW_CLASSES[live.gauges[0].flowClass].label : ""}</div></div>
    </div>
    <h3>Linked stations</h3>
    ${live.stations.length ? `<table class="data"><thead><tr><th>Station</th><th class="num">mi</th><th class="num">in</th><th class="num">max 1-day</th></tr></thead><tbody>${live.stations.map((s) => `<tr class="clickable" data-sid="${escapeHtml(s.sid)}"><td>${escapeHtml(s.name)}</td><td class="num">${s.km != null ? fmt(kmToMi(s.km), 1) : "–"}</td><td class="num">${fmt(s.total)}</td><td class="num">${fmt(s.max1 ?? s.total)}</td></tr>`).join("")}</tbody></table>` : `<div class="notice">Set a location to see nearby stations.</div>`}
    <h3>Linked gauges</h3>
    ${live.gauges.length ? `<table class="data"><thead><tr><th>Gauge</th><th class="num">cfs</th><th class="num">ft</th><th>Class</th></tr></thead><tbody>${live.gauges.map((g) => `<tr class="clickable" data-gid="${escapeHtml(g.id)}"><td>${escapeHtml(g.name)}</td><td class="num">${fmtNum(g.flow, g.flow < 10 ? 1 : 0)}</td><td class="num">${fmt(g.stage)}</td><td><span class="pill class" style="background:${g.color}">${FLOW_CLASSES[g.flowClass].label.split(" (")[0]}</span></td></tr>`).join("")}</tbody></table>` : `<div class="notice">No gauge linked.</div>`}
    <div class="actions"><button class="btn" id="pj-point">Open point analysis here</button></div>
    <div class="small">Created ${p.created_at?.slice(0, 10)} by ${escapeHtml(p.created_by || "?")} · updated ${p.updated_at?.slice(0, 10)} by ${escapeHtml(p.updated_by || "?")}</div>`;
  $("pj-back").onclick = () => renderList();
  $("pj-edit").onclick = () => openEditor(p);
  $("pj-point").onclick = () => { if (p.lat != null) emit("select:point", { lon: p.lon, lat: p.lat }); };
  c.querySelectorAll("tr[data-sid]").forEach((tr) => tr.addEventListener("click", () => emit("select:station", { sid: tr.dataset.sid })));
  c.querySelectorAll("tr[data-gid]").forEach((tr) => tr.addEventListener("click", () => emit("select:gauge", { id: tr.dataset.gid })));
}

function openEditor(p) {
  editing = { ...p };
  showProjectsTab();
  const c = $("tab-projects");
  const nearS = editing.lat != null ? precipStations.map((s) => ({ ...s, km: haversineKm(editing.lat, editing.lon, s.lat, s.lon) })).sort((a, b) => a.km - b.km).slice(0, 6) : [];
  const nearG = editing.lat != null ? gauges.map((g) => ({ ...g, km: haversineKm(editing.lat, editing.lon, g.lat, g.lon) })).sort((a, b) => a.km - b.km).slice(0, 6) : [];
  const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${v}</option>`).join("");
  const counties = COUNTIES.filter((x) => x.tsa3).map((x) => x.name);
  c.innerHTML = `<h2>${editing.id ? "Edit project" : "New project"}</h2>
    <div class="form">
      <label>Name<input id="f-name" value="${escapeHtml(editing.name || "")}" /></label>
      <div class="row2">
        <label>Kind<select id="f-kind">${opt(KINDS, editing.kind || "stream")}</select></label>
        <label>Status<select id="f-status">${opt(STATUSES, editing.status || "active")}</select></label>
      </div>
      <div class="row2">
        <label>County<input id="f-county" list="county-list" value="${escapeHtml(editing.county || "")}" /><datalist id="county-list">${counties.map((n) => `<option value="${n}">`).join("")}</datalist></label>
        <label>SWCD<input id="f-swcd" value="${escapeHtml(editing.swcd || "")}" /></label>
      </div>
      <div class="row2">
        <label>Latitude<input id="f-lat" type="number" step="0.0001" value="${editing.lat ?? ""}" /></label>
        <label>Longitude<input id="f-lon" type="number" step="0.0001" value="${editing.lon ?? ""}" /></label>
      </div>
      <div class="actions"><button class="btn" id="f-pick">📍 Pick location on map</button><span id="f-pick-msg" class="small"></span></div>
      <label>Location note<input id="f-locnote" value="${escapeHtml(editing.location_note || "")}" placeholder="e.g. approximate, verify" /></label>
      <label>Rain alert threshold, 1-day inches<input id="f-alert" type="number" step="0.1" value="${editing.rain_alert_in ?? ""}" placeholder="e.g. 1.0" /></label>
      <label>Stations to watch <span class="small">(nearest first; none checked = 3 nearest reporting)</span></label>
      <div class="checks">${nearS.map((s) => `<label class="chk"><input type="checkbox" name="stn" value="${escapeHtml(s.sid)}" ${editing.station_ids?.includes(s.sid) ? "checked" : ""}/> ${escapeHtml(s.name)} <span class="small">${fmt(kmToMi(s.km), 1)} mi</span></label>`).join("") || "<span class='small'>Set a location first.</span>"}</div>
      <label>Gauges to watch <span class="small">(none checked = nearest)</span></label>
      <div class="checks">${nearG.map((g) => `<label class="chk"><input type="checkbox" name="gag" value="${escapeHtml(g.id)}" ${editing.gauge_ids?.includes(g.id) ? "checked" : ""}/> ${escapeHtml(g.name)} <span class="small">${fmt(kmToMi(g.km), 1)} mi</span></label>`).join("") || "<span class='small'>Set a location first.</span>"}</div>
      <label>Tags <span class="small">(comma separated)</span><input id="f-tags" value="${escapeHtml((editing.tags || []).join(", "))}" /></label>
      <label>Notes<textarea id="f-notes" rows="4">${escapeHtml(editing.notes || "")}</textarea></label>
      <div class="actions"><button class="btn primary" id="f-save">Save</button><button class="btn" id="f-cancel">Cancel</button>${editing.id ? `<button class="btn danger" id="f-delete">Delete</button>` : ""}</div>
      <div id="f-msg" class="small"></div>
    </div>`;
  $("f-pick").onclick = () => {
    $("f-pick-msg").textContent = "Click the map…";
    setPickMode(({ lon, lat }) => {
      editing.lat = Number(lat.toFixed(5)); editing.lon = Number(lon.toFixed(5));
      readForm(); openEditor(editing); $("f-pick-msg").textContent = "Location set. Re-check stations/gauges below.";
    });
  };
  $("f-cancel").onclick = () => { editing = null; setPickMode(null); editing?.id ? openProject(editing.id) : renderList(); };
  $("f-save").onclick = async () => {
    readForm();
    if (!editing.name) { $("f-msg").textContent = "Name is required."; return; }
    $("f-msg").textContent = "Saving…";
    try {
      const saved = await db.upsertProject(editing);
      editing = null; setPickMode(null);
      projects = await db.listProjects(); setProjects(toFC());
      openProject(saved.id);
    } catch (e) { $("f-msg").textContent = "Save failed: " + e.message; }
  };
  const del = $("f-delete");
  if (del) del.onclick = async () => {
    if (!confirm(`Delete "${editing.name}"? This cannot be undone.`)) return;
    try { await db.deleteProject(editing.id); editing = null; projects = await db.listProjects(); setProjects(toFC()); renderList(); }
    catch (e) { $("f-msg").textContent = "Delete failed: " + e.message; }
  };
}
function readForm() {
  const num = (id) => { const v = $(id).value.trim(); return v === "" ? null : Number(v); };
  Object.assign(editing, {
    name: $("f-name").value.trim(), kind: $("f-kind").value, status: $("f-status").value,
    county: $("f-county").value.trim() || null, swcd: $("f-swcd").value.trim() || null,
    lat: num("f-lat"), lon: num("f-lon"), location_note: $("f-locnote").value.trim() || null,
    rain_alert_in: num("f-alert"), notes: $("f-notes").value.trim() || null,
    tags: $("f-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
    station_ids: [...document.querySelectorAll('input[name=stn]:checked')].map((i) => i.value),
    gauge_ids: [...document.querySelectorAll('input[name=gag]:checked')].map((i) => i.value),
  });
  for (const k of ["created_at", "updated_at", "created_by", "updated_by"]) delete editing[k];
  if (!editing.id) delete editing.id;
}

function renderAccount() {
  const c = $("tab-projects");
  c.innerHTML = `<div class="actions"><button class="btn" id="pj-back">‹ All projects</button></div><h2>Account</h2>
    <div class="muted">${escapeHtml(user.email)}</div>
    <div class="form"><label>New password <span class="small">(8+ characters)</span><input id="acct-pw" type="password" autocomplete="new-password" /></label>
      <label>Repeat<input id="acct-pw2" type="password" autocomplete="new-password" /></label>
      <div class="actions"><button class="btn primary" id="acct-save">Set password</button></div><div id="acct-msg" class="small"></div></div>
    <div class="small">A password lets you sign in without waiting for an email. Emailed codes keep working too.</div>`;
  $("pj-back").onclick = () => renderList();
  $("acct-save").onclick = async () => {
    const a = $("acct-pw").value, b = $("acct-pw2").value;
    if (a.length < 8) { $("acct-msg").textContent = "Use at least 8 characters."; return; }
    if (a !== b) { $("acct-msg").textContent = "Passwords don't match."; return; }
    try { await db.setPassword(a); $("acct-msg").textContent = "Password updated."; $("acct-pw").value = $("acct-pw2").value = ""; }
    catch (e) { $("acct-msg").textContent = "Failed: " + e.message; }
  };
}

async function renderMembers() {
  const c = $("tab-projects");
  let members = [];
  try { members = await db.listMembers(); } catch (e) { c.innerHTML = `<div class="notice">${escapeHtml(e.message)}</div>`; return; }
  const admin = members.some((m) => m.email.toLowerCase() === user.email.toLowerCase() && m.role === "admin");
  c.innerHTML = `<div class="actions"><button class="btn" id="pj-back">‹ All projects</button></div><h2>Team members</h2>
    <table class="data"><thead><tr><th>Email</th><th>Name</th><th>Role</th></tr></thead><tbody>${members.map((m) => `<tr><td>${escapeHtml(m.email)}</td><td>${escapeHtml(m.display_name || "")}</td><td>${m.role}</td></tr>`).join("")}</tbody></table>
    ${admin ? `<div class="form"><div class="row2"><label>Add email<input id="m-email" type="email" /></label><label>Name<input id="m-name" /></label></div><div class="actions"><button class="btn primary" id="m-add">Add member</button></div><div id="m-msg" class="small"></div></div>` : `<div class="small">Only admins can add members.</div>`}`;
  $("pj-back").onclick = () => renderList();
  const add = $("m-add");
  if (add) add.onclick = async () => { try { await db.addMember($("m-email").value, $("m-name").value); renderMembers(); } catch (e) { $("m-msg").textContent = e.message; } };
}

function exportCsv() {
  const rows = [["name", "kind", "status", "county", "swcd", "lat", "lon", "location_note", "rain_alert_in", "gauge_ids", "station_ids", "tags", "notes", "updated_at", "updated_by"]];
  for (const p of projects) rows.push([p.name, p.kind, p.status, p.county, p.swcd, p.lat, p.lon, p.location_note, p.rain_alert_in, (p.gauge_ids || []).join(";"), (p.station_ids || []).join(";"), (p.tags || []).join(";"), p.notes, p.updated_at, p.updated_by]);
  import("./util.js").then((u) => u.downloadCSV("tsa3_projects.csv", rows));
}

function showProjectsTab() {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === "projects"));
  document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("on", p.id === "tab-projects"));
  $("panel").classList.add("open");
}

function toFC() {
  return { type: "FeatureCollection", features: projects.filter((p) => p.lat != null && p.lon != null).map((p) => {
    const live = projectLive(p);
    return { type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: { kind: "project", id: p.id, name: p.name, color: live.alert ? "#ef4444" : (STATUS_COLORS[p.status] || "#999"),
        popup: `<div class="popup-title">★ ${escapeHtml(p.name)}</div><div class="popup-sub">${escapeHtml(KINDS[p.kind] || p.kind)} · ${STATUSES[p.status] || p.status}</div><div class="popup-sub">${live.maxTotal != null ? fmt(live.maxTotal) + '" rain' : ""}${live.gauges[0] && live.gauges[0].flow != null ? ` · ${fmtNum(live.gauges[0].flow, 0)} cfs ${escapeHtml(live.gauges[0].name.split(",")[0])}` : ""}</div>` } };
  }) };
}
