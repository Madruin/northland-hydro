// "Zoom to my location" control. Replaces MapLibre's GeolocateControl, which greys itself out permanently when the
// browser reports the permission as denied; this one always stays clickable and explains what to do instead.
const ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="9"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>`;

export class LocateControl {
  constructor({ onStatus = () => {} } = {}) { this.onStatus = onStatus; this.watch = null; this.pos = null; this.follow = false; }
  onAdd(map) {
    this.map = map;
    const c = document.createElement("div"); c.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const b = document.createElement("button"); b.type = "button"; b.className = "locate-btn"; b.title = "Zoom to my location (click again to stop following)"; b.setAttribute("aria-label", b.title);
    b.innerHTML = ICON; b.addEventListener("click", () => this.toggle());
    c.append(b); this.btn = b; this.container = c;
    map.on("style.load", () => this.ensureLayers());
    map.on("dragstart", () => { if (this.follow) { this.follow = false; this.btn.classList.remove("following"); } });
    return c;
  }
  onRemove() { this.stop(); this.container.remove(); this.map = null; }
  ensureLayers() {
    const m = this.map; if (!m || !m.getStyle()) return;
    if (!m.getSource("locate")) {
      m.addSource("locate", { type: "geojson", data: this.geo() });
      m.addLayer({ id: "locate-acc", type: "fill", source: "locate", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#2563eb", "fill-opacity": 0.12 } });
      m.addLayer({ id: "locate-acc-line", type: "line", source: "locate", filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-color": "#2563eb", "line-width": 1, "line-opacity": 0.5 } });
      m.addLayer({ id: "locate-dot", type: "circle", source: "locate", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 7, "circle-color": "#2563eb", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } });
    } else m.getSource("locate").setData(this.geo());
  }
  geo() {
    if (!this.pos) return { type: "FeatureCollection", features: [] };
    const { lon, lat, acc } = this.pos;
    const feats = [{ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: {} }];
    if (acc && acc < 5000) {
      const dLat = acc / 111320, dLon = acc / (111320 * Math.cos((lat * Math.PI) / 180));
      const ring = []; for (let i = 0; i <= 64; i++) { const a = (i / 64) * 2 * Math.PI; ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]); }
      feats.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} });
    }
    return { type: "FeatureCollection", features: feats };
  }
  toggle() { if (this.watch != null) this.stop(); else this.start(); }
  start() {
    if (!navigator.geolocation) { this.onStatus("This browser has no location support.", true); return; }
    if (!window.isSecureContext) { this.onStatus("Location needs an https address.", true); return; }
    this.btn.classList.add("busy"); this.onStatus("Finding your location…");
    let first = true;
    this.watch = navigator.geolocation.watchPosition((p) => {
      this.pos = { lon: p.coords.longitude, lat: p.coords.latitude, acc: p.coords.accuracy };
      this.btn.classList.remove("busy"); this.btn.classList.add("following"); this.follow = true;
      this.ensureLayers();
      if (first) { first = false; this.map.flyTo({ center: [this.pos.lon, this.pos.lat], zoom: Math.max(this.map.getZoom(), 14), duration: 900 }); this.onStatus(`Located to ±${Math.round(p.coords.accuracy * 3.281)} ft. Following; drag the map or click the button to stop.`); }
      else if (this.follow) this.map.easeTo({ center: [this.pos.lon, this.pos.lat], duration: 500 });
    }, (err) => {
      this.stop();
      const msg = err.code === 1
        ? "Location is blocked for this site. Click the lock icon in the address bar, allow Location for northland.eco, then try again."
        : err.code === 2 ? "Location unavailable (no GPS fix). Try again outdoors or on a phone." : "Location request timed out. Try again.";
      this.onStatus(msg, true);
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }
  stop() {
    if (this.watch != null) navigator.geolocation.clearWatch(this.watch);
    this.watch = null; this.follow = false; this.btn?.classList.remove("busy", "following");
  }
}
