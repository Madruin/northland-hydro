// Right-click (long-press on a phone) on the map: quick actions for that spot without opening the full Point panel.
import { emit, escapeHtml } from "./util.js";
import { map } from "./map.js";
import { utmFeet } from "./coords.js";
import { addPointAt } from "./field.js";

let menu = null;
const close = () => { menu?.remove(); menu = null; };
async function copy(text, btn) { try { await navigator.clipboard.writeText(text); btn.textContent = "Copied ✓"; setTimeout(close, 600); } catch { prompt("Copy:", text); close(); } }

export function initMapMenu() {
  map.on("contextmenu", (e) => {
    e.preventDefault?.(); close();
    const { lng: lon, lat } = e.lngLat; const f = utmFeet(lon, lat);
    const ll = `${lat.toFixed(6)}, ${lon.toFixed(6)}`, utm = `${f.e.toFixed(2)},${f.n.toFixed(2)}`;
    menu = document.createElement("div"); menu.className = "map-menu"; menu.setAttribute("role", "menu");
    menu.innerHTML = `<div class="mm-head">${escapeHtml(ll)}</div>
      <button role="menuitem" data-a="point">📍 What's here (Point panel)</button>
      <button role="menuitem" data-a="field">✚ Add a field point here</button>
      <button role="menuitem" data-a="ll">⧉ Copy lat, lon</button>
      <button role="menuitem" data-a="utm" title="NAD83 UTM zone 15N, US survey feet (E,N), as pasted into AutoCAD">⧉ Copy UTM 15N ft (E,N)</button>
      <button role="menuitem" data-a="dir">↗ Directions (Google Maps)</button>`;
    const box = map.getContainer().getBoundingClientRect();
    menu.style.left = `${Math.min(e.point.x, box.width - 230)}px`; menu.style.top = `${Math.min(e.point.y, box.height - 200)}px`;
    map.getContainer().append(menu); menu.querySelector("button").focus();
    menu.onclick = (ev) => {
      const b = ev.target.closest("button"); if (!b) return; const a = b.dataset.a;
      if (a === "point") { emit("select:point", { lon, lat }); close(); }
      else if (a === "field") { addPointAt(lon, lat); close(); }
      else if (a === "ll") copy(ll, b);
      else if (a === "utm") copy(utm, b);
      else if (a === "dir") { window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}`, "_blank", "noopener"); close(); }
    };
    menu.onkeydown = (ev) => {
      const bs = [...menu.querySelectorAll("button")]; const i = bs.indexOf(document.activeElement);
      if (ev.key === "ArrowDown") { ev.preventDefault(); bs[(i + 1) % bs.length].focus(); }
      if (ev.key === "ArrowUp") { ev.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
      if (ev.key === "Escape") close();
    };
  });
  map.on("movestart", close); map.on("click", close);
  document.addEventListener("pointerdown", (e) => { if (menu && !menu.contains(e.target)) close(); });
}
