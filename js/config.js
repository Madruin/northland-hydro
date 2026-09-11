// Region, endpoints and styling constants for Northland Eco.
// Everything here is public, key-free, and (except where noted) CORS-enabled.

export const APP = {
  name: "Northland Eco",
  userAgent: "northland-hydro (valeromatias@gmail.com)", // NWS asks for a contact UA
  version: "0.1.0",
  build: "20260911-2024-d63b120",
};

// Working extent: MN SWCD TSA3 counties plus a margin (W, S, E, N)
export const REGION_BBOX = [-94.4, 45.4, -89.2, 48.8];
export const HOME = { center: [-92.0, 47.0], zoom: 7.2 };

// TSA3 member counties (FIPS) + useful neighbors. `tsa3: true` are highlighted.
export const COUNTIES = [
  { fips: "27031", name: "Cook", tsa3: true, center: [-90.5, 47.9], zoom: 8.2 },
  { fips: "27075", name: "Lake", tsa3: true, center: [-91.4, 47.6], zoom: 8.2 },
  { fips: "27137", name: "St. Louis", tsa3: true, center: [-92.5, 47.6], zoom: 7.4 },
  { fips: "27017", name: "Carlton", tsa3: true, center: [-92.7, 46.6], zoom: 9 },
  { fips: "27001", name: "Aitkin", tsa3: true, center: [-93.4, 46.6], zoom: 8.4 },
  { fips: "27095", name: "Mille Lacs", tsa3: true, center: [-93.6, 45.95], zoom: 9 },
  { fips: "27065", name: "Kanabec", tsa3: true, center: [-93.3, 45.95], zoom: 9.2 },
  { fips: "27115", name: "Pine", tsa3: true, center: [-92.75, 46.1], zoom: 8.6 },
  { fips: "27061", name: "Itasca", tsa3: false },
  { fips: "27071", name: "Koochiching", tsa3: false },
  { fips: "27035", name: "Crow Wing", tsa3: false },
  { fips: "27059", name: "Isanti", tsa3: false },
  { fips: "27025", name: "Chisago", tsa3: false },
  { fips: "55031", name: "Douglas (WI)", tsa3: false },
  { fips: "55007", name: "Bayfield (WI)", tsa3: false },
];

export const ENDPOINTS = {
  acis: "https://data.rcc-acis.org",                       // CORS *
  usgsIV: "https://waterservices.usgs.gov/nwis/iv/",        // CORS *
  usgsDV: "https://waterservices.usgs.gov/nwis/dv/",
  usgsStat: "https://waterservices.usgs.gov/nwis/stat/",
  usgsSite: "https://waterservices.usgs.gov/nwis/site/",
  dnrCsgFeed: "https://maps.dnr.state.mn.us/cgi-bin/csg/csg.cgi?mode=get_data&name=tel_sites_json", // JSONP + CORS
  dnrHydrograph: "https://maps.dnr.state.mn.us/cgi-bin/csg/hydrograph_cgi.py", // PNG only
  dnrSiteReport: "https://www.dnr.state.mn.us/waters/csg/site_report.html?mode=get_site_report&site=",
  nws: "https://api.weather.gov",                           // CORS *
  openMeteo: "https://api.open-meteo.com/v1/forecast",      // CORS *
  openMeteoArchive: "https://archive-api.open-meteo.com/v1/archive",
  coops: "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter", // CORS *
  rfcQpe: "https://mapservices.weather.noaa.gov/raster/rest/services/obs/rfc_qpe/MapServer",
  mrmsQpe: "https://mapservices.weather.noaa.gov/raster/rest/services/obs/mrms_qpe/ImageServer",
  counties: "https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json",
  atlas14Grid: "data/atlas14_grid.json",                    // precomputed, see tools/
  cocorahsStation: "https://dex.cocorahs.org/stations/",
  cocorahsExport: "https://data.cocorahs.org/export/exportreports.aspx", // no CORS (harvester only)
};

// NOAA CO-OPS Duluth (Lake Superior) water level station
export const LAKE_STATION = { id: "9099064", name: "Duluth, MN (Lake Superior)", datum: "IGLD",
  // Long-term average annual level, IGLD85 ft, 1918-2023 (USACE Detroit District)
  lta: 601.4, recordHigh: 603.38, recordLow: 599.51 };

// RFC QPE MapServer layer ids by accumulation window (from the service's layer list)
export const QPE_LAYERS = {
  "1h": 5, "2h": 9, "3h": 13, "6h": 17, "12h": 21, "24h": 25, "today": 29, "since12z": 1,
};

// CoCoRaHS-style precipitation color bins (inches). Order matters: first match wins.
export const PRECIP_BINS = [
  { max: 0.0,  color: "#ffffff", label: "0.00" },
  { max: 0.001, color: "#d9d9d9", label: "T" },
  { max: 0.10, color: "#c7e9c0", label: "0.01–0.10" },
  { max: 0.25, color: "#74c476", label: "0.10–0.25" },
  { max: 0.50, color: "#238b45", label: "0.25–0.50" },
  { max: 1.00, color: "#ffeb3b", label: "0.50–1.00" },
  { max: 1.50, color: "#ff9800", label: "1.00–1.50" },
  { max: 2.00, color: "#e53935", label: "1.50–2.00" },
  { max: 3.00, color: "#c2185b", label: "2.00–3.00" },
  { max: 5.00, color: "#7b1fa2", label: "3.00–5.00" },
  { max: Infinity, color: "#311b92", label: "5.00+" },
];
export const PRECIP_MISSING_COLOR = "#9e9e9e";

