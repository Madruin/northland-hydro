# Northland Hydro — project guide

The long-form record of why this exists, what it is built on, every decision that shaped it, and where it should go next. README.md is the user- and developer-facing reference; this file is the memory. Update it whenever a decision is made or a source is added. Last updated 2026-09-11 (nav, tooltips, trout, karst, basin soils, wetlands, FEMA, crossings).

Live site: https://madruin.github.io/northland-hydro/ · Repo: https://github.com/Madruin/northland-hydro (public, MIT) · Owner: Matías Valero, Conservation Engineer, MN SWCD Technical Service Area 3 (TSA3).

---

## 1. Why it exists

TSA3's engineering office (Matías, co-engineer Caitlan Richard, technicians Bree Schabert, Paul Vartmann, Sam Korducki) designs and oversees 250–300 watershed and restoration projects across nine SWCDs in eight counties: Cook, Lake, St. Louis (North and South), Carlton, Aitkin, Mille Lacs, Kanabec, Pine. Every project begins with the same scavenger hunt across a dozen tools: CoCoRaHS for rain, USGS and DNR pages for gauges, StreamStats for the watershed, the regional-curve spreadsheets, Web Soil Survey, MnTOPO, Beacon or county GIS for parcels, LakeFinder for lake levels and OHW, and several downloads and conversions to get imagery and lidar into AutoCAD.

The goal, in Matías's words on 2026-09-08: a website that aggregates local rainfall, weather and gauge data and presents it in a useful format, with CoCoRaHS-level data specificity and AquaScope-level breadth; then progressively an "all-in-one portal" for watershed investigation, and finally an OnX-Hunt-style site-visit view where a technician standing at a site sees hydrology, soils, property lines and topography in one place.

### Inspiration

