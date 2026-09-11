// Shareable URL state in the hash: #d=2026-09-07&w=7&z=8.2&c=-92.1,46.9&b=light&l=s,g,q&q=24h&sel=station:MNSL0018
export function readUrl() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  const st = {};
  if (h.get("d")) st.endDate = h.get("d");
  if (h.get("w")) st.days = Number(h.get("w"));
  if (h.get("z")) st.zoom = Number(h.get("z"));
  if (h.get("c")) { const [lon, lat] = h.get("c").split(",").map(Number); if (isFinite(lon) && isFinite(lat)) st.center = [lon, lat]; }
  if (h.get("b")) st.basemap = h.get("b");
  if (h.get("l") != null) { const l = h.get("l").split(",").filter(Boolean); st.layers = { stations: l.includes("s"), gauges: l.includes("g"), qpe: l.includes("q"), streams: l.includes("r"), soils: l.includes("o"), parcels: l.includes("p"), trout: l.includes("t"), karst: l.includes("k"), wetlands: l.includes("w"), fema: l.includes("f"), crossings: l.includes("c") }; }
  if (h.get("q")) st.qpeWindow = h.get("q");
  if (h.get("t") != null) st.terrain = Object.fromEntries(h.get("t").split(",").filter(Boolean).map((k) => [k, true]));
  if (h.get("to")) st.terrainOpacity = Number(h.get("to")) / 100;
  if (h.get("sel")) { const [type, ...rest] = h.get("sel").split(":"); st.selection = { type, id: rest.join(":") }; }
  return st;
}
export function writeUrl(st) {
  const h = new URLSearchParams();
  h.set("d", st.endDate); h.set("w", String(st.days));
  h.set("z", st.zoom.toFixed(2)); h.set("c", `${st.center[0].toFixed(4)},${st.center[1].toFixed(4)}`);
  h.set("b", st.basemap);
  h.set("l", [st.layers.stations && "s", st.layers.gauges && "g", st.layers.qpe && "q", st.layers.streams && "r", st.layers.soils && "o", st.layers.parcels && "p", st.layers.trout && "t", st.layers.karst && "k", st.layers.wetlands && "w", st.layers.fema && "f", st.layers.crossings && "c"].filter(Boolean).join(","));
  h.set("q", st.qpeWindow);
  const t = Object.keys(st.terrain || {}).filter((k) => st.terrain[k]);
  if (t.length) { h.set("t", t.join(",")); h.set("to", String(Math.round((st.terrainOpacity ?? 0.6) * 100))); }
  if (st.selection) h.set("sel", `${st.selection.type}:${st.selection.id}`);
  history.replaceState(null, "", "#" + h.toString());
}
