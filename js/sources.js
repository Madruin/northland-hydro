// Every data source, method and library the site uses, rendered into the help dialog's "Sources & methods" tab.
import { escapeHtml } from "./util.js";

export const SOURCES = [
  { group: "Rainfall and weather", items: [
    { name: "RCC-ACIS (Regional Climate Centers Applied Climate Information System)", url: "https://www.rcc-acis.org/docs_webservices.html", use: "Station precipitation and snow (CoCoRaHS, NWS COOP, ASOS) for the map dots, station panels and nearest-observer tables; PRISM gridded daily precipitation (grid 21) for any point; 1991–2020 normals.", note: "Daily totals are observer-day totals (usually 7 am to 7 am), not calendar days. Trace counts as zero. Percent of normal is shown only for windows of 7 days or more." },
    { name: "CoCoRaHS", url: "https://www.cocorahs.org/", use: "Volunteer rain gauge network; observations arrive through ACIS. Station links open the CoCoRaHS station page." },
    { name: "NWS API (api.weather.gov)", url: "https://www.weather.gov/documentation/services-web-api", use: "7-day forecast periods, gridded quantitative precipitation forecast (QPF), active watches, warnings and advisories." },
    { name: "NWS River Forecast Center QPE", url: "https://mapservices.weather.noaa.gov/raster/rest/services/obs/rfc_qpe/MapServer", use: "Radar QPE layer: multi-sensor precipitation estimate for 1 h to 24 h and since 12Z, drawn as NWS map tiles." },
    { name: "Open-Meteo", url: "https://open-meteo.com/", use: "Modeled soil moisture by depth and hourly precipitation for a point (ECMWF/ICON blend)." },
    { name: "NOAA CO-OPS station 9099064, Duluth", url: "https://tidesandcurrents.noaa.gov/stationhome.html?id=9099064", use: "Lake Superior water level (IGLD85) and long-term average in the Region panel." },
    { name: "NOAA Atlas 14, Volume 8 (Perica et al., 2013)", url: "https://hdsc.nws.noaa.gov/pfds/", use: "Design-storm depths (5-minute to 60-day, 1- to 1000-year) from a 0.2° grid precomputed from the Precipitation Frequency Data Server; return periods of observed storms by log-interpolation between the grid depths.", note: "Atlas 14 depths are true-interval maxima; a fixed-clock daily gauge total runs about 13% low, so the return period of a daily total is a lower bound." },
  ] },
  { group: "Rivers, lakes and gauges", items: [
    { name: "USGS National Water Information System (NWIS)", url: "https://waterservices.usgs.gov/", use: "Instantaneous discharge and stage (30 days), daily means (365 days), daily statistics for the percentile bands and flow class." },
    { name: "MN DNR / MPCA Cooperative Stream Gaging (CSG)", url: "https://www.dnr.state.mn.us/waters/csg/index.html", use: "Telemetered state gauges with the DNR flow classification (low to high relative to the period of record for the date), merged with USGS; DNR hydrograph images for DNR-only sites." },
    { name: "MN DNR LakeFinder and water level records", url: "https://www.dnr.state.mn.us/lakefind/index.html", use: "Lake section: basin, DOW number, morphology, recorded water levels, ordinary high water elevation and datum, benchmarks." },
    { name: "MN DNR dams inventory", url: "https://gisdata.mn.gov/dataset/water-dams", use: "Outlet structures near a lake: spillway and top-of-dam elevations, hazard class, datum." },
    { name: "MN DNR hydrography (lake and basin polygons)", url: "https://gisdata.mn.gov/dataset/water-dnr-hydrography", use: "Lake outline for the clicked point and the Lake section." },
    { name: "MN DNR designated trout streams", url: "https://gisdata.mn.gov/dataset/env-trout-stream-designations", use: "Trout layer: designated streams and tributary reaches." },
  ] },
  { group: "Watersheds and channel design", items: [
    { name: "USGS StreamStats", url: "https://streamstats.usgs.gov/", use: "Delineation (ss-delineate), basin characteristics (ss-hydro), regression regions and the stream grid used for snapping.", note: "The delineation service returns a split catchment plus an adjoint catchment; the site unions them and warns on slivers or when the drawn area differs from the computed drainage area by more than 5%." },
    { name: "USGS National Streamflow Statistics (NSS) services", url: "https://streamstats.usgs.gov/ss/", use: "Peak-flow regression (Minnesota, SIR 2023-5079: 66.7% to 0.2% annual exceedance with 90% prediction intervals), low-flow, flow-duration and seasonal statistics (SIR 2015-5170).", note: "The regression region is taken at the pour point without area weighting or gage adjustment. Parameters outside an equation's range are flagged." },
    { name: "TSA3 regional curves", url: "https://github.com/Madruin/northland-hydro/tree/main/tools", use: "Bankfull area, width, depth and discharge versus drainage area for Rosgen B, C and E channels, reproduced from the TSA3 survey workbooks (equations and reliability notes carried through unchanged).", note: "Planning-level estimates; verify with a field bankfull survey before design." },
  ] },
  { group: "Terrain and imagery", items: [
    { name: "MnTOPO (MnGeo / MN DNR), 2008–2012 statewide lidar", url: "https://www.mngeo.state.mn.us/chouse/elevation/lidar.html", use: "1 m hillshade, colored DEM, 10 ft raster contours and 2 ft vector contours." },
    { name: "MnTOPO 2nd-generation lidar (USGS 3DEP, 2021–2024)", url: "https://www.mngeo.state.mn.us/chouse/elevation/lidar.html", use: "0.5 m hillshade rendered live; DEM clips and contours for the CAD export from the cloud-optimized GeoTIFFs (NAVD88)." },
    { name: "MnGeo aerial imagery (FSA and composite)", url: "https://www.mngeo.state.mn.us/chouse/wms/geo_image_server.html", use: "Georeferenced imagery in the CAD export." },
    { name: "MnGeo Geospatial Image Service (WMS)", url: "https://www.mngeo.state.mn.us/chouse/wms/geo_image_server.html", use: "Imagery basemaps served as Web Mercator tiles from the wmsll endpoint. \"Sharpest\" stacks the highest-resolution orthophotos over the 2025 FSA base: Lake County 2024 (6 in), Carlton County 2021 (6 in) and north-central Minnesota 2013 (1 ft, including Duluth and the Arrowhead). \"Newest\" is the 2025 USDA FSA statewide flight alone (about 60 cm).", note: "The sharpest photo of a place can be older than the newest; check the year before relying on what a building or channel looks like." },
    { name: "USGS The National Map imagery", url: "https://basemap.nationalmap.gov/", use: "Fallback imagery basemap (about 1 m NAIP)." },
    { name: "OpenFreeMap (OpenMapTiles, OpenStreetMap contributors)", url: "https://openfreemap.org/", use: "Light, Streets and Dark basemaps and map fonts." },
    { name: "US Census TIGER counties (us-atlas)", url: "https://github.com/topojson/us-atlas", use: "County outlines and the county zoom menu." },
  ] },
  { group: "Soils, land and wetlands", items: [
    { name: "USDA NRCS SSURGO via Soil Data Access", url: "https://sdmdataaccess.sc.egov.usda.gov/", use: "Hydrologic soil group layer, map-unit and component details at a point (drainage, hydric, flooding, water table, texture, K factor, Ksat, restriction), basin-wide HSG breakdown and composite TR-55 curve numbers.", note: "Dual groups (A/D etc.) count as their undrained letter unless drained. Web Soil Survey is the NRCS product these data come from." },
    { name: "County tax parcels", url: "https://gisdata.mn.gov/dataset?q=parcels", use: "Parcel boundaries and owner names from the St. Louis, Cook, Lake, Carlton, Aitkin, Mille Lacs and Kanabec county GIS services.", note: "Pine County publishes no service yet. Parcel data are for reference, not survey." },
    { name: "MN National Wetlands Inventory update (MN DNR, 2009–2014 imagery)", url: "https://www.dnr.state.mn.us/eco/wetlands/nwi_proj.html", use: "Wetlands layer and point section with Cowardin code, Circular 39 type, plant community and hydrogeomorphic class.", note: "Inventory mapping; regulatory boundaries need a field delineation." },
    { name: "USFWS Wetlands Mapper", url: "https://www.fws.gov/program/national-wetlands-inventory/wetlands-mapper", use: "Link from the Wetland section to the federal viewer at the point." },
    { name: "Minnesota Geological Survey / DNR karst features and springs", url: "https://gisdata.mn.gov/dataset?q=karst", use: "Karst layer: karst-prone bedrock, sinkholes, stream sinks, karst windows and springs." },
  ] },
  { group: "Flood hazard and infrastructure", items: [
    { name: "FEMA National Flood Hazard Layer (effective)", url: "https://hazards.fema.gov/femaportal/wps/portal/NFHLWMS", use: "Flood zones and floodways, base flood elevations, lettered cross sections with regulatory water-surface elevations, FIRM panels, LOMRs; guidance text for no-rise, CLOMR and LOMR situations.", note: "Only the 1% (100-year) water surface is published as data; 0.2% elevations are in the Flood Insurance Study profiles. Pending and preliminary maps are not shown." },
    { name: "FEMA Map Service Center and Flood Insurance Studies", url: "https://msc.fema.gov/portal/home", use: "Links from the FEMA section to the FIRM panel, FIS and effective models at the point." },
    { name: "MN DNR Culvert Inventory Suite", url: "https://gisdata.mn.gov/dataset/struc-culvert-inventory-pub", use: "Stream-crossing surveys: span vs bankfull, passage, condition, priority, corrective actions; culvert openings and bridge assessments joined by crossing id." },
    { name: "FHWA National Bridge Inventory (NTAD)", url: "https://geodata.bts.gov/datasets/national-bridge-inventory", use: "MnDOT, county, township and city bridges and culverts over 20 ft: type, year, dimensions, condition ratings, scour status, owner, load ratings." },
  ] },
  { group: "Subsurface", items: [
    { name: "Minnesota County Well Index (Minnesota Geological Survey and MDH)", url: "https://cse.umn.edu/mgs/cwi", use: "Wells layer colored by depth to bedrock; driller logs interpreted by MGS (stratigraphy, lithology), static water levels, construction; basin depth-to-bedrock statistics.", note: "Well locations range from GPS to section-level; the location method is shown on each card. Wells cluster along roads and shorelines, so basin statistics are a biased sample." },
    { name: "Minnesota Well Index (MDH)", url: "https://www.health.state.mn.us/communities/environment/water/mwi/index.html", use: "Full well record pages linked from each well card." },
    { name: "MN DNR Drill Core Library boring locations", url: "https://www.dnr.state.mn.us/lands_minerals/dc_library.html", use: "Mineral exploration, scientific and engineering drill holes with core or logs held in Hibbing." },
  ] },
  { group: "Search, storage and hosting", items: [
    { name: "Photon geocoder (komoot, OpenStreetMap data)", url: "https://photon.komoot.io/", use: "Place-name search." },
    { name: "Supabase", url: "https://supabase.com/", use: "Team project watch list and saved watershed analyses, protected by row-level security and an email allowlist. Nothing else is stored server-side; caches and preferences live in your browser." },
    { name: "GitHub Pages", url: "https://github.com/Madruin/northland-hydro", use: "Static hosting of the open-source site at northland.eco (MIT license)." },
  ] },
];