- **CoCoRaHS map** (maps.cocorahs.org): the density of volunteer daily precipitation observations and the simple colored-dot presentation. Our station layer reproduces its color bins and adds multi-day windows.
- **AquaScope Explorer** (Rekin226, MIT; https://rekin226-aquascope-explorer.static.hf.space, https://github.com/Rekin226/aquascope): the model for the architecture. Its author's Reddit post explained the philosophy: harvest public gauges into static files, compute in the browser (Pyodide there), no server, no account, no key, and honest "no" when data are insufficient. We adopted the no-server/no-key rule wholesale and the click-anything-for-depth interaction.
- **OnX Hunt**: the field-use standard for parcels over terrain on a phone, which drove the parcel layer and the mobile layout.

---

## 2. Architecture and design decisions

**Static site, no build step, no server.** Vanilla ES modules, MapLibre GL, Plotly (basic bundle), hosted on GitHub Pages. Every number is fetched live from a public agency API in the browser. The only exceptions are two precomputed files in `data/` (Atlas 14 grid, regional curves) and the Supabase-backed team project list. Reasons: zero hosting cost, nothing to keep running, and reproducibility (a URL hash captures the whole view).

**Hosting.** GitHub Pages (free) is the deployment. Matías uses Supabase and Railway subscriptions and does not use Vercel; Railway is reserved for the day a backend is genuinely needed, which has not come.

**CORS decides everything.** A source is usable live only if it sends `Access-Control-Allow-Origin` for the Pages origin. Section 3 records what each source does. Sources without CORS get precomputed (Atlas 14), harvested later (deferred), or skipped.

**URL hash is the state.** `#d=` end date, `w=` window days, `z=`/`c=` view, `b=` basemap, `l=` layers (s stations, g gauges, q QPE, r streams, o soils, p parcels), `q=` QPE window, `t=`/`to=` terrain layers and opacity, `sel=` selection (station:sid, gauge:id, point:lon,lat, project:id). The Link button copies it. Reports embed it as the permalink.

**Team data in Supabase, not in the repo.** Project **Dashboard** (`lwbatdclpclwyuglzwgg`), chosen over creating a new project because it already had RLS everywhere and a new one costs $10/mo. Tables: `hydro_members` (email allowlist; admins valeromatias@gmail.com and matiasvalero@tsa3.org), `hydro_projects`, `hydro_project_analyses`. Every table is behind row-level security keyed to `is_hydro_member()`; the publishable key in `js/api/supabase.js` is meant to be public. **Never** point the site at the everything-assistant project (`gksvlpzipmdlpzzcvdam`): its public tables have RLS disabled and hold 73k emails; Matías was told to enable RLS there.

**Auth.** Emailed code first (work mailboxes pre-open magic links and consume them), password as an alternative (set from Projects → password), magic link still works. Supabase's built-in mailer is rate-limited to a few per hour project-wide; custom SMTP is the fix when it bites. Redirect URLs for the Pages origin and localhost:8765 were added by Matías.

**Cache busting.** GitHub Pages caches assets for 10 minutes, which twice left users with stale scripts. `tools/stamp_version.py` writes a build id into `js/config.js` and `version.json`; on load the app fetches `version.json` uncached and, if the build differs, refetches every asset with `cache: "reload"` and reloads once. Run the stamper before every commit.

**Progressive loading.** A thin progress bar under the header tracks each startup task by name. The last station and gauge results are cached in localStorage so a revisit paints immediately while live data loads. Boot does not wait on USGS (it took 39 s once); the USGS request is capped at 20 s and DNR data fill in.

**Data honesty rules baked in.** Percent of normal is hidden for windows under 7 days. Return periods say which grid node they came from and note the 13% fixed-clock adjustment. StreamStats results flag parameters outside equation ranges. Off-stream watershed clicks get a sliver warning instead of a misleading polygon. Lake elevations always show their datum. The report has a numbered sources section with retrieval times.

**Pushing from the sandbox.** Git Credential Manager can't prompt from the tool shell; Matías did the first push from his terminal, after which the saved credential lets the assistant push. Long shell commands (over ~8 KB) get truncated and backslashes de-escaped: write patch scripts to a `.py` file and run them, and use the Write/Edit tools for JS containing backslashes.

---

## 3. Data sources (every one, with what we learned)

### Rainfall and weather
| Source | Endpoint | Used for | Access / notes |
|---|---|---|---|
| **RCC-ACIS** (NOAA Regional Climate Centers) | `https://data.rcc-acis.org` MultiStnData / StnData / GridData | Station layer (CoCoRaHS sid type 10, COOP 2, ASOS 1), window totals, 1991–2020 normals, PRISM grid 21 point totals and daily series | CORS `*`, POST JSON. ~440 stations in region, ~135 with normals. Gridded normals are NOT available via GridData. Trace/accumulation flags handled (`T`, `A`, `S`, `M`). This replaced the CoCoRaHS export as the backbone. |
| **CoCoRaHS direct export** | `data.cocorahs.org/export/exportreports.aspx` (CSV/JSON by state+county, Daily/MultiDay) | Not used live | Works but **no CORS**. Reserved for a harvester (same-morning reports, snow/SWE, hail). |
| **NWS API** | `https://api.weather.gov` points / forecast / forecastHourly / forecastGridData / stations / alerts | 7-day forecast, hourly QPF, latest obs, active alerts (Duluth office + TSA3 counties) | CORS. |
| **NWS RFC QPE** | `mapservices.weather.noaa.gov/raster/rest/services/obs/rfc_qpe/MapServer/export` | Radar-derived precipitation overlay 1 h–24 h and since 12Z (layer 25 = 24 h) | Image export with `{bbox-epsg-3857}`; no CORS needed. MRMS ImageServer (`obs/mrms_qpe`, rendering rule `rft_24hr`) also works. |
| **Open-Meteo** | `api.open-meteo.com/v1/forecast` | Hourly model precip and soil moisture (0–7, 7–28, 28–100 cm), past 7 + next 7 days | CORS, no key. Soil moisture is a wetness index, not a measurement. |
| **NOAA Atlas 14 Vol. 8** | `hdsc.nws.noaa.gov/pfds` CGI | Design-storm depths and "how rare was that" return periods | **No CORS** → `tools/build_atlas14_grid.py` sampled a 0.2° grid once (367 land nodes) into `data/atlas14_grid.json`. Static data; never needs re-running unless region or spacing changes. |

### Rivers and lakes
| Source | Endpoint | Used for | Access / notes |
|---|---|---|---|
| **USGS NWIS** | `waterservices.usgs.gov/nwis/iv`, `/dv`, `/stat`, `/site` | Instantaneous flow/stage, daily means, calendar-day percentiles for hydrograph bands | CORS. Provisional. 04015410 (Miller Creek nr mouth) is a 1992–93 historical site; Knife River 04015330 is the live North Shore reference. Occasional 503s and 30+ s responses. |
| **MN DNR/MPCA Cooperative Stream Gaging** | `maps.dnr.state.mn.us/cgi-bin/csg/csg.cgi?mode=get_data&name=tel_sites_json` | ~195 regional gauges with flow class (class_262: 0 unclassified…6 flooding), flow (value_262), stage (value_232), merged with USGS by usgs_id | JSONP (`csgSitesFeed`) + CORS. Hydrograph CGI returns PNG only (JSON returns empty). Site-report page has tabular data (harvest candidate). |
| **NOAA CO-OPS** | `api.tidesandcurrents.noaa.gov/api/prod/datagetter`, station 9099064 Duluth | Lake Superior level, 30-day hourly, monthly means vs long-term average 601.4 ft IGLD85 | CORS. `water_level` with `interval=h`; `hourly_height` not offered. |
| **MN DNR hydrography** | `enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/water_dnr_hydrography/FeatureServer/1` | Lake polygon at a clicked point (dowlknum, name, acres, in_lakefinder, has_hydrograph) | CORS, 0.5 s. Layer 0 is streams. |
| **MN DNR LakeFinder** | `maps.dnr.state.mn.us/cgi-bin/lakefinder/water_levels_export.cgi?format=csv&id=DOW`; `detail.cgi?type=lake_survey`; `hydrograph_cgi.py?basins=DOW:Name&show_ohwl=1` (PNG) | Water-level record, morphology, fisheries surveys | CORS `*`. Only `lake_survey` detail type works. |
| **LakeFinder water-levels page** | `www.dnr.state.mn.us/lakefind/showlevel.html?downum=DOW` | **OHW elevation, datum, period of record, extremes, benchmarks** exist only as text here | Served with CORS `*` (Cloudflare); parsed by regex in `js/api/dnrlakes.js`. Fragile if the DNR restructures the page. |
| **MN DNR dams inventory** | `.../us_mn_state_dnr/struc_mn_dams_inventory_pub/FeatureServer/0` | Outlet/control structures near a lake: principal spillway elevation, top of dam, datum, purpose, owner, hazard, condition, comments | CORS. No dataset exists for natural (uncontrolled) outlets; the panel says so. USACE NID (`services2.arcgis.com/FiaPA4ga0iQKduv3/.../NID_v1`) also works with `outFields=*`. |
| **MN Public Waters Inventory** | `.../us_mn_state_dnr/water_mn_public_waters/FeatureServer/1` | Available (pwi_class, shoreland class); not yet surfaced | CORS. |

### Watersheds and channel design
| Source | Endpoint | Used for | Access / notes |
|---|---|---|---|
| **USGS StreamStats ss-delineate** | `streamstats.usgs.gov/ss-delineate/v1/delineate/features/MN?lat&lon` | Watershed polygon: returns `split_catchment` + `adjoint_catchment` (+ sometimes `upstream_basin`); the site unions them with polygon-clipping | CORS, ~3 s. The old documented `streamstatsservices` endpoint is dead (404). An off-stream click yields a tiny sliver → warning. |
| **StreamStats ss-hydro** | `.../ss-hydro/v1/basin-characteristics/calculate-using-ssdelineate/?region=MN&lat&lon` (POST) | 19 Minnesota basin characteristics (DRNAREA, slopes, lakes, soils, land cover, CSL10_85…) | CORS, ~8 s. Returns -999 "Error in AreaOp" off-stream. |
| **StreamStats region layer** | `gis.streamstats.usgs.gov/arcgis/rest/services/nss/regions/MapServer/19/query` | Which regression region the pour point is in | Layer still carries old codes (gc1199/gc1200, "Region_B/C"); matched by letter to the 2023 codes GC1928–33. |
| **NSS services** | `streamstats.usgs.gov/nssservices/regions/MN/scenarios`, `/scenarios/estimate` (POST) | Peak flows (SIR 2023-5079) with 90% PI and SEp; low-flow, flow-duration, seasonal (SIR 2015-5170) | CORS, 0.3 s. Region taken at the pour point, not area-weighted; no gage adjustment (differs from the StreamStats app for large basins). |
| **StreamStats stream grid** | `gis.streamstats.usgs.gov/arcgis/rest/services/stateServices/mn/MapServer` layer 74 (export png32, pure blue 0,112,255, minScale 36112) | "Streams" map layer (zoom 13+) and client-side snap: nearest blue pixel within 200 m | CORS origin-reflective. Public pourpoint snap endpoints only snap to pixel centers, so we sample the image ourselves. |
| **TSA3 regional curves** | Workbooks on `S:/TECH/20_North_Shore_Geomorph/02-Regional_Curves` (North Shore updated 2026-01, Cloquet/St. Louis 2019-11, Eastern MN 2017) | Bankfull area/width/depth/Q by stream type from drainage area | `tools/build_regional_curves.py` → `data/regional_curves.json`. JS reproduces the Prediction Equations sheets to the last digit. North Shore refits from Jan-2026 rows differ <3% from published; Eastern MN least reliable (fit to curve-read values), North Shore C/E often better for Kanabec/Mille Lacs/Pine. Suggested curve by HUC8. |
| **USGS NLDI** | `api.water.usgs.gov/nldi` | Upstream flowlines (not yet used) | CORS; `splitCatchment` not allowed with comid source. |

### Terrain, imagery, soils, parcels
| Source | Endpoint | Used for | Access / notes |
|---|---|---|---|
| **MnTOPO 1st-gen lidar (2008–12)** | `enterprise.gisdata.mn.gov/aghost/rest/services/1st_Generation_Hillshade`, `elevation_mn_1mDEM_cache`, `1st_Generation_10ft_Contours` (cached MapServers), `MnTopo/1st_Generation_2ft_Contours` (VectorTileServer) | Hillshade 1 m, DEM color ramp, 10 ft raster contours, 2 ft vector contours | Cached services number levels from their coarsest LOD (hillshade z-6, DEM z-7, 10 ft z-14) → `mnlod://` MapLibre protocol in `js/terrain.js`. 2 ft source-layers `contours_02_start` (+`/label`), `_symbol` 0 index/1 intermediate/2 index depression/3 depression, label `_name`. MapLibre cannot data-drive `line-dasharray` (hit twice). |
| **MnTOPO 2nd-gen lidar (2021–24, 3DEP 0.5 m)** | `enterprise.gisdata.mn.gov/agsimg/rest/services/MnTopo/2nd_Generation_Seamless_Lidar_DEM/ImageServer` (`exportImage`, Hillshade rendering rule; tiff F32 clips, max 15000×4100); COGs via `stac.gisdata.mn.gov` (BigTIFF, 512-px LZW, 8 overviews, EPSG 6344 UTM 15N meters, NAVD88 m) | Hillshade 0.5 m layer (zoom 12+); DEM clips for CAD export | CORS. Azure blob serves byte ranges with CORS; geotiff.js reads a 256-px window in ~0.2 s. Also `1st_Generation_DEM_Data` ImageServer (1 m, EPSG 26915). |
| **MnGeo aerial imagery** | `imageserver.gisdata.mn.gov/cgi-bin/mncomp` (composite, best available), `.../cgi-bin/wms` layers fsa2015…fsa2025 | CAD export imagery (EPSG:26915, max 8191 px) | CORS `*`. |
| **NRCS SSURGO via Soil Data Access** | `sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest` (POST `{format:"JSON+COLUMNNAME", query}`) | Hydrologic-soil-group map layer (spatial SQL on mupolygon with `.Reduce().STAsText()`), point soils section (components, drainage, hydric, flooding, water table, texture, Kw, Ksat, restriction) | CORS `*`. 4 km view ~2.4 s; per-component detail subqueries ~15 s → two-stage load. St. Louis County = survey areas MN613/615/617/619/621. SDM WMS lists MVT but returns 400 (raster only). Web Soil Survey is USDA NRCS, not USGS. |
| **County tax parcels** | St. Louis `gis.stlouiscountymn.gov/server2/rest/services/GeneralUse/Open_Data/MapServer/7`; Cook `services.arcgis.com/L3KwVADPEG6iD24f/.../Tax_Parcel_Polygons/FeatureServer/0`; Carlton `gis.co.carlton.mn.us/.../OpenData/Parcels_CarltonCountyMN/MapServer/0`; Aitkin `gisweb.co.aitkin.mn.us/.../ParcelTaxData/FeatureServer/0`; Mille Lacs `gis.co.mille-lacs.mn.us/.../AGO_Parcels_and_Lots/MapServer/3` (no paging, 1000 cap); Lake `enterprise.gisdata.mn.gov/.../us_mn_co_lake/plan_tax_parcels/FeatureServer/0`; Kanabec `wfs.schneidercorp.com/.../KanabecCountyMN_WFS/MapServer/0` | Parcel boundaries, owner labels, point lookup; fields normalized per county in `js/parcels.js` | All CORS. Sub-second except Lake/Kanabec (3–4 s). **Pine**: no public service; not in MnGeo's open compilation (opted out, as did Kanabec). Email sent 2026-09-10 to Kelly Schroeder (Land Services Director) cc Lorri Houtsma (Assessor) asking for a REST endpoint or periodic export. |
| **MnGeo statewide open parcels** | `.../us_mn_state_mngeo/plan_parcels_open/FeatureServer/1` | Not used | Server-side 10–60 s per query (time-to-first-byte, not transfer); too slow for a pan-driven layer. Holds no Pine or Kanabec parcels. |
| **DNR trout streams** | `.../us_mn_state_dnr/env_trout_stream_designations/FeatureServer/0` (trout_flag 1 designated, 2 tributary reach; 2,444 segments in region); also `env_trout_stream_special_regs` (sanctuaries, posted boundaries) and `water_trout_streams_pls_sections` | Trout layer | CORS. Loaded per viewport, zoom 9+. |
| **Karst** | `geos_surface_karst_feature_devel` layer 1 (carbonate+sandstone polygons; layer 0 carbonate-only has nothing in NE MN), `geos_karst_feature_inventory_pts` (feature D sinkhole, X stream sink, B spring, I karst window), `env_mn_springs_inventory` | Karst layer | CORS. Regional content is essentially Pine County (Hinckley Sandstone). |
| **MN NWI update (wetlands)** | `.../us_mn_state_dnr/water_nat_wetlands_inv_2009_2014/FeatureServer/0` (fields attribute = Cowardin, wetland_type, acres, circ39_class, hgm_desc, spcc_desc, cow_class1) | Wetlands layer (zoom 11+) + point section | CORS; 5 km view ~2.7 s / 0.9 MB. Also `water_nat_wetlands_inventory` (legacy federal) and `geos_potentially_wet_histosols`. USFWS `fwspublicservices.wim.usgs.gov` returned HTML at the tried path; not needed. |
| **FEMA NFHL** | `hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer` layers 28 zones (FLD_ZONE, ZONE_SUBTY incl. FLOODWAY, SFHA_TF, STATIC_BFE, V_DATUM, DFIRM_ID), 14 cross sections (XS_LTR, WSEL_REG, STRMBED_EL, STREAM_STN, WTR_NM), 16 BFE lines (ELEV), 1 LOMRs (CASE_NO, EFF_DATE, STATUS), 3 FIRM panels (FIRM_PAN, EFF_DATE), 17 profile baselines, 34 LOMAs | FEMA layer (zoom 12+) + point section with no-rise/CLOMR guidance | CORS. **Only 1% elevations exist as data** (XS `WSEL_REG`, BFE `ELEV`); no NFHL layer carries 0.2%/2%/10% WSELs (checked every layer 2026-09-11) — those are only in the FIS flood profiles and Floodway Data Table, so the point section names the nearest XS letters to look up. 2 km zone query ~3.6 s / 6.7 MB (geometry heavy). MnGeo mirror `water_dnr_fema_dfirm` exists but lacks floodway subtype detail. |
| **MN DNR Culvert Inventory Suite** | `enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/struc_culvert_inventory_pub/FeatureServer` layer 0 Stream Crossing Summary (3,153 in region; crossing_id, crossing_type, stream_name/kittle, road, total_span, bankfull_width_ft, priority, crossing_condition, fish_barrier_at_some/all_flows, scour_pool, upstream_deposition, bank_erosion_caused_by_crossing, recommended_corrective_actions, inlet/outlet_bed_elevation, field_date, own_type), layer 1 Culvert Opening (5,692; pipe_id, opening_shape/material, size_span, size_rise, length, inlet/outlet_type, invert elevations, outlet_drop_ft, pct_plugged, culvert_condition), layer 2 Bridge Assessments (111) | Crossings layer (circles, zoom 10+) + point section; openings and bridge rows joined by `crossing_id` | CORS for the Pages origin. Survey coverage is where DNR fisheries/stream habitat crews have assessed, not every road crossing. |
| **FHWA National Bridge Inventory (NTAD)** | `services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_National_Bridge_Inventory/FeatureServer/0` (128 NBI coded fields; STRUCTURE_NUMBER_008, FACILITY_CARRIED_007, FEATURES_DESC_006A, YEAR_BUILT_027, STRUCTURE_KIND/TYPE_043A/B, STRUCTURE_LEN_MT_049, DECK/SUPER/SUB/CULVERT_COND_058–062, CHANNEL_COND_061, SCOUR_CRITICAL_113, OWNER_022, BRIDGE_CONDITION, LOWEST_RATING) | Crossings layer (diamonds) + point section | CORS `*`. MnDOT, county, township, city structures >20 ft; metric lengths converted. Only source for MnDOT structures: no MnDOT bridge/culvert service exists on MnGeo or AGOL. |
| **Mille Lacs county-road culverts** | `services.arcgis.com/.../County_Road_Culvert_Inventory_WFL1/FeatureServer` (layers 67–91, one per road; Road, Material, Barrels, LengthFt, DiameterIn, Waterway, Notes) | Not loaded | CORS `*`. Small, one county, no stream/condition attributes; candidate if other counties publish similar. |
| **US Census counties** | `cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json` | County outlines (TSA3 highlighted) and per-county bboxes | CDN. |
| **Basemaps** | OpenFreeMap positron/liberty/dark (glyphs from `tiles.openfreemap.org/fonts`), USGS National Map imagery tiles | | |
| **Photon** | `photon.komoot.io/api` | Place-name search | CORS, no key. |

### Deferred / rejected
- **NWS NWPS** river forecasts (`api.water.noaa.gov/nwps/v1`): timed out, no CORS. **NDBC** buoys 45027/45028: no CORS. **MN State Climatology MNGage**: no API. All are harvester candidates.
- **GitHub Actions harvester** (step 5) and **email rain alerts** (step 6): Matías dropped both on 2026-09-08 as unnecessary for now. The per-project `rain_alert_in` threshold column exists and drives an in-app red flag only.

---

## 4. What's built (feature inventory)

- **Map**: stations (colored by window total), gauges (triangles colored by DNR flow class, stale grey, hide-unclassified toggle), radar QPE, Streams grid, Soils (HSG), Parcels, Wetlands, FEMA, Crossings (DNR culvert surveys + NBI bridges), Trout, Karst, Terrain menu (5 layers + opacity), county outlines, project stars, basin/lake/AOI overlays, four basemaps, search (gauges, stations, projects, places), date steppers, Link, Help (auto on first visit), loading bar.
- **Panels**: Region overview (median/wettest, % of normal, alerts, gauges high/low, Lake Superior); Station (90-day record, context table with normals, Atlas 14 return periods, CSV); Gauge (30-day IV with percentile bands, stage, 365-day DV; DNR PNG hydrographs for DNR-only sites); Point (Lake section, Watershed, Stream crossing, FEMA flood hazard, Wetland, Parcel, Soils, PRISM totals, nearest observers/gauges, NWS forecast + QPF, Open-Meteo soil moisture, Atlas 14 table, Print site report); Projects (Supabase list, editor with pick-on-map, station/gauge links, rain alert, saved analyses, members, password, CSV); Export (CAD).
- **Watershed**: snap checkbox (200 m to StreamStats stream grid), delineate (union of pieces), basin characteristics, NSS flows with PI/SEp and range flags, regional-curve dimensions for B/C/E with other curves for comparison and log-log chart, sliver and area-mismatch warnings, save to project, view/delete saved analyses.
- **CAD export**: rectangle AOI → ZIP with imagery JPG+JGW+PRJ, DEM GeoTIFF (as served, UTM m) + ESRI ASCII grid (UTM 15N US survey ft, NAVD88 ft), DXF R12 3D polyline contours (0.5/1/2/5 ft, CONTOUR-INDEX/INTER layers, AOI boundary, note), README with Civil 3D steps. Coordinate system UTM83-15F (Matías's CAD standard). Verified: server returns exact requested extent; files loaded in Civil 3D at the right location.
- **Report**: letter-size `report.html` with map snapshot, rainfall tables, gauges, forecast, Atlas 14, watershed (live or saved), regional curves, sources with retrieval times, permalink; Download JSON.
- **Mobile** (≤900 px): two-row header with scrolling control strip, bottom-sheet panel (peek/half/full), full-width menus, top-right collapsed legend.

---

## 5. Validation status

- Regional curves: JS matches all three spreadsheets to the last digit at their example inputs.
- Watershed: Knife River gauge delineates to 86.0 mi² (USGS published 84.6), Region C, PK1AEP 11,700 cfs; drawn polygon now matches the StreamStats app after the union fix (Matías found the first version stopped 1–2 mi short).
- CAD export: JGW/ASC/DXF verified numerically and by Matías in Civil 3D.
- Lakes: Pike Lake (DOW 69049000) OHW 1396.90 NGVD 29, dam spillway 1396.6, 680 readings 1941–2026.
- **Open**: Matías still owes the Poplar and East Amity StreamStats comparisons and the spreadsheet cross-check; team handoff (Caitlan and technicians) not yet done.

---

## 6. Roadmap and ideas discussed

Near-term (agreed or implied):
1. ~~Back navigation / breadcrumbs~~ done 2026-09-11 (`js/nav.js`).
2. ~~Header tooltips / units~~ done 2026-09-11 (glossary in `js/nav.js`, applied by MutationObserver).
3. ~~Basin-wide HSG breakdown~~ done 2026-09-11 (`js/basinsoils.js`): SDA takes the whole basin in one query when the ring is thinned to ~600 vertices (3–8 s, result insensitive to thinning).
4. More SSURGO themes as layer options: drainage class, hydric, flooding frequency, water-table depth, Kw, slope class.
5. Pine County parcels once the county answers (REST endpoint → same as others; export → static tileset refreshed on delivery). Wisconsin statewide parcels for Douglas/Bayfield if needed.
6. Official 2 ft MnTOPO contours as a second DXF in the CAD export; save AOI extents/settings to projects.
7. Area-weighted regression regions and gage adjustment in the watershed tool (where the site still trails the StreamStats app).
8. Public Waters Inventory attributes and shoreland class in the Lake section; NLDI upstream flowlines for a clicked point.
9. UX rounds driven by team feedback; citations on every number.

Later / optional: harvester for CoCoRaHS direct, NWPS, NDBC, MNGage, DNR tabular (all no-CORS); email rain alerts; custom SMTP for auth; Wisconsin coverage.

Project pins: Matías keeps several of the 14 seeded placeholder projects as templates and will populate real projects himself. Don't nag about them.

---

### Subsurface / boring data (explored 2026-09-11, not yet built)
- **County Well Index (CWI)** — the state's boring database (MGS + MDH, ~600k wells and borings). `enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_health/water_well_information_non_pws/FeatureServer`: layer 1 `Allwells` points (relateid, unique_no, elevation + elev_mc, depth_drll, depth2bdrk, first_bdrk, aquifer, strat_mc, use_c, status_c, date_drll, swl flag, core/cuttings/bhgeophys flags), layer 0 unlocated wells; tables 12 `C5ST` stratigraphy (depth_top/bot, drllr_desc, color, hardness, strat code, lith_prim/sec), 13 `C5WL` water levels, 8 `C5C2` construction, 10 `C5PL` pump tests, 11 `C5RM` remarks, plus code tables (36 LTH CODE, 54 STR GEOL, 58 USE, 52 STATUS, 55 STR METH, 23 ELEV MC). CORS for the Pages origin. Knife River 10×10 km: 266 located wells in 0.2 s; one log 1 s; 50 logs in one `relateid IN (...)` query 1.5 s. Unique-number blocks: 1–9,999 MnDOT soil borings, 50,000–99,999 MnDOT exploration borings. Well detail page: `https://apps.health.state.mn.us/cwiinfo/index.xhtml?wellId=<relateid>`; MWI map `https://mnwellindex.web.health.state.mn.us/mwi/`.
- **MGS county geologic atlas databases (AGOL, CORS `*`)** — St. Louis `services.arcgis.com/8df8p0NlLFEShl0r/.../St__Louis_County__Database_map__Plate_1_WFL1/FeatureServer` (layer 1 exploratory borings 14,283; 6 core QDI incl. MnDOT soil borings, type SB; 7 core wells 2,087; 9 Quaternary points 4,117; 10 borehole geophysical logs; 11 textural analyses 3,969 with sand/silt/clay/gravel % by depth); Cook `Cook_County_Geology_WFL1` (driller logs, drill core, cuttings, textural analyses, depth-to-bedrock contours); Carlton atlas C-19 (check for service). Aitkin/Pine/Mille Lacs/Kanabec/Lake atlases: check MGS open data.
- **DNR Drill Core Library borings** — `us_mn_state_dnr/geos_boring_hole_locations/FeatureServer` layer 0 (6,714 in region; dhname, drillfor, drilldate, totdep, azimuth/dip, z_elevft, drillmthd, drlpurpose, coreloc) + `Dcl Lineage` table (bdrklitho, deptobdrk, cwinum, log/document flags). Mineral exploration and scientific holes, Iron Range heavy. CORS.
- **DNR Cooperative Groundwater Monitoring obwells** — `us_mn_state_dnr/env_wiski_groundwater_monitoring/FeatureServer/0` (166 in region; aquifer, well type, permit). CORS.
- **NRCS KSSL lab pedons** — via Soil Data Access tables `lab_site`/`lab_pedon`/`lab_layer` (same POST endpoint as soils layer); sparse in NE MN.
- **MnDOT foundation borings** — GI5 map at `dotapp7.dot.state.mn.us/geotechnical/FoundationBorings/gmap.html` no longer resolves; MnDOT publishes logs only as project PDFs (`dot.state.mn.us/materials/borings.html`, edocs). MnModel Phase 4 soil borings (river valleys, 1997–2014) are shapefile + PDF logs by request, no TSA3 coverage except Rainy/St. Croix headwaters.
- **WPA boring records** — no Minnesota-specific WPA boring/well-log dataset found online (Illinois/Iowa/Texas surveys have them). MN Historical Society holds WPA collections (finding aids 00695, 01473), not digitized logs. Historic records that exist are already inside CWI (e.g. remarks like "Explorations Eastern Ry of Minnesota, book at MGS").
- **Proposed build**: `Wells` layer (zoom 12+) from CWI Allwells colored by depth-to-bedrock or first bedrock unit; hover: depth, aquifer, drilled date; point section: nearest 5 wells with decoded stratigraphy logs (C5ST + LTH CODE), static water levels, construction, link to MWI record; optional DNR drill-hole and atlas-boring points as a second symbol. Watershed section could add median depth-to-bedrock across the basin.

## 7. Operating notes for future sessions

- Local preview: `python -m http.server 8765 --directory northland-hydro` or the `northland-hydro` launch config. Node is not installed; Python 3.14 is.
- Before committing: `python tools/stamp_version.py`. Commit messages end with the Claude co-author line.
- Regional curves changed? Re-run `tools/build_regional_curves.py` (reads the S: drive).
- Supabase changes go through the MCP `apply_migration`; RLS on everything; test with `set local role authenticated` + a fake JWT email claim.
- The Bash tool truncates long commands and de-escapes backslashes: write patches to a scratch `.py` and run it; use Write/Edit for JS with `\r\n` literals.
- Matías's preferences: direct, no filler, exhaustive tables, citations with links, dry humor fine. He confirms features by using them and reports discrepancies precisely; trust those reports over the assistant's own checks.
