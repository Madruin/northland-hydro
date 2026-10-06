// Climate and snowpack at a point from Daymet V4 R1 (ORNL DAAC): modeled daily precipitation, snow water equivalent and
// temperature on a 1 km grid, 1980 to the last complete year. ORNL's single-pixel API needs no login but sends no CORS
// header, so the site's own server passes it through at /api/daymet/data (deploy/railway/Caddyfile; tools/dev_server.py
// locally). About 0.5 MB per point, so the card loads when its row is opened and is kept for the session.
import { escapeHtml, fmt, plotlyLayout } from "./util.js";
import { plot } from "./loader.js";

const cache = new Map(); // ~1 km cell → parsed series
const MM_IN = 25.4, cToF = (c) => (c * 9) / 5 + 32;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateOf = (y, yd) => new Date(Date.UTC(y, 0, yd)); // Daymet years have 365 days (Dec 31 dropped in leap years)
const md = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const mdy = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
// Last year Daymet has published (each year is released around May of the next)
const lastYear = () => { const n = new Date(); return n.getUTCMonth() >= 5 ? n.getUTCFullYear() - 1 : n.getUTCFullYear() - 2; };

async function fetchSeries(lon, lat) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    const end = lastYear();
    const r = await fetch(`api/daymet/data?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&vars=prcp,swe,tmax,tmin&start=1980-01-01&end=${end}-12-31`);
    if (!r.ok) throw new Error(`Daymet ${r.status}`);
    const text = await r.text(); const lines = text.split(/\r?\n/);
    const h = lines.findIndex((l) => l.startsWith("year,yday")); if (h < 0) throw new Error("Daymet returned no data for this point");
    const cols = lines[h].split(","); const ix = (re) => cols.findIndex((c) => re.test(c));
    const iP = ix(/^prcp/), iS = ix(/^swe/), iX = ix(/^tmax/), iN = ix(/^tmin/);
    const elev = +(text.match(/Elevation:\s*([\d.]+)\s*meters/)?.[1] ?? NaN);
    const rows = [];
    for (const l of lines.slice(h + 1)) { if (!l) continue; const v = l.split(",").map(Number); rows.push({ y: v[0], d: v[1], p: v[iP], swe: v[iS], tx: v[iX], tn: v[iN] }); }
    return { rows, elev, end };
  })();
  cache.set(key, p); p.catch(() => cache.delete(key));
  return p;
}

function summarize({ rows, end }) {
  const y0 = end - 29; // 30-year normals
  const recent = rows.filter((r) => r.y >= y0);
  const annual = {}; for (const r of recent) annual[r.y] = (annual[r.y] || 0) + r.p;
  const meanAnnual = Object.values(annual).reduce((a, b) => a + b, 0) / Object.keys(annual).length / MM_IN;
  const mon = MONTHS.map(() => ({ p: 0, tx: 0, tn: 0, n: 0 }));
  for (const r of recent) { const m = dateOf(r.y, r.d).getUTCMonth(); mon[m].p += r.p; mon[m].tx += r.tx; mon[m].tn += r.tn; mon[m].n++; }
  const years = 30;
  const monthly = mon.map((m, i) => ({ m: MONTHS[i], p: m.p / years / MM_IN, hi: cToF(m.tx / m.n), lo: cToF(m.tn / m.n) }));
  // snow seasons Aug–Jul; only complete ones
  const seasons = {};
  for (const r of rows) { const dt = dateOf(r.y, r.d); const s = dt.getUTCMonth() >= 7 ? r.y : r.y - 1; (seasons[s] ||= []).push({ dt, swe: r.swe }); }
  const winters = [];
  for (const [s, arr] of Object.entries(seasons)) {
    if (+s < rows[0].y || +s + 1 > end) continue;
    let pk = 0, pi = 0; arr.forEach((x, i) => { if (x.swe > pk) { pk = x.swe; pi = i; } });
    if (pk < 2.5) { winters.push({ s: +s, peak: pk, peakDate: null, melt: null, days: 0 }); continue; }
    const mi = arr.findIndex((x, i) => i > pi && x.swe < 1); const melt = mi > 0 ? arr[mi].dt : null;
    const meltDoy = melt ? Math.round((melt - Date.UTC(melt.getUTCFullYear(), 0, 1)) / 864e5) + 1 : null;
    winters.push({ s: +s, peak: pk, peakDate: arr[pi].dt, melt, meltDoy, days: arr.filter((x) => x.swe >= 2.5).length });
  }
  const recentW = winters.filter((w) => w.s >= y0 - 1);
  const ft = {}; for (const r of recent) if (r.tx > 0 && r.tn < 0) ft[r.y] = (ft[r.y] || 0) + 1;
  // wettest day and 3 days over the whole record
  let w1 = { p: -1 }, w3 = { p: -1 };
  for (let i = 0; i < rows.length; i++) { const r = rows[i]; if (r.p > w1.p) w1 = { p: r.p, dt: dateOf(r.y, r.d) }; if (i >= 2) { const s3 = r.p + rows[i - 1].p + rows[i - 2].p; if (s3 > w3.p) w3 = { p: s3, dt: dateOf(r.y, r.d) }; } }
  const heavy = recent.filter((r) => r.p >= MM_IN).length / years;
  const meltDoys = recentW.map((w) => w.meltDoy).filter(Boolean);
  const medMelt = quant(meltDoys, 0.5);
  return { y0, end, meanAnnual, monthly, winters, recentW,
    swe50: quant(recentW.map((w) => w.peak), 0.5) / MM_IN, swe90: quant(recentW.map((w) => w.peak), 0.9) / MM_IN,
    melt50: medMelt ? dateOf(2001, Math.round(medMelt)) : null, meltEarly: meltDoys.length ? dateOf(2001, quant(meltDoys, 0.1) | 0) : null, meltLate: meltDoys.length ? dateOf(2001, Math.round(quant(meltDoys, 0.9))) : null,
    snowDays: quant(recentW.map((w) => w.days), 0.5), freezeThaw: quant(Object.values(ft), 0.5), w1, w3, heavy };
}