export const METHODS = [
  ["Windows and dates", "Station totals are the sum of daily observations over the window ending on the chosen date. Totals with missing days are marked partial. Gauge flow class compares today's flow with the site's period-of-record percentiles for the same calendar date."],
  ["Return periods", "The observed 1-, 2- and 3-day maxima in the window are placed on the nearest Atlas 14 grid node by log-linear interpolation between the published depths. Fixed-clock daily totals underestimate true 24-hour maxima by about 13%."],
  ["Watershed", "Optional snap to the nearest StreamStats stream cell within 200 m, then delineation, union of the returned catchment pieces, basin characteristics, and regression flows for the region at the pour point. Regional-curve dimensions use the TSA3 equations for the drainage area."],
  ["Basin soils and bedrock", "Area-weighted hydrologic-soil-group shares from a single Soil Data Access spatial query on the basin outline (thinned to about 600 vertices), composite curve numbers by cover condition; depth-to-bedrock median and quartiles from County Well Index wells inside the basin."],
  ["Coordinates and measurement", "UTM zone 15N (NAD83) in metres and US survey feet (1200/3937 m); NAD83 and WGS84 are treated as identical (about a metre apart here). Distances and areas are computed on the UTM plane."],
  ["CAD export", "Imagery with world file, DEM as GeoTIFF and ESRI ASCII grid in US feet, and DXF R12 contours generated from the DEM, all in UTM 15N US survey feet (UTM83-15F) for Civil 3D."],
  ["Provisional data", "All upstream values are provisional and subject to revision by the issuing agency. This site supports screening and planning; verify with agency records before design or permitting."],
];

