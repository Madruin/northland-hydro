// Header search: gauges, stations, projects (client-side) and places (Photon geocoder, CORS, no key).
import { parseCoords } from "./coords.js";
import { getRecents, ago } from "./recent.js";
import { $, escapeHtml, emit, debounce, getJSON } from "./util.js";
import { stations } from "./precip.js";
import { gauges } from "./gauges.js";
import { authState } from "./projects.js";
import { map } from "./map.js";
import { REGION_BBOX } from "./config.js";

const PHOTON = "https://photon.komoot.io/api/";
let items = [];
let activeIdx = -1;

export function initSearch() {
  const input = $("ctl-search"), box = $("search-results");
  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { showRecents(); return; }
    const cc = parseCoords(q);
    if (cc) { items = [{ kind: "place", label: `Go to ${cc.input}`, sub: `${cc.kind} · ${cc.lat.toFixed(5)}, ${cc.lon.toFixed(5)}`, lon: cc.lon, lat: cc.lat, zoom: 14, s: 9 }]; render(box, items, false); return; }
    items = localMatches(q);
    render(box, items, true);
    try {
      const places = await placeMatches(q);
      items = [...localMatches(q), ...places];
      render(box, items, false);
    } catch { render(box, items, false); }
  }, 200);
  input.addEventListener("input", run);
  const showRecents = () => { const r = getRecents(); if (!r.length) { box.hidden = true; return; } items = r.map((p) => ({ kind: "recent", label: p.label, sub: `Recent point · ${ago(p.t)}`, lon: p.lon, lat: p.lat, zoom: 14, s: 0 })); render(box, items, false); };
  input.addEventListener("focus", () => { if (input.value.trim().length < 2) showRecents(); else if (items.length) box.hidden = false; });
  input.addEventListener("keydown", (e) => {
    if (box.hidden) return;
    if (e.key === "ArrowDown") { activeIdx = Math.min(items.length - 1, activeIdx + 1); highlight(box); e.preventDefault(); }
    else if (e.key === "ArrowUp") { activeIdx = Math.max(0, activeIdx - 1); highlight(box); e.preventDefault(); }
    else if (e.key === "Enter") { const it = items[activeIdx >= 0 ? activeIdx : 0]; if (it) choose(it); e.preventDefault(); }
    else if (e.key === "Escape") { box.hidden = true; input.blur(); }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search-wrap")) box.hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { e.preventDefault(); input.focus(); input.select(); } });
}

function localMatches(q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const score = (text) => { const t = text.toLowerCase(); let s = 0; for (const w of terms) { if (!t.includes(w)) return -1; s += t.startsWith(w) ? 3 : 1; } return s; };
  const out = [];
  for (const p of authState().projects || []) { const s = score(p.name); if (s >= 0 && p.lat != null) out.push({ kind: "project", label: p.name, sub: "Project", lon: p.lon, lat: p.lat, id: p.id, s: s + 4 }); }
  for (const g of gauges) { const s = score(g.name); if (s >= 0) out.push({ kind: "gauge", label: g.name, sub: `Gauge · ${g.source}${g.flow != null ? " · " + Math.round(g.flow) + " cfs" : ""}`, lon: g.lon, lat: g.lat, id: g.id, s: s + 2 }); }
  for (const st of stations) { const s = score(st.name + " " + (st.ids?.["10"] || "")); if (s >= 0) out.push({ kind: "station", label: st.name, sub: `Station · ${st.network}${st.total != null ? " · " + st.total.toFixed(2) + '"' : ""}`, lon: st.lon, lat: st.lat, id: st.sid, s }); }
  return out.sort((a, b) => b.s - a.s).slice(0, 8);
}
async function placeMatches(q) {
  const c = map.getCenter();
  const url = `${PHOTON}?q=${encodeURIComponent(q)}&limit=5&lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&bbox=${REGION_BBOX.join(",")}`;
  const d = await getJSON(url, { ttl: 60_000 });
  return (d.features || []).map((f) => {
    const p = f.properties; const [lon, lat] = f.geometry.coordinates;
    const name = [p.name, p.street, p.city || p.town || p.village, p.county, p.state].filter(Boolean);
    return { kind: "place", label: name.slice(0, 2).join(", "), sub: `Place · ${name.slice(2).join(", ")}${p.osm_value ? " · " + p.osm_value.replace(/_/g, " ") : ""}`, lon, lat, s: 0 };
  });
}
function render(box, list, loading) {
  activeIdx = -1;
  if (!list.length && !loading) { box.innerHTML = `<div class="sr-empty">No matches</div>`; box.hidden = false; return; }
  box.innerHTML = list.map((it, i) => `<div class="sr-item" data-i="${i}"><span class="sr-kind ${it.kind}">${it.kind === "gauge" ? "▲" : it.kind === "station" ? "●" : it.kind === "project" ? "★" : it.kind === "recent" ? "🕘" : "⌖"}</span><div><div>${escapeHtml(it.label)}</div><div class="small">${escapeHtml(it.sub)}</div></div></div>`).join("") + (loading ? `<div class="sr-empty">Searching places…</div>` : "");
  box.hidden = false;
  box.querySelectorAll(".sr-item").forEach((el) => el.addEventListener("mousedown", (e) => { e.preventDefault(); choose(list[Number(el.dataset.i)]); }));
}
function highlight(box) { box.querySelectorAll(".sr-item").forEach((el, i) => el.classList.toggle("active", i === activeIdx)); }
function choose(it) {
  $("search-results").hidden = true; $("ctl-search").value = it.label;
  const zoom = it.zoom || (it.kind === "place" ? 12 : Math.max(map.getZoom(), 11));
  map.flyTo({ center: [it.lon, it.lat], zoom });
  if (it.kind === "gauge") emit("select:gauge", { id: it.id });
  else if (it.kind === "station") emit("select:station", { sid: it.id });
  else if (it.kind === "project") emit("select:project", { id: it.id });
  else emit("select:point", { lon: it.lon, lat: it.lat });
}