export async function renderClimateAt(el, lon, lat) {
  el.innerHTML = `<div class="spinner">Daymet 1980–${lastYear()} daily climate for this 1 km cell (about 0.5 MB, 5–10 s)…</div>`;
  let s, data;
  try { data = await fetchSeries(lon, lat); s = summarize(data); }
  catch (e) { el.innerHTML = `<div class="notice">Daymet request failed: ${escapeHtml(e.message)}. <a href="https://daymet.ornl.gov/single-pixel/" target="_blank" rel="noopener">Daymet single-pixel tool</a></div>`; return; }
  if (!el.isConnected) return;
  const id = "dm-swe-" + Math.random().toString(36).slice(2, 7);
  el.innerHTML = `<h3>Climate and snowpack · Daymet 1 km, ${s.y0}–${s.end}</h3>
    <div class="stat-row">
      <div class="stat"><div class="v">${fmt(s.meanAnnual, 1)}"</div><div class="l">mean annual precipitation</div><div class="s">${fmt(s.heavy, 1)} days/yr with ≥ 1"</div></div>
      <div class="stat"><div class="v">${fmt(s.swe50, 1)}"</div><div class="l">peak snowpack, median (SWE)</div><div class="s">1 winter in 10 above ${fmt(s.swe90, 1)}"</div></div>
      <div class="stat"><div class="v">${s.melt50 ? md(s.melt50) : "–"}</div><div class="l">snowpack gone, median</div><div class="s">${s.meltEarly ? `9 in 10 winters ${md(s.meltEarly)} to ${md(s.meltLate)}` : ""}</div></div>
      <div class="stat"><div class="v">${s.freezeThaw != null ? Math.round(s.freezeThaw) : "–"}</div><div class="l">freeze–thaw days per year</div><div class="s">high above 32 °F, low below</div></div>
    </div>
    <div id="${id}" class="chart"></div>
    <table class="data"><thead><tr><th>Month</th>${s.monthly.map((m) => `<th class="num">${m.m}</th>`).join("")}</tr></thead><tbody>
      <tr><td>Precip, in</td>${s.monthly.map((m) => `<td class="num">${fmt(m.p, 1)}</td>`).join("")}</tr>
      <tr><td>High, °F</td>${s.monthly.map((m) => `<td class="num">${Math.round(m.hi)}</td>`).join("")}</tr>
      <tr><td>Low, °F</td>${s.monthly.map((m) => `<td class="num">${Math.round(m.lo)}</td>`).join("")}</tr></tbody></table>
    <div class="small">Wettest day in the record: ${fmt(s.w1.p / MM_IN, 2)}" on ${mdy(s.w1.dt)}; wettest 3 days: ${fmt(s.w3.p / MM_IN, 2)}" ending ${mdy(s.w3.dt)}. Gridded daily values smooth out local extremes, so use Atlas 14 (below) for design storms.</div>
    <div class="small">Daymet V4 R1 (Thornton et al., ORNL DAAC, <a href="https://doi.org/10.3334/ORNLDAAC/2129" target="_blank" rel="noopener">doi:10.3334/ORNLDAAC/2129</a>): daily weather modeled from station data on a 1 km grid${Number.isFinite(data.elev) ? `; this cell's elevation ${Math.round(data.elev * 3.281)} ft` : ""}. Snow water equivalent (SWE) is a model estimate, not a measurement. Normals are ${s.y0}–${s.end}; extremes use the full record from 1980.</div>`;
  const W = s.winters;
  plot(id, [{ x: W.map((w) => `${w.s}–${String(w.s + 1).slice(2)}`), y: W.map((w) => w.peak / MM_IN), type: "bar", marker: { color: "#7dd3fc" }, hovertemplate: "%{x}: %{y:.1f} in SWE<extra></extra>" }],
    plotlyLayout({ title: "Peak snowpack each winter (in of water)", yaxis: { title: "in SWE" }, showlegend: false }), { displayModeBar: false, responsive: true });
}
