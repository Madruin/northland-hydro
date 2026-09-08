// MN DNR / MPCA Cooperative Stream Gaging (CSG) telemetry feed.
// The feed is JSONP (csgSitesFeed({...})) and also sends Access-Control-Allow-Origin: *,
// so we load it as a script and parse the callback. ~965 sites statewide.
import { ENDPOINTS, FLOW_CLASSES } from "../config.js";
import { jsonp, inBbox } from "../util.js";

export async function loadCsgSites(bbox) {
  const data = await jsonp(ENDPOINTS.dnrCsgFeed, "csgSitesFeed");
  const sites = (data.sites || []).filter((s) => s.lat && s.lon && inBbox([s.lon, s.lat], bbox));
  return sites.map((s) => ({
    site_id: s.site_id, usgs_id: (s.usgs_id || "").trim() || null, name: s.long_name,
    tags: (s.short_name || "").split(";").map((t) => t.trim()).filter(Boolean),
    lat: s.lat, lon: s.lon, county_id: s.county_id, providers: [s.provider1, s.provider2].filter(Boolean),
    telemetry: !!s.has_telemtry, archive: !!s.has_archive, floodGage: !!s.is_flood_warning_gage,
    flowClass: Number(s.class_262) || 0,
    flow: s.value_262 != null && s.value_262 >= 0 ? Number(s.value_262) : null, flowTime: s.tstamp_262,
    stage: s.value_232 != null && s.value_232 >= 0 ? Number(s.value_232) : null, stageTime: s.tstamp_232,
    telRange: [s.tel_min_tstamp, s.tel_max_tstamp], arcRange: [s.arc_min_tstamp, s.arc_max_tstamp],
  }));
}

export const flowClassInfo = (id) => FLOW_CLASSES[id] || FLOW_CLASSES[0];

// PNG hydrograph (the only time-series output this CGI exposes). var 262 = discharge, 232 = stage.
export function hydrographPng(site_id, variable, start, end, w = 640, h = 260) {
  return `${ENDPOINTS.dnrHydrograph}?site=${site_id}&var1=${variable}&start=${start}&end=${end}&width=${w}&height=${h}&format=png`;
}
export const siteReportUrl = (site_id) => ENDPOINTS.dnrSiteReport + site_id;
