// Imagery compare: a second MapLibre map, kept in sync with the main map, clipped to the right of a draggable
// divider so any two imagery years (or imagery vs the current basemap) can be swiped against each other.
import { BASEMAPS } from "./config.js";

const ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 2v20M7 9l-2 3 2 3M17 9l2 3-2 3"/></svg>`;

export class CompareControl {
  constructor() { this.active = false; this.frac = 0.5; this.right = "imgsharp"; }
  onAdd(map) {
    this.map = map;
    const c = document.createElement("div"); c.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const b = document.createElement("button"); b.type = "button"; b.title = "Compare imagery years (swipe)"; b.setAttribute("aria-label", b.title); b.innerHTML = ICON; b.addEventListener("click", () => this.toggle());
    c.append(b); this.btn = b; this.container = c; return c;
  }
  onRemove() { this.exit(); this.container.remove(); }
  toggle() { this.active ? this.exit() : this.start(); }
  imageryOptions() { return Object.entries(BASEMAPS).filter(([id]) => id.startsWith("img") || id === "imagery").map(([id, b]) => ({ id, label: b.label })); }
  start() {
    this.active = true; this.btn.classList.add("active");
    const wrap = document.getElementById("map-wrap");
    this.el = document.createElement("div"); this.el.id = "compare"; this.el.innerHTML = `<div id="compare-map"></div><div id="compare-handle" title="Drag to swipe"><div class="ch-bar"></div><div class="ch-grip">⇔</div></div>
      <div id="compare-box" class="floating"><span class="small">Left: current basemap</span><label class="small">Right: <select id="compare-sel">${this.imageryOptions().map((o) => `<option value="${o.id}" ${o.id === this.right ? "selected" : ""}>${o.label}</option>`).join("")}</select></label><button class="mb-x" title="Close compare">✕</button></div>`;
    wrap.append(this.el);
    const m = this.map;
    this.cmap = new maplibregl.Map({ container: "compare-map", style: BASEMAPS[this.right].style, center: m.getCenter(), zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch(), interactive: false, attributionControl: false, maxZoom: 19, minZoom: 5 });
    this.sync = () => this.cmap.jumpTo({ center: m.getCenter(), zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() });
    m.on("move", this.sync);
    this.ro = new ResizeObserver(() => { this.cmap.resize(); this.layout(); }); this.ro.observe(wrap);
    const h = this.el.querySelector("#compare-handle"); let drag = false;
    h.addEventListener("pointerdown", (e) => { drag = true; h.setPointerCapture(e.pointerId); e.preventDefault(); });
    h.addEventListener("pointermove", (e) => { if (!drag) return; const r = wrap.getBoundingClientRect(); this.frac = Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width)); this.layout(); });
    const up = () => { drag = false; }; h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
    this.el.querySelector("#compare-sel").addEventListener("change", (e) => { this.right = e.target.value; this.cmap.setStyle(BASEMAPS[this.right].style); });
    this.el.querySelector(".mb-x").addEventListener("click", () => this.exit());
    this.layout();
  }
  layout() {
    if (!this.el) return; const w = this.el.getBoundingClientRect().width; const x = Math.round(w * this.frac);
    this.el.querySelector("#compare-map").style.clipPath = `inset(0 0 0 ${x}px)`;
    this.el.querySelector("#compare-handle").style.left = `${x}px`;
  }
  exit() {
    if (!this.active) return; this.active = false; this.btn.classList.remove("active");
    this.map.off("move", this.sync); this.ro?.disconnect(); this.cmap?.remove(); this.el?.remove(); this.el = null; this.cmap = null;
  }
}
