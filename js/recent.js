// Last points the user opened, kept in this browser so a site can be revisited without a project entry.
const KEY = "nh-recent", MAX = 10;
export function getRecents() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } }
export function addRecent({ lon, lat, label }) {
  const list = getRecents().filter((r) => Math.abs(r.lon - lon) > 1e-4 || Math.abs(r.lat - lat) > 1e-4);
  list.unshift({ lon, lat, label: label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`, t: Date.now() });
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch {}
}
export function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 24) return `${h} h ago`; const d = Math.round(h / 24); return d === 1 ? "yesterday" : `${d} days ago`;
}