export const SOFTWARE = [
  ["MapLibre GL JS", "https://maplibre.org/", "BSD-3"], ["Plotly.js", "https://plotly.com/javascript/", "MIT"], ["proj4js", "https://github.com/proj4js/proj4js", "MIT"],
  ["polygon-clipping", "https://github.com/mfogel/polygon-clipping", "MIT"], ["geotiff.js", "https://geotiffjs.github.io/", "MIT"], ["fflate", "https://github.com/101arrowz/fflate", "MIT"],
  ["topojson-client", "https://github.com/topojson/topojson-client", "ISC"], ["supabase-js", "https://github.com/supabase/supabase-js", "MIT"],
];

export function renderSources(el) {
  el.innerHTML = `<p>Everything on the map comes live from the public services below; the site keeps no copy of their data. Each Point panel section and the printed report name the source and retrieval time of what they show.</p>
    ${SOURCES.map((g) => `<h4>${escapeHtml(g.group)}</h4><ul class="src">${g.items.map((it) => `<li><b><a href="${escapeHtml(it.url)}" target="_blank" rel="noopener">${escapeHtml(it.name)}</a></b> — ${escapeHtml(it.use)}${it.note ? ` <span class="small">${escapeHtml(it.note)}</span>` : ""}</li>`).join("")}</ul>`).join("")}
    <h4>Methods</h4><ul class="src">${METHODS.map(([k, v]) => `<li><b>${escapeHtml(k)}.</b> ${escapeHtml(v)}</li>`).join("")}</ul>
    <h4>Software</h4><p class="small">${SOFTWARE.map(([n, u, l]) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(n)}</a> (${l})`).join(" · ")}. Site code: <a href="https://github.com/Madruin/northland-hydro" target="_blank" rel="noopener">github.com/Madruin/northland-hydro</a>, MIT license. Built by MN SWCD Technical Service Area 3.</p>`;
}
