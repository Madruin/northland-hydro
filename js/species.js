// Federally listed species at a point, from the USFWS IPaC location API (the same service behind ipac.ecosphere.fws.gov;
// CORS for northland.eco). It returns the listed species whose ranges IPaC applies to a footprint, whether designated
// critical habitat falls in it, and the responsible field office. This is screening: the official species list and the
// bat determination keys are run in IPaC itself for the project footprint.
import { escapeHtml } from "./util.js";

const IPAC = "https://ipac.ecosphere.fws.gov/location/api/resources";
// IPaC asks callers to identify themselves; FWS will soon also require a From header with a contact email (set here).
const CONTACT_EMAIL = "";
const HEADERS = { "Content-Type": "application/json", "X-Organization": "MN SWCD Technical Service Area 3", "X-Project": "Northland Eco (northland.eco)", ...(CONTACT_EMAIL ? { From: CONTACT_EMAIL } : {}) };
const RANK = { E: 0, T: 1, PE: 2, PT: 3, C: 4, SAT: 5, EXPN: 6 };
const cache = new Map();

export async function speciesAt(lon, lat, halfM = 75) {
  const key = `${lon.toFixed(4)},${lat.toFixed(4)}`; if (cache.has(key)) return cache.get(key);
  const dy = halfM / 110574, dx = halfM / (111320 * Math.cos((lat * Math.PI) / 180));
  const ring = [[lon - dx, lat - dy], [lon + dx, lat - dy], [lon + dx, lat + dy], [lon - dx, lat + dy], [lon - dx, lat - dy]].map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]);
  const body = { "location.footprint": JSON.stringify({ type: "Polygon", coordinates: [ring] }), timeout: 5, apiVersion: "1.0.0", includeOtherFwsResources: true, includeCrithabGeometry: false };
  const p = (async () => {
    const r = await fetch(IPAC, { method: "POST", headers: HEADERS, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) }).catch(() => { throw new Error("USFWS IPaC is not answering; try again later"); });
    if (!r.ok) throw new Error(`IPaC ${r.status}`);
    const d = await r.json(); const res = d.resources || {};
    const species = Object.values(res.populationsBySid || {}).map((e) => {
      const pop = e.population || {}; const ch = e.optionalFederalRegisterCrithabStatus;
      return { name: pop.optionalCommonName || pop.shortName, sci: pop.optionalScientificName, group: pop.groupName, code: pop.listingStatusCode, status: pop.listingStatusName,
        profile: pop.speciesProfileUrl, crithabHere: !!e.crithabInFootprint, crithab: ch ? { type: ch.displayType, date: ch.date?.slice(0, 10), url: ch.url } : null, conditional: !!e.conditional };
    }).sort((a, b) => (RANK[a.code] ?? 9) - (RANK[b.code] ?? 9) || a.name.localeCompare(b.name));
    const office = (res.fieldOffices || [])[0];
    return { species, office: office ? { name: office.officeName, phone: office.formattedPhone } : null, fetchedAt: new Date() };
  })();
  cache.set(key, p); p.catch(() => cache.delete(key));
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return p;
}

const isBat = (s) => /\bbat\b/i.test(s.name || "");
export async function renderSpeciesAt(container, lon, lat) {
  container.innerHTML = `<h3>Federally listed species · USFWS IPaC</h3><div class="spinner">Asking IPaC for listed species at this spot…</div>`;
  try {
    const r = await speciesAt(lon, lat);
    if (!container.isConnected) return;
    const bats = r.species.filter(isBat);
    const ch = r.species.filter((s) => s.crithabHere);
    const at = r.fetchedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    container.innerHTML = `<h3>Federally listed species · USFWS IPaC</h3>
      ${bats.length ? `<div class="notice"><b>${bats.map((s) => escapeHtml(s.name)).join(" and ")} range${bats.length > 1 ? "s" : ""} include${bats.length > 1 ? "" : "s"} this spot.</b> Tree clearing may need FWS review; run the northern long-eared bat / tricolored bat determination key in <a href="https://ipac.ecosphere.fws.gov/" target="_blank" rel="noopener">IPaC</a> for the project footprint, and ask the DNR about known roost trees and hibernacula nearby.</div>` : ""}
      ${ch.length ? `<div class="notice"><b>Designated critical habitat here:</b> ${ch.map((s) => `${escapeHtml(s.name)} (${escapeHtml(s.crithab?.type || "")}${s.crithab?.date ? ", " + escapeHtml(s.crithab.date) : ""}${s.crithab?.url ? `, <a href="${escapeHtml(s.crithab.url)}" target="_blank" rel="noopener">Federal Register</a>` : ""})`).join("; ")}.</div>` : ""}
      ${r.species.length ? `<table class="data"><thead><tr><th>Species</th><th>Status</th><th>Group</th><th>Critical habitat</th></tr></thead><tbody>
        ${r.species.map((s) => `<tr><td>${s.profile ? `<a href="${escapeHtml(s.profile)}" target="_blank" rel="noopener">${escapeHtml(s.name)}</a>` : escapeHtml(s.name)} <span class="small"><i>${escapeHtml(s.sci || "")}</i></span></td><td>${escapeHtml(s.status || "")}${s.conditional ? " (conditional)" : ""}</td><td class="small">${escapeHtml(s.group || "")}</td><td class="small">${s.crithabHere ? "<b>in footprint</b>" : s.crithab ? escapeHtml(s.crithab.type) + " elsewhere" : "none designated"}</td></tr>`).join("")}</tbody></table>`
        : `<div class="small">IPaC lists no federally listed, proposed or candidate species for this spot.</div>`}
      <div class="small">Screening from the IPaC location service for a 150 m square around the point. For NEPA and Section 7, request the official species list for the full project footprint in <a href="https://ipac.ecosphere.fws.gov/" target="_blank" rel="noopener">IPaC</a>${r.office ? `; the lead office is the ${escapeHtml(r.office.name)}${r.office.phone ? ", " + escapeHtml(r.office.phone) : ""}` : ""}. State-listed species and known locations (NHIS) require a DNR data request.</div>
      <div class="asof">live from USFWS IPaC, ${at}</div>`;
  } catch (e) { if (container.isConnected) container.innerHTML = `<h3>Federally listed species · USFWS IPaC</h3><div class="notice">IPaC request failed: ${escapeHtml(e.message)}</div>`; }
}
