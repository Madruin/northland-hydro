// NOAA CO-OPS water levels (Lake Superior at Duluth). CORS-enabled.
import { ENDPOINTS, LAKE_STATION } from "../config.js";
import { getJSON } from "../util.js";

const base = (product, extra) => `${ENDPOINTS.coops}?station=${LAKE_STATION.id}&product=${product}&datum=${LAKE_STATION.datum}&units=english&time_zone=lst_ldt&format=json&application=northland-hydro&${extra}`;
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

export async function latestLevel() {
  const r = await getJSON(base("water_level", "date=latest"), { ttl: 5 * 60_000 });
  const d = r.data?.[0];
  return d ? { time: d.t, ft: Number(d.v) } : null;
}
export async function hourlyLevels(days = 30) {
  const end = new Date(), start = new Date(Date.now() - days * 86400e3);
  const r = await getJSON(base("water_level", `begin_date=${ymd(start)}&end_date=${ymd(end)}&interval=h`), { ttl: 30 * 60_000 });
  return (r.data || []).filter((d) => d.v !== "").map((d) => ({ t: d.t, ft: Number(d.v) }));
}
export async function monthlyMeans(years = 5) {
  const end = new Date(), start = new Date(end.getFullYear() - years, end.getMonth(), 1);
  const r = await getJSON(base("monthly_mean", `begin_date=${ymd(start)}&end_date=${ymd(end)}`), { ttl: 6 * 3600_000 });
  return (r.data || []).map((d) => ({ year: Number(d.year), month: Number(d.month), msl: Number(d.MSL), high: Number(d.highest), low: Number(d.lowest) })).filter((d) => !isNaN(d.msl));
}
