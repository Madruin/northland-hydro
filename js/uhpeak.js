// NRCS unit-hydrograph peak flow (WinTR-20 / HydroCAD method) for a 24-hour design storm: cumulative rainfall from a
// dimensionless NRCS distribution, runoff by the curve-number equation (Ia = 0.2S), incremental excess convolved with
// the NRCS dimensionless unit hydrograph (Tp = 2/3 Tc, qp = PRF × A / Tp). Checked against MnDOT's Stearns County
// HydroCAD example (100 ac, CN 75, Tc 64 min, P24 5.68 in): MSE3/PRF 484 167.4 cfs (MnDOT 167), MSE3/PRF 400
// 145.2 (145), Type II/PRF 484 152.1 (151). MnDOT Tech Memo 15-10-B-02: use Atlas 14 depths with MSE3 (or an Atlas 14
// derived distribution) and PRF 484; "MSE 3 MN" (PRF 400) is allowed for rural, not-steep basins when flows match
// the site's history. Type II is shown only for comparison.

// NRCS MSE3 24-hour distribution, cumulative fraction at 0.1 h (0–24 h), as tabulated in SEMCOG, "Southeast Michigan
// Current and Future Precipitation" (2020), Table 5; parsed, each increment checked against the cumulative column.
const MSE3 = [0,0.000267,0.000555,0.000861,0.00119,0.00153,0.0019,0.00229,0.00269,0.00312,0.00356,0.00403,0.00451,0.00501,0.00554,0.00608,0.00665,0.00723,0.00783,0.00845,0.0091,0.00976,0.01044,0.01114,0.01186,0.0126,0.01336,0.01414,0.01494,0.01576,0.0166,0.01746,0.01834,0.01924,0.02016,0.02109,0.02205,0.02303,0.02403,0.02504,0.02608,0.02714,0.02821,0.02931,0.03042,0.03156,0.03271,0.03389,0.03508,0.0363,0.03753,0.03878,0.04006,0.04135,0.04266,0.04399,0.04535,0.04672,0.04811,0.04952,0.05095,0.0524,0.05387,0.05536,0.05687,0.0584,0.05995,0.06152,0.06311,0.06472,0.06635,0.06799,0.06966,0.07135,0.07306,0.07478,0.07653,0.0783,0.08008,0.08189,0.08371,0.08556,0.08742,0.08931,0.09121,0.09314,0.09508,0.09704,0.09903,0.10103,0.10305,0.10628,0.10956,0.11289,0.11626,0.11967,0.12314,0.12664,0.1302,0.1338,0.13744,0.14113,0.14487,0.14866,0.15248,0.15636,0.16212,0.16863,0.17591,0.18394,0.19272,0.20226,0.21256,0.22362,0.23543,0.248,0.2663,0.29062,0.32445,0.37245,0.46289,0.62755,0.67555,0.70938,0.7337,0.752,0.76457,0.77638,0.78744,0.79774,0.80728,0.81606,0.82409,0.83137,0.83788,0.84364,0.84752,0.85134,0.85513,0.85887,0.86256,0.8662,0.8698,0.87336,0.87686,0.88033,0.88374,0.88711,0.89044,0.89372,0.89695,0.89897,0.90097,0.90296,0.90492,0.90686,0.90879,0.91069,0.91258,0.91444,0.91629,0.91811,0.91992,0.9217,0.92347,0.92522,0.92694,0.92865,0.93034,0.93201,0.93365,0.93528,0.93689,0.93848,0.94005,0.9416,0.94313,0.94464,0.94613,0.9476,0.94905,0.95048,0.95189,0.95328,0.95465,0.95601,0.95734,0.95865,0.95994,0.96122,0.96247,0.9637,0.96492,0.96611,0.96729,0.96844,0.96958,0.97069,0.97179,0.97286,0.97392,0.97496,0.97597,0.97697,0.97795,0.97891,0.97984,0.98076,0.98166,0.98254,0.9834,0.98424,0.98506,0.98586,0.98664,0.9874,0.98814,0.98886,0.98956,0.99024,0.9909,0.99155,0.99217,0.99277,0.99335,0.99392,0.99446,0.99499,0.99549,0.99597,0.99644,0.99688,0.99731,0.99771,0.9981,0.99847,0.99881,0.999139,0.999445,0.999733,1];
// Type II 24-hour distribution from the fitted equation in the same report (Table 4); within 0.013 of NRCS's hourly
// Type II ratios (NEH 630 ch. 4, fig. 4-36) and within 1 % of the MnDOT/HydroCAD Type II peak above.
function typeII(t) {
  const ip = 39.261, io = 0.311, eta = 0.0522, m1 = 0.264, m2 = 4.098, r = 0.493, td = 24, e2 = 1 - eta;
  const f = (x) => x <= r * td
    ? r * (ip - io) * (eta * (Math.exp((-m1 * (r * td - x)) / r) - Math.exp(-m1 * td)) / (m1 * td) + e2 * (Math.exp((-m2 * (r * td - x)) / r) - Math.exp(-m2 * td)) / (m2 * td)) + io * (x / td)
    : (1 - r) * (ip - io) * (eta * (1 - Math.exp((-m1 * (x - r * td)) / (1 - r))) / (m1 * td) + e2 * (1 - Math.exp((-m2 * (x - r * td)) / (1 - r))) / (m2 * td)) + io * (x / td - r) + r;
  return Math.min(1, Math.max(0, f(Math.max(0, t)) / f(24)));
}
function mse3(t) { if (t <= 0) return 0; if (t >= 24) return 1; const i = Math.floor(t * 10 + 1e-9); return MSE3[i] + (MSE3[i + 1] - MSE3[i]) * (t * 10 - i); }
export const DISTRIBUTIONS = { mse3, typeII };

