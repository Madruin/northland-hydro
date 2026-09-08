// Small helpers shared across modules.

export const $ = (id) => document.getElementById(id);

export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- dates (all local-calendar, ISO yyyy-mm-dd) ----
export function isoDate(d = new Date()) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export function parseIso(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
export function addDays(iso, n) { const d = parseIso(iso); d.setDate(d.getDate() + n); return isoDate(d); }
export function fmtDate(iso, opts = { month: "short", day: "numeric" }) {
  return parseIso(iso).toLocaleDateString(undefined, opts);
}
export function fmtDateTime(d) {
  if (!(d instanceof Date)) d = new Date(d);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function ago(d) {
  if (!(d instanceof Date)) d = new Date(d);
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (!isFinite(m)) return "";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

// ---- numbers ----
export const fmt = (v, d = 2) => (v == null || isNaN(v) ? "–" : Number(v).toFixed(d));
export const fmtNum = (v, d = 0) => (v == null || isNaN(v) ? "–" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));
export function pct(v, n) { return v == null || !n ? null : (100 * v) / n; }

// Parse an ACIS precip value string. Returns { value, flag } where value is a number
// (trace → 0) or null when missing, and flag is one of "", "T", "A", "S", "M".
export function parseAcisValue(raw) {
  if (raw == null) return { value: null, flag: "M" };
  const s = String(raw).trim();
  if (s === "M" || s === "") return { value: null, flag: "M" };
  if (s === "T") return { value: 0, flag: "T" };
  if (s === "S") return { value: 0, flag: "S" }; // part of a later accumulation
  const m = s.match(/^(-?[\d.]+)([A-Za-z]?)$/);
  if (!m) return { value: null, flag: "M" };
  return { value: parseFloat(m[1]), flag: m[2] || "" };
}

// ---- network ----
const cache = new Map();
export async function getJSON(url, { headers = {}, ttl = 60_000, signal } = {}) {
  const key = url;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const r = await fetch(url, { headers, signal });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  const v = await r.json();
  cache.set(key, { t: Date.now(), v });
  return v;
}
export async function postJSON(url, body, { ttl = 60_000, signal } = {}) {
  const key = url + JSON.stringify(body);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  const v = await r.json();
  cache.set(key, { t: Date.now(), v });
  return v;
}
export async function getText(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.text();
}
// JSONP loader (for the MN DNR CSG feed, which wraps JSON in csgSitesFeed(...))
export function jsonp(url, callbackName, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    const t = setTimeout(() => { cleanup(); reject(new Error("JSONP timeout: " + url)); }, timeoutMs);
    function cleanup() { clearTimeout(t); delete window[callbackName]; s.remove(); }
    window[callbackName] = (data) => { cleanup(); resolve(data); };
    s.onerror = () => { cleanup(); reject(new Error("JSONP failed: " + url)); };
    s.src = url;
    document.head.appendChild(s);
  });
}

// ---- geometry ----
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export const kmToMi = (km) => km * 0.621371;
export function inBbox([lon, lat], [w, s, e, n]) { return lon >= w && lon <= e && lat >= s && lat <= n; }

// ---- CSV download ----
export function downloadCSV(filename, rows) {
  const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- simple event bus ----
const handlers = {};
export function on(evt, fn) { (handlers[evt] ||= []).push(fn); }
export function emit(evt, data) { (handlers[evt] || []).forEach((fn) => fn(data)); }

export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---- Plotly dark layout ----
export function plotlyLayout(extra = {}) {
  const base = {
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: { color: "#a9b6cf", size: 11 },
    margin: { l: 44, r: 10, t: 28, b: 34 }, showlegend: true,
    legend: { orientation: "h", y: 1.12, x: 0, font: { size: 10 } },
    xaxis: { gridcolor: "#2b3a5e", zeroline: false }, yaxis: { gridcolor: "#2b3a5e", zeroline: false },
    hovermode: "x unified", title: { font: { size: 12, color: "#e6edf7" }, x: 0, xanchor: "left" },
  };
  const out = { ...base, ...extra };
  out.xaxis = { ...base.xaxis, ...(extra.xaxis || {}) };
  out.yaxis = { ...base.yaxis, ...(extra.yaxis || {}) };
  if (typeof out.title === "string") out.title = { ...base.title, text: out.title };
  return out;
}
