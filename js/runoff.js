// Design-storm runoff for a delineated basin: NRCS curve-number runoff depth (TR-55 eq. 2-3) from the basin's
// SSURGO-weighted composite CN and the point's Atlas 14 24-hour depths, volume, SCS-lag time of concentration,
// and a TR-55 graphical-method peak. Screening only: the unit-peak curve is the Type II distribution; NRCS
// Minnesota designs with the MSE3 distribution in this region (EFH-2 / WinTR-55), which gives different peaks.
import { escapeHtml, fmt, fmtNum } from "./util.js";
import { basinHsg, CN, composite } from "./basinsoils.js";
import * as atlas from "./api/atlas14.js";
import { basinLandCover, landCoverCN, NLCD_YEAR } from "./landcover.js";

// TR-55 Exhibit 4-II coefficients (Type II) for qu = 10^(C0 + C1 log Tc + C2 log²Tc), csm per inch, by Ia/P
const TYPE_II = [[0.10, 2.55323, -0.61512, -0.16403], [0.30, 2.46532, -0.62257, -0.11657], [0.35, 2.41896, -0.61594, -0.08820], [0.40, 2.36409, -0.59857, -0.05621], [0.45, 2.29238, -0.57005, -0.02281], [0.50, 2.20282, -0.51599, -0.01259]];
const POND = [[0, 1], [0.2, 0.97], [1, 0.87], [3, 0.75], [5, 0.72]]; // TR-55 Table 4-2 pond and swamp adjustment
function interp(pairs, x, idx = 1) { if (x <= pairs[0][0]) return pairs[0][idx]; for (let i = 1; i < pairs.length; i++) if (x <= pairs[i][0]) { const [x0, x1] = [pairs[i - 1][0], pairs[i][0]]; const f = (x - x0) / (x1 - x0); return pairs[i - 1][idx] + f * (pairs[i][idx] - pairs[i - 1][idx]); } return pairs[pairs.length - 1][idx]; }
function unitPeak(tcHr, iaOverP) { const r = Math.min(0.5, Math.max(0.1, iaOverP)); const c0 = interp(TYPE_II, r, 1), c1 = interp(TYPE_II, r, 2), c2 = interp(TYPE_II, r, 3); const lt = Math.log10(Math.min(10, Math.max(0.1, tcHr))); return 10 ** (c0 + c1 * lt + c2 * lt * lt); }
export function runoffDepth(P, cn) { const S = 1000 / cn - 10; const Ia = 0.2 * S; return P <= Ia ? 0 : ((P - Ia) ** 2) / (P - Ia + S); }
export function scsLagTc({ lengthFt, cn, slopePct }) { if (!lengthFt || !slopePct) return null; const S = 1000 / cn - 10; const lag = (lengthFt ** 0.8 * (S + 1) ** 0.7) / (1900 * Math.sqrt(slopePct)); return lag / 0.6; }