// MN DNR CSG flow class (class_262) → label/color. Matches the DNR key.
export const FLOW_CLASSES = [
  { id: 0, label: "Unclassified", color: "#9e9e9e" },
  { id: 1, label: "Critical low (< Q90)", color: "#b71c1c" },
  { id: 2, label: "Low (Q90–Q75)", color: "#f4511e" },
  { id: 3, label: "Low normal (Q75–Q50)", color: "#fdd835" },
  { id: 4, label: "High normal (Q50–Q25)", color: "#43a047" },
  { id: 5, label: "High (Q25–Q10)", color: "#1e88e5" },
  { id: 6, label: "Flooding (> Q10)", color: "#4a148c" },
];

export const WINDOWS = [
  { days: 1, label: "1 day" }, { days: 2, label: "2 days" }, { days: 3, label: "3 days" },
  { days: 7, label: "7 days" }, { days: 14, label: "14 days" }, { days: 30, label: "30 days" },
  { days: 60, label: "60 days" }, { days: 90, label: "90 days" },
];

// MnGeo Geospatial Image Service (wmsll endpoint serves EPSG:3857). WMS draws later layers on top and leaves their
// no-data areas transparent, so a county orthophoto listed after the statewide FSA base shows only where it exists.
const MNWMS = "https://imageserver.gisdata.mn.gov/cgi-bin/wmsll?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512&FORMAT=image/jpeg&LAYERS=";
const imagery = (layers, attribution) => ({ version: 8, glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: { mn: { type: "raster", tileSize: 512, minzoom: 6, maxzoom: 20, attribution, tiles: [MNWMS + layers] } }, layers: [{ id: "mn", type: "raster", source: "mn" }] });
export const BASEMAPS = {
  light: { label: "Light", style: "https://tiles.openfreemap.org/styles/positron" },
  streets: { label: "Streets", style: "https://tiles.openfreemap.org/styles/liberty" },
  dark: { label: "Dark", style: "https://tiles.openfreemap.org/styles/dark" },
  imagery: { label: "Imagery · newest (2025 FSA, 60 cm)", style: imagery("fsa2025", "USDA FSA 2025 via MnGeo") },
  imgsharp: { label: "Imagery · sharpest (county 6 in / 1 ft, 2009–24)", style: imagery("fsa2025,neclr2009,dul09,nc13ft,carlton21,lake24", "MnGeo: county, MnDOT and FSA imagery") },
  imglake24: { group: "Imagery by year", label: "2024 Lake County 6 in", style: imagery("fsa2025,lake24", "Lake County 2024 via MnGeo") },
  img2023: { group: "Imagery by year", label: "2023 FSA", style: imagery("fsa2023", "USDA FSA 2023 via MnGeo") },
  img2021: { group: "Imagery by year", label: "2021 FSA · Carlton 6 in", style: imagery("fsa2021,carlton21", "USDA FSA 2021, Carlton County 2021 via MnGeo") },
  img2019: { group: "Imagery by year", label: "2019 FSA · Lake & Carlton 6 in", style: imagery("fsa2019,carl19,lake19", "USDA FSA 2019, Lake and Carlton counties 2019 via MnGeo") },
  img2017: { group: "Imagery by year", label: "2017 FSA", style: imagery("fsa2017", "USDA FSA 2017 via MnGeo") },
  img2015: { group: "Imagery by year", label: "2015 FSA · Carlton 9 in", style: imagery("fsa2015,carl15_9", "USDA FSA 2015, Carlton County 2015 via MnGeo") },
  img2013: { group: "Imagery by year", label: "2013 FSA · north-central 1 ft", style: imagery("fsa2013,nc13ft", "USDA FSA 2013, MnDOT/MnGeo north-central 2013 via MnGeo") },
  img2010: { group: "Imagery by year", label: "2010 FSA", style: imagery("fsa2010", "USDA FSA 2010 via MnGeo") },
  img2009: { group: "Imagery by year", label: "2009 FSA · Arrowhead & Duluth", style: imagery("fsa2009,neclr2009,dul09", "USDA FSA 2009, Arrowhead and Duluth 2009 via MnGeo") },
  img2008: { group: "Imagery by year", label: "2008 FSA", style: imagery("fsa2008", "USDA FSA 2008 via MnGeo") },
  img2003: { group: "Imagery by year", label: "2003 FSA", style: imagery("fsa", "USDA FSA 2003 via MnGeo") },
  img1991: { group: "Imagery by year", label: "1991 USGS black & white", style: imagery("doq", "USGS 1991 DOQ via MnGeo") },
};

