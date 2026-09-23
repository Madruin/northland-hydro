// Design-storm runoff for a delineated basin: NRCS curve-number runoff depth (TR-55 eq. 2-3) from the basin's
// SSURGO-weighted composite CN and the point's Atlas 14 24-hour depths, volume, SCS-lag time of concentration,
// and NRCS unit-hydrograph peaks for the MSE3 (PRF 484 and 400) and Type II distributions (js/uhpeak.js).
import { escapeHtml, fmt, fmtNum } from "./util.js";
import { basinHsg, CN, composite } from "./basinsoils.js";
import * as atlas from "./api/atlas14.js";
import { basinLandCover, landCoverCN, NLCD_YEAR } from "./landcover.js";
import { uhPeak } from "./uhpeak.js";

export function runoffDepth(P, cn) { const S = 1000 / cn - 10; const Ia = 0.2 * S; return P <= Ia ? 0 : ((P - Ia) ** 2) / (P - Ia + S); }
export function scsLagTc({ lengthFt, cn, slopePct }) { if (!lengthFt || !slopePct) return null; const S = 1000 / cn - 10; const lag = (lengthFt ** 0.8 * (S + 1) ** 0.7) / (1900 * Math.sqrt(slopePct)); return lag / 0.6; }

export async function renderRunoff(container, { geometry, daSqMi, lat, lon, bc = {} }) {
  container.innerHTML = `<h3>Design-storm runoff · NRCS unit hydrograph</h3><div class="spinner">Basin soils and Atlas 14…</div>`;
  try {
    const [soils, , lc] = await Promise.all([basinHsg(geometry), atlas.loadAtlas14(), basinLandCover(geometry).catch((e) => ({ error: e.message }))]);
    if (!container.isConnected) return;
    const a14 = atlas.nearest(lat, lon); const di = a14?.durations.indexOf("24-hr");
    if (!a14 || di < 0) { container.innerHTML = `<h3>Design-storm runoff · NRCS unit hydrograph</h3><div class="notice">No Atlas 14 grid node here.</div>`; return; }
    const LC = `Actual land cover (NLCD ${NLCD_YEAR})`; const lcOk = lc && !lc.error;
    const covers = [...(lcOk ? [LC] : []), ...Object.keys(CN)]; let cover = lcOk ? LC : "Woods, good condition"; let drained = false, saturated = false;
    const lengthMi = bc.LFPLENGTH ?? null, slopePct = bc.BSLDEM10M ?? null, lakePct = bc.LAKEAREA ?? 0;
    const draw = () => {
      const split = drained ? soils.effDrained : soils.eff;
      const lcr = cover === LC ? landCoverCN(lc, split, { saturatedWetlands: saturated }) : null; const cn = lcr ? lcr.cn : composite(split, CN[cover]);
      if (!cn) { container.innerHTML = `<h3>Design-storm runoff · NRCS unit hydrograph</h3><div class="notice">Basin soils are unrated, so no curve number.</div>`; return; }
      const tc = scsLagTc({ lengthFt: lengthMi ? lengthMi * 5280 : null, cn, slopePct });
      const acres = daSqMi * 640;
      const rows = [1, 2, 5, 10, 25, 50, 100].map((yr) => { const ai = a14.aris.indexOf(yr); const P = ai >= 0 ? a14.q[di][ai] : null; if (P == null) return null; const Q = runoffDepth(P, cn);
        // same unit-hydrograph method for all three, so the columns differ only by storm shape and peak rate factor
        const pk = (dist, prf) => (tc ? uhPeak({ P, cn, areaSqMi: daSqMi, tcHr: tc, dist, prf }) : null);
        return { yr, P, Q, vol: (Q / 12) * acres, mse3: pk("mse3", 484), mse3mn: pk("mse3", 400), t2: pk("typeII", 484) }; }).filter(Boolean);
      container.innerHTML = `<h3>Design-storm runoff · NRCS unit hydrograph</h3>
        <div class="actions"><label class="ctl-inline">Cover <select id="ro-cover">${covers.map((c) => `<option ${c === cover ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select></label><label class="ctl-inline"><input type="checkbox" id="ro-drained" ${drained ? "checked" : ""}/> dual-group soils drained</label>${lcr ? `<label class="ctl-inline" title="Wetlands already full at storm time shed nearly all rain; common for spring or back-to-back storms"><input type="checkbox" id="ro-sat" ${saturated ? "checked" : ""}/> wetlands saturated (CN 98)</label>` : ""}</div>
        ${lc?.error ? `<div class="notice">Land cover unavailable: ${escapeHtml(lc.error)}. The CN below uses the single cover type selected.</div>` : ""}
        <div class="stat-row">
          <div class="stat"><div class="v">${fmt(cn, 0)}</div><div class="l">composite CN (AMC II)</div><div class="s">${lcr ? `NLCD ${NLCD_YEAR} land cover × soils` : escapeHtml(cover)} on the basin's HSG mix (A ${fmt(100 * split.A, 0)} · B ${fmt(100 * split.B, 0)} · C ${fmt(100 * split.C, 0)} · D ${fmt(100 * split.D, 0)}%)${drained ? " · dual-group soils taken as drained" : ""}${lcr && saturated ? " · wetlands taken as saturated (CN 98)" : ""}</div></div>
          <div class="stat"><div class="v">${tc ? fmt(tc, 2) : "–"}</div><div class="l">Tc, hours (SCS lag)</div><div class="s">${lengthMi ? `longest flow path ${fmt(lengthMi, 2)} mi, slope ${fmt(slopePct, 1)}%` : "needs basin characteristics"}</div></div>
          <div class="stat"><div class="v">${fmt(lakePct, 1)}%</div><div class="l">lakes and ponds</div><div class="s">storage not routed</div></div>
        </div>
        ${(() => { const w = []; // say where a single-basin unit hydrograph is a stretch, instead of hiding it
          if (daSqMi > 20) w.push(`At ${fmt(daSqMi, 1)} mi² the basin is larger than the 20 mi² NRCS suggests for one unit hydrograph (NEH 630 ch. 16); split it into subareas and route for design.`);
          if (lakePct > 2) w.push(`Lakes and ponds cover ${fmt(lakePct, 1)}% of the basin and are not routed here, so these peaks overstate flows where storage attenuates them; route through the storage for design.`);
          if (cn < 40) w.push(`CN ${fmt(cn, 0)} is below 40, where the curve-number method is unreliable.`);
          return w.length ? `<div class="notice">${w.map(escapeHtml).join(" ")}</div>` : ""; })()}
        <table class="data"><thead><tr><th>Storm</th><th class="num">P 24-hr, in</th><th class="num">Runoff Q, in</th><th class="num">Volume, ac-ft</th><th class="num" title="NRCS MSE3 distribution, standard unit hydrograph (peak rate factor 484): MnDOT TM 15-10-B-02 default">Peak MSE3, cfs</th><th class="num" title="MSE3 with peak rate factor 400 (NRCS Minnesota 'MSE 3 MN'): rural, not-steep basins where flows match site history">MSE3 MN (PRF 400)</th><th class="num" title="Old NRCS Type II distribution, PRF 484, for comparison with older designs; MnDOT says not to use it">Type II (old)</th></tr></thead><tbody>
          ${rows.map((r) => `<tr class="${r.yr === 100 ? "band" : ""}"><td>${r.yr}-yr</td><td class="num">${fmt(r.P)}</td><td class="num">${fmt(r.Q)}</td><td class="num">${fmtNum(r.vol, r.vol < 10 ? 1 : 0)}</td><td class="num"><b>${r.mse3 ? fmtNum(r.mse3.cfs) : "–"}</b></td><td class="num">${r.mse3mn ? fmtNum(r.mse3mn.cfs) : "–"}</td><td class="num small">${r.t2 ? fmtNum(r.t2.cfs) : "–"}</td></tr>`).join("")}</tbody></table>
        ${lcr ? `<details class="lc-table"><summary>Land cover in the basin (${lcr.rows.length} classes, ${lc.cellM} m cells) and the CN each contributes</summary>
          <table class="data"><thead><tr><th>NLCD class</th><th class="num">% of basin</th><th>TR-55 cover used</th><th class="num">CN A/B/C/D</th><th class="num">CN on basin soils</th></tr></thead><tbody>
          ${lcr.rows.map((r) => `<tr><td><span class="swatch sq" style="background:${r.color}"></span>${escapeHtml(r.name)}</td><td class="num">${fmt(100 * r.frac, 1)}</td><td class="small">${escapeHtml(r.tr55)}</td><td class="num small">${r.t.A}/${r.t.B}/${r.t.C}/${r.t.D}</td><td class="num">${fmt(r.cn, 0)}</td></tr>`).join("")}</tbody></table>
          <div class="small">Land cover and soil groups are crossed as if independent across the basin (screening practice); forests are taken as "woods, good" and wetlands as their vegetated analog unless marked saturated. Check cover condition in the field before design.</div></details>` : ""}
        <div class="small">Runoff depth: NRCS curve-number equation (Ia = 0.2S) on 24-hour Atlas 14 depths at the point; volume = Q × area. Peaks: NRCS unit-hydrograph method (as in WinTR-20 and HydroCAD): the storm is spread over 24 h by the NRCS distribution, runoff excess is convolved with the NRCS dimensionless unit hydrograph (Tp = ⅔ Tc)${tc ? `; peak about ${fmt(rows.find((r) => r.yr === 100)?.mse3?.hour ?? 0, 1)} h into the 100-yr storm` : ""}. <b>MSE3</b> with peak rate factor 484 is MnDOT's recommendation (Tech Memo 15-10-B-02); <b>MSE3 MN</b> (factor 400) is NRCS Minnesota's option for rural, not-steep basins whose flows match site history; <b>Type II</b> is the pre-Atlas 14 distribution, shown only to compare with older designs. Checked against MnDOT's HydroCAD example (100 ac, CN 75, Tc 64 min, 5.68 in): 167 / 145 / 152 cfs here vs 167 / 145 / 151 cfs. One lumped basin, no routing: use for planning, and model subareas and storage for design. Compare with the gauge-based regression peaks above, which do not depend on CN or Tc.</div>`;
      container.querySelector("#ro-cover").addEventListener("change", (e) => { cover = e.target.value; draw(); });
      container.querySelector("#ro-drained").addEventListener("change", (e) => { drained = e.target.checked; draw(); });
      container.querySelector("#ro-sat")?.addEventListener("change", (e) => { saturated = e.target.checked; draw(); });
    };
    draw();
  } catch (e) { container.innerHTML = `<h3>Design-storm runoff · NRCS unit hydrograph</h3><div class="notice">Could not compute: ${escapeHtml(e.message)}</div>`; }
}