export async function renderRunoff(container, { geometry, daSqMi, lat, lon, bc = {} }) {
  container.innerHTML = `<h3>Design-storm runoff · TR-55 screening</h3><div class="spinner">Basin soils and Atlas 14…</div>`;
  try {
    const [soils, , lc] = await Promise.all([basinHsg(geometry), atlas.loadAtlas14(), basinLandCover(geometry).catch((e) => ({ error: e.message }))]);
    if (!container.isConnected) return;
    const a14 = atlas.nearest(lat, lon); const di = a14?.durations.indexOf("24-hr");
    if (!a14 || di < 0) { container.innerHTML = `<h3>Design-storm runoff · TR-55 screening</h3><div class="notice">No Atlas 14 grid node here.</div>`; return; }
    const LC = `Actual land cover (NLCD ${NLCD_YEAR})`; const lcOk = lc && !lc.error;
    const covers = [...(lcOk ? [LC] : []), ...Object.keys(CN)]; let cover = lcOk ? LC : "Woods, good condition"; let drained = false, saturated = false;
    const lengthMi = bc.LFPLENGTH ?? null, slopePct = bc.BSLDEM10M ?? null, lakePct = bc.LAKEAREA ?? 0;
    const draw = () => {
      const split = drained ? soils.effDrained : soils.eff;
      const lcr = cover === LC ? landCoverCN(lc, split, { saturatedWetlands: saturated }) : null; const cn = lcr ? lcr.cn : composite(split, CN[cover]);
      if (!cn) { container.innerHTML = `<h3>Design-storm runoff · TR-55 screening</h3><div class="notice">Basin soils are unrated, so no curve number.</div>`; return; }
      const tc = scsLagTc({ lengthFt: lengthMi ? lengthMi * 5280 : null, cn, slopePct });
      const fp = interp(POND, lakePct || 0); const acres = daSqMi * 640;
      const rows = [1, 2, 5, 10, 25, 50, 100].map((yr) => { const ai = a14.aris.indexOf(yr); const P = ai >= 0 ? a14.q[di][ai] : null; if (P == null) return null; const Q = runoffDepth(P, cn); const iaP = (0.2 * (1000 / cn - 10)) / P; const qu = tc ? unitPeak(tc, iaP) : null; const qp = qu ? qu * daSqMi * Q * fp : null; return { yr, P, Q, vol: (Q / 12) * acres, iaP, qp }; }).filter(Boolean);
      container.innerHTML = `<h3>Design-storm runoff · TR-55 screening</h3>
        <div class="actions"><label class="ctl-inline">Cover <select id="ro-cover">${covers.map((c) => `<option ${c === cover ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select></label><label class="ctl-inline"><input type="checkbox" id="ro-drained" ${drained ? "checked" : ""}/> dual-group soils drained</label>${lcr ? `<label class="ctl-inline" title="Wetlands already full at storm time shed nearly all rain; common for spring or back-to-back storms"><input type="checkbox" id="ro-sat" ${saturated ? "checked" : ""}/> wetlands saturated (CN 98)</label>` : ""}</div>
        ${lc?.error ? `<div class="notice">Land cover unavailable: ${escapeHtml(lc.error)}. The CN below uses the single cover type selected.</div>` : ""}
        <div class="stat-row">
          <div class="stat"><div class="v">${fmt(cn, 0)}</div><div class="l">composite CN (AMC II)</div><div class="s">${lcr ? `NLCD ${NLCD_YEAR} land cover × soils` : escapeHtml(cover)} on the basin's HSG mix (A ${fmt(100 * split.A, 0)} · B ${fmt(100 * split.B, 0)} · C ${fmt(100 * split.C, 0)} · D ${fmt(100 * split.D, 0)}%)${drained ? " · dual-group soils taken as drained" : ""}${lcr && saturated ? " · wetlands taken as saturated (CN 98)" : ""}</div></div>
          <div class="stat"><div class="v">${tc ? fmt(tc, 2) : "–"}</div><div class="l">Tc, hours (SCS lag)</div><div class="s">${lengthMi ? `longest flow path ${fmt(lengthMi, 2)} mi, slope ${fmt(slopePct, 1)}%` : "needs basin characteristics"}</div></div>
          <div class="stat"><div class="v">${fmt(fp, 2)}</div><div class="l">pond/swamp factor Fp</div><div class="s">${fmt(lakePct, 1)}% lakes and ponds</div></div>
        </div>
        ${(() => { const w = []; // TR-55 chapter 4 limits: say so instead of clamping silently
          if (tc != null && (tc < 0.1 || tc > 10)) w.push(`Tc of ${fmt(tc, 2)} h is outside the graphical method's 0.1–10 h range; the peak uses ${tc < 0.1 ? "0.1" : "10"} h and is not reliable.`);
          if (lakePct > 5) w.push(`Lakes and ponds cover ${fmt(lakePct, 1)}% of the basin; TR-55's pond factor only applies up to 5% (the table uses 0.72), so route storage explicitly instead.`);
          if (cn < 40) w.push(`CN ${fmt(cn, 0)} is below the method's lower limit of 40.`);
          return w.length ? `<div class="notice">${w.map(escapeHtml).join(" ")}</div>` : ""; })()}
        <table class="data"><thead><tr><th>Storm</th><th class="num">P 24-hr, in</th><th class="num">Runoff Q, in</th><th class="num">Volume, ac-ft</th><th class="num">Ia/P</th><th class="num">Peak qp, cfs</th></tr></thead><tbody>
          ${rows.map((r) => `<tr class="${r.yr === 100 ? "band" : ""}"><td>${r.yr}-yr</td><td class="num">${fmt(r.P)}</td><td class="num">${fmt(r.Q)}</td><td class="num">${fmtNum(r.vol, r.vol < 10 ? 1 : 0)}</td><td class="num">${fmt(r.iaP)}${r.iaP < 0.1 || r.iaP > 0.5 ? "*" : ""}</td><td class="num">${r.qp != null ? fmtNum(r.qp) : "–"}</td></tr>`).join("")}</tbody></table>
        ${lcr ? `<details class="lc-table"><summary>Land cover in the basin (${lcr.rows.length} classes, ${lc.cellM} m cells) and the CN each contributes</summary>
          <table class="data"><thead><tr><th>NLCD class</th><th class="num">% of basin</th><th>TR-55 cover used</th><th class="num">CN A/B/C/D</th><th class="num">CN on basin soils</th></tr></thead><tbody>
          ${lcr.rows.map((r) => `<tr><td><span class="swatch sq" style="background:${r.color}"></span>${escapeHtml(r.name)}</td><td class="num">${fmt(100 * r.frac, 1)}</td><td class="small">${escapeHtml(r.tr55)}</td><td class="num small">${r.t.A}/${r.t.B}/${r.t.C}/${r.t.D}</td><td class="num">${fmt(r.cn, 0)}</td></tr>`).join("")}</tbody></table>
          <div class="small">Land cover and soil groups are crossed as if independent across the basin (screening practice); forests are taken as "woods, good" and wetlands as their vegetated analog unless marked saturated. Check cover condition in the field before design.</div></details>` : ""}
        <div class="small">Runoff depth from the NRCS curve-number equation with Ia = 0.2S, 24-hour Atlas 14 depths at the point; volume = Q × area. Peak from the TR-55 graphical method with <b>Type II</b> unit-peak curves; NRCS Minnesota uses the MSE3 distribution here (EFH-2, WinTR-55), so treat the peaks as screening values and rerun in the design tool with a field-verified CN and Tc. * Ia/P outside 0.1–0.5 is clamped. Compare with the regression peaks above: they are gauge-based and independent of CN.</div>`;
      container.querySelector("#ro-cover").addEventListener("change", (e) => { cover = e.target.value; draw(); });
      container.querySelector("#ro-drained").addEventListener("change", (e) => { drained = e.target.checked; draw(); });
      container.querySelector("#ro-sat")?.addEventListener("change", (e) => { saturated = e.target.checked; draw(); });
    };
    draw();
  } catch (e) { container.innerHTML = `<h3>Design-storm runoff · TR-55 screening</h3><div class="notice">Could not compute: ${escapeHtml(e.message)}</div>`; }
}
