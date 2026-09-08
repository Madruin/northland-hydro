// National Weather Service API (api.weather.gov). CORS-enabled.
import { ENDPOINTS } from "../config.js";
import { getJSON } from "../util.js";

const H = { Accept: "application/geo+json" };

export async function pointInfo(lat, lon) {
  const p = await getJSON(`${ENDPOINTS.nws}/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: H, ttl: 60 * 60_000 });
  return p.properties; // gridId, gridX, gridY, forecast, forecastHourly, forecastGridData, observationStations, radarStation, relativeLocation
}
export async function forecast(props) {
  const f = await getJSON(props.forecast, { headers: H, ttl: 15 * 60_000 });
  return f.properties.periods;
}
export async function hourly(props) {
  const f = await getJSON(props.forecastHourly, { headers: H, ttl: 15 * 60_000 });
  return f.properties.periods;
}
// Gridpoint raw data: quantitativePrecipitation (mm over a validTime ISO interval)
export async function gridQpf(props) {
  const g = await getJSON(props.forecastGridData, { headers: H, ttl: 15 * 60_000 });
  const q = g.properties.quantitativePrecipitation;
  const out = [];
  for (const v of q?.values || []) {
    const [start, dur] = v.validTime.split("/");
    out.push({ start: new Date(start), hours: isoDurationHours(dur), inches: (v.value ?? 0) / 25.4 });
  }
  return { values: out, updated: g.properties.updateTime };
}
function isoDurationHours(d) {
  const m = d.match(/P(?:(\d+)D)?T?(?:(\d+)H)?/);
  return Number(m?.[1] || 0) * 24 + Number(m?.[2] || 0);
}
export async function nearestStations(props, n = 3) {
  const s = await getJSON(props.observationStations, { headers: H, ttl: 60 * 60_000 });
  return s.features.slice(0, n).map((f) => ({ id: f.properties.stationIdentifier, name: f.properties.name }));
}
export async function latestObs(stationId) {
  const o = await getJSON(`${ENDPOINTS.nws}/stations/${stationId}/observations/latest`, { headers: H, ttl: 5 * 60_000 });
  const p = o.properties;
  const cToF = (c) => (c == null ? null : (c * 9) / 5 + 32);
  return { time: p.timestamp, text: p.textDescription, tempF: cToF(p.temperature?.value), dewF: cToF(p.dewpoint?.value),
    windMph: p.windSpeed?.value == null ? null : p.windSpeed.value * 0.621371, windDir: p.windDirection?.value,
    rh: p.relativeHumidity?.value, precip1hIn: p.precipitationLastHour?.value == null ? null : p.precipitationLastHour.value / 25.4,
    precip6hIn: p.precipitationLast6Hours?.value == null ? null : p.precipitationLast6Hours.value / 25.4 };
}
// Active alerts by point or state area.
export async function activeAlerts({ point, area } = {}) {
  const url = point ? `${ENDPOINTS.nws}/alerts/active?point=${point[0].toFixed(4)},${point[1].toFixed(4)}` : `${ENDPOINTS.nws}/alerts/active?area=${area}`;
  const a = await getJSON(url, { headers: H, ttl: 5 * 60_000 });
  return a.features.map((f) => ({ id: f.id, event: f.properties.event, severity: f.properties.severity, headline: f.properties.headline,
    sender: f.properties.senderName, areas: f.properties.areaDesc, onset: f.properties.onset, ends: f.properties.ends || f.properties.expires,
    description: f.properties.description }));
}