// NRCS dimensionless unit hydrographs (NEH 630 ch. 16): PRF 484 = Table 16-1 (t/Tp, q/qp); PRF 400 = Table 16B-5 at 0.1 t/Tp.
const UH484 = [[0, 0], [0.1, 0.03], [0.2, 0.1], [0.3, 0.19], [0.4, 0.31], [0.5, 0.47], [0.6, 0.66], [0.7, 0.82], [0.8, 0.93], [0.9, 0.99], [1, 1], [1.1, 0.99], [1.2, 0.93], [1.3, 0.86], [1.4, 0.78], [1.5, 0.68], [1.6, 0.56], [1.7, 0.46], [1.8, 0.39], [1.9, 0.33], [2, 0.28], [2.2, 0.207], [2.4, 0.147], [2.6, 0.107], [2.8, 0.077], [3, 0.055], [3.2, 0.04], [3.4, 0.029], [3.6, 0.021], [3.8, 0.015], [4, 0.011], [4.5, 0.005], [5, 0]];
const UH400 = [0, 0.027, 0.1244, 0.2732, 0.4429, 0.6081, 0.7517, 0.8642, 0.9421, 0.9863, 1, 0.988, 0.9555, 0.9076, 0.8491, 0.7839, 0.7155, 0.6465, 0.579, 0.5144, 0.4538, 0.3977, 0.3465, 0.3004, 0.2591, 0.2224, 0.1902, 0.162, 0.1376, 0.1164, 0.0982, 0.0826, 0.0693, 0.0579, 0.0484, 0.0403, 0.0335, 0.0278, 0.023, 0.019, 0.0157, 0.0129, 0.0106, 0.0087, 0.0072, 0.0059, 0.0048, 0.0039, 0.0032, 0.0026, 0.0021, 0.0017, 0.0014, 0.0011, 0.0009, 0.0007, 0.0006, 0.0005, 0.0004, 0.0003, 0.0003, 0.0002, 0.0002, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0].map((v, i) => [i / 10, v]);
const UH = { 484: UH484, 400: UH400 };
function interp(T, x) { if (x <= 0 || x >= T[T.length - 1][0]) return 0; for (let i = 1; i < T.length; i++) if (x <= T[i][0]) { const [x0, y0] = T[i - 1], [x1, y1] = T[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); } return 0; }

// Peak discharge (cfs) and its time (h from storm start) for one 24-hour storm depth P (in).
export function uhPeak({ P, cn, areaSqMi, tcHr, dist = "mse3", prf = 484 }) {
  if (!(P > 0 && cn > 0 && areaSqMi > 0 && tcHr > 0)) return null;
  const S = 1000 / cn - 10, Ia = 0.2 * S, D = DISTRIBUTIONS[dist], T = UH[prf];
  const Tp = (2 / 3) * tcHr, dt = Math.min(0.05, Math.max(0.005, Tp / 10)), n = Math.round(24 / dt);
  const Qc = (p) => (p > Ia ? (p - Ia) ** 2 / (p - Ia + S) : 0);
  const qp = (prf * areaSqMi) / Tp, m = Math.ceil((T[T.length - 1][0] * Tp) / dt) + 1;
  const u = new Float64Array(m); let vol = 0;
  for (let j = 0; j < m; j++) { u[j] = qp * interp(T, (j * dt) / Tp); vol += u[j] * dt * 3600; }
  const k = (areaSqMi * 27878400) / 12 / vol; for (let j = 0; j < m; j++) u[j] *= k; // exact 1 inch of runoff volume
  const q = new Float64Array(n + m); let prev = 0;
  for (let i = 1; i <= n; i++) { const Q = Qc(P * D(i * dt)); const e = Q - prev; prev = Q; if (e > 0) for (let j = 0; j < m; j++) q[i + j] += e * u[j]; }
  let best = 0, at = 0; for (let i = 0; i < q.length; i++) if (q[i] > best) { best = q[i]; at = i * dt; }
  return { cfs: best, hour: at };
}
