# Northland Hydro

> **PROJECT.md** is the project guide: motivation, inspiration, every data source with what we learned about it, design decisions, validation status and roadmap. Start there if you are new or resuming work.

Rainfall, stream gauges, forecast and Lake Superior levels for northeastern Minnesota (the MN SWCD TSA3 counties), in one map. CoCoRaHS-grade station density, AquaScope-style "click anything" depth, and no server: every number comes from a public API straight into the browser.

Live layers:

| Layer | What it shows | Source | Access |
|---|---|---|---|
| Stations | Daily precipitation at ~440 CoCoRaHS, COOP and ASOS stations, summed over 1–90-day windows, with 1991–2020 normals where they exist | RCC-ACIS `MultiStnData` / `StnData` | CORS, POST JSON |
| Radar QPE | NWS multi-sensor precipitation estimate, 1 h – 24 h and since 12Z | `mapservices.weather.noaa.gov/raster/rest/services/obs/rfc_qpe` | image export, no CORS needed |
| Gauges | ~195 MN DNR/MPCA Cooperative Stream Gaging sites with the DNR's flow class (Q90…Q10), merged with USGS instantaneous values | DNR `csg.cgi` JSONP feed · USGS `waterservices` IV/DV/stat | JSONP + CORS |
| Point | PRISM daily precipitation (365 d), % of normal from the nearest station with normals, NWS 7-day forecast + QPF, Open-Meteo soil moisture, NOAA Atlas 14 design-storm table and "how rare was that" return periods | ACIS `GridData` · api.weather.gov · Open-Meteo · precomputed Atlas 14 grid | CORS / static |
| Region | Median/wettest station, gauges running high or low, active NWS alerts (Duluth office + TSA3 counties), Lake Superior at Duluth vs long-term average | api.weather.gov · NOAA CO-OPS 9099064 | CORS |

## Team projects (Supabase)

The **Projects** tab is a shared watch list for TSA3 projects. Each project is pinned on the map as a star, colored by status (red when its 1-day rain alert threshold is exceeded), and shows the current window's rain at its linked stations and the flow/class at its linked gauge. Members can add, edit, delete, pick locations by clicking the map, choose which stations and gauges to watch, set a rain alert threshold, and export the list as CSV.

Backend: Supabase project **Dashboard** (`lwbatdclpclwyuglzwgg`), tables `hydro_projects` and `hydro_members`, both behind row-level security. Access is an email allowlist: anyone can create a Supabase auth user, but only emails in `hydro_members` pass the policies, so stray sign-ups see nothing. Admins add members from the Projects → members view (or by inserting into `hydro_members`). Sign-in is an emailed code or link, or a password set from the Projects → password view. Supabase's built-in email sender is capped at a few messages per hour project-wide; configure custom SMTP (Authentication → SMTP) to lift it.

One-time setup in the Supabase dashboard:
- Authentication → Email Templates: add `{{ .Token }}` to the **Magic Link** and **Confirm signup** templates (e.g. "Your code: {{ .Token }}"). Work mailboxes with link scanners (Microsoft Defender Safe Links, Google) pre-open one-time links and consume them, so the site leads with the code.
- Authentication → URL Configuration: Site URL `https://madruin.github.io/northland-hydro/`; Redirect URLs `https://madruin.github.io/northland-hydro/**` and `http://localhost:8765/**`. Without this the emailed link points at localhost:3000.

The publishable key in `js/api/supabase.js` is meant to be public. Do not point the site at a Supabase project whose tables lack RLS.

## Watershed analysis (StreamStats + regional curves)

In the Point panel, **Delineate watershed** runs the current USGS StreamStats services from the browser (all CORS-enabled, no key):

0. Optional snap (checkbox, on by default, remembered): the click is moved to the nearest StreamStats stream-grid cell within 200 m, found by sampling the grid image around the point, which is what the StreamStats app does silently. The **Streams** layer toggle draws that same grid (Minnesota state service layer 74, zoom 13+) so you can see the cells before clicking.
1. `ss-delineate` returns the basin in pieces (a local "split catchment" from the point to the nearest divide, and the "adjoint catchment" upstream of it); the site unions them (polygon-clipping) so the drawn basin reaches the pour point (~3 s). A click that is not on a mapped stream cell yields a tiny sliver; the tool says so and asks for a click on the stream line. The drawn area is cross-checked against the computed drainage area.
2. `ss-hydro` computes the Minnesota basin characteristics (drainage area, slopes, lakes, soils, land cover, longest flow path; ~8 s).
3. The StreamStats `nss/regions` layer identifies the regression region at the pour point, and `nssservices` returns the regression flow statistics: peak flows (SIR 2023-5079, 66.7% to 0.2% AEP with 90% prediction intervals and standard errors), low flows, flow duration and seasonal statistics (SIR 2015-5170). Parameters outside an equation's applicable range are flagged. The region is taken at the pour point, not area-weighted across a basin that straddles regions.

**Saving to a project.** When signed in, a "Save to project" row under the results stores the whole analysis on the chosen project in `hydro_project_analyses`: pour point, HUC, basin polygon, all basin characteristics, the NSS flow statistics as returned, the regression regions, the chosen regional curve with its computed rows and the other curves' rows, and a `sources` block with the exact service URLs, the regional-curve workbook names and dates, and the retrieval time. The project detail lists saved analyses (date, author, DA, Q1%, curve); View redraws the basin and re-renders the tables from the stored data, so a design basis from months ago is reproducible without re-querying USGS.

Then **TSA3 regional curves** turn the drainage area into bankfull channel dimensions, reproducing the office spreadsheets exactly:

| Curve | Source workbook | What it does |
|---|---|---|
| North Shore | `North Shore Regional Curve_updated 2026_01.xlsx` | Power-law fits of bankfull area, width and mean depth vs DA for B, C and E channels separately; bankfull Q from gage-site surveys; V = Q/A |
| Cloquet / St. Louis | `Cloquet St Louis Regional Curve_2019_11.xlsx` | One area regression for all types; width and depth from assumed W/D (B 18, C 20, E 12); Q = A × 3.5 ft/s |
| Eastern MN | `EasternMN_Regional_Curve.xlsx` | Cubic polynomial for area below 5 mi², power law above; power laws for width and depth; quartic for Q; no stream-type split, fit to curve-read values |

`tools/build_regional_curves.py` reads the workbooks from `S:/TECH/20_North_Shore_Geomorph/02-Regional_Curves`, writes `data/regional_curves.json` (equations exactly as in each Prediction Equations sheet, every survey site, and a refit of each power law from the current rows), and prints published-vs-refit coefficients. Re-run it whenever a workbook changes. The site suggests a curve from the basin's HUC8 (Lake Superior direct tributaries → North Shore; St. Louis, Cloquet, Nemadji → Cloquet/St. Louis; Snake, Kettle, Rum, upper St. Croix → Eastern MN), shows the other curves' answers for comparison, warns when DA is outside the surveyed range, and plots the survey sites with the fitted curve on log-log axes with the basin marked. A drainage area can also be typed in to run the curves without delineating.

## FEMA flood hazard (NFHL)

**FEMA** draws the effective National Flood Hazard Layer from `hazards.fema.gov` (CORS) at zoom 12+: flood zones colored by hazard (regulatory floodway darkest, 1% annual chance red, 0.2% orange, minimal hazard nearly transparent), lettered cross sections with their regulatory water-surface elevations, BFE lines with labels, and LOMR areas. Hover for details. Clicking a point adds a **FEMA flood hazard at this point** section: zone and subtype, BFE (static or nearest BFE line), FIRM panel and effective date, any LOMR in effect, the studied reach, the six nearest cross sections with regulatory WSEL, streambed elevation, station and distance, and a short guidance note keyed to the situation (floodway → no-rise / CLOMR–LOMR; SFHA outside floodway → rise allowance; Zone A → BFE must be established; shaded X; unmapped). Links go to the FEMA Map Service Center at the point, the FIS/effective-model search, the MnDNR floodplain program and the MT-2 forms. Pending and preliminary maps are not shown.

**Flood elevations.** The NFHL publishes only the 1% (100-year) water surface: the BFE and the regulatory WSEL at each lettered cross section, both shown in the point section. The 0.2% (500-year), 2% and 10% elevations are not served as data anywhere in the NFHL; they exist only in the Flood Insurance Study's flood profiles and Floodway Data Table. The point section names the nearest cross-section letters so they can be read off the FIS profile for that stream (FIS link in the section).

## Panel and layout

On a desktop browser, drag the left edge of the right panel to make it wider or narrower (300 px up to 70% of the window; remembered). On phones, drag the bottom sheet's header up or down to any height, or tap it to step between peek, half and full. Stations, Gauges and Radar are quick toggles in the header; the other overlays are under **Layers ▾**, grouped Water / Land / Hazards & subsurface, each with its minimum zoom; turning one on while zoomed out shows a status note until you zoom in.

## Wells and borings (County Well Index)

**Wells** (zoom 12+) draws the Minnesota County Well Index (MGS and MDH; `water_well_information_non_pws` layer 1, located wells and borings) colored by depth to bedrock (red under 10 ft through blue over 100 ft; grey where MGS has not interpreted the log), plus DNR Drill Core Library boring locations as diamonds (purple mineral exploration, teal engineering, blue scientific). Hover for use, depth, bedrock depth and first bedrock unit, aquifer, drilled date. Clicking a point adds **Wells and borings near this point**: depth to bedrock at the nearest well, the median and range across wells within 600 m, static water level, and an expandable card for each of the five nearest wells with the driller's log decoded interval by interval (from/to depth, driller's description, MGS unit from the aquifer code table, lithology), casing, elevation and location method, and a link to the full MDH well record. DNR drill holes within 600 m are listed with purpose, company, year, depth and method. The Watershed section adds **Depth to bedrock · CWI wells in basin** (median, interquartile range, share under 10 ft and 25 ft, top first-bedrock units) from all located wells inside the delineated basin, with a note that wells are a road- and shoreline-biased sample. Code tables (aquifer names, lithology, use, location and elevation methods) are fetched once and cached for 30 days. Well positions range from GPS to section-level; the location method is shown on each card.

## Stream crossings (culverts and bridges)

**Crossings** (zoom 10+) draws two inventories. Circles are MN DNR Culvert Inventory Suite stream-crossing surveys (`struc_culvert_inventory_pub` layer 0), colored by DNR priority or by span-to-bankfull ratio (amber when the opening is narrower than half the bankfull width). Diamonds are FHWA National Bridge Inventory structures (NTAD feature service: MnDOT, county, township and city bridges and culverts over 20 ft), colored by overall condition (Good / Fair / Poor). Hover for road, stream, span vs bankfull, passage and priority (DNR) or facility, feature crossed, type, year built, length, condition and scour status (NBI). Clicking within about 80 m of a structure adds a **Stream crossing at this point** section: DNR total span vs bankfull width and confidence, priority and condition, fish passage and limiting factor, observed scour pool / deposition / bank erosion / alignment, the DNR recommended corrective action, a table of each culvert opening (shape, material, span × rise, length, inlet/outlet type, outlet drop, percent plugged, condition) joined by `crossing_id` from layer 1, the bridge assessment from layer 2, bed elevations and gradient, survey date and purpose; and the NBI record (structure number, kind and type, spans, year built and reconstructed, length, max span, deck width, deck/superstructure/substructure/culvert ratings, channel and scour-critical codes, waterway adequacy, owner and maintainer, load ratings and posting). Mille Lacs County publishes its own county-road culvert inventory (`County_Road_Culvert_Inventory_WFL1`, one layer per road) but it has no stream attributes and is not loaded; MnDOT has no public bridge or culvert service beyond what it submits to the NBI.

## Wetlands (MN NWI update)

**Wetlands** draws the Minnesota National Wetlands Inventory update (DNR, 2009–2014 imagery; `water_nat_wetlands_inv_2009_2014` layer 0) for the view at zoom 11+, colored by wetland type (emergent, forested, shrub, pond, lake, riverine). Hover for the Cowardin code, Circular 39 type, plant community and hydrogeomorphic class, and acreage. Clicking inside a wetland adds a **Wetland at this point** section to the Point panel with the same attributes and links to the MN Wetland Finder and the USFWS Wetlands Mapper centered on the point. The state update is preferred over the federal USFWS layer because it is newer, uses Minnesota-specific plant-community and Circular 39 classifications, and is served with CORS. Inventory-level mapping only; WCA jurisdictional boundaries need a field delineation.

## Trout streams and karst (MN DNR)

**Trout** draws DNR designated trout streams (`env_trout_stream_designations`; blue = designated, light blue = tributary reaches carrying the designation) for the view at zoom 9+. **Karst** draws karst-prone bedrock polygons (`geos_surface_karst_feature_devel` layer 1, carbonate + sandstone; in TSA3 this is the Hinckley Sandstone in Pine County), the MGS/DNR karst feature inventory points (sinkholes, stream sinks, karst springs; 623 of the region's 652 are in Pine County) and the DNR springs inventory. Hover any feature for details. Both load per viewport, capped at 2,000 features per source.

**Basin soils.** After a watershed delineation, a "Basin soils" section area-weights the dominant hydrologic soil group of every SSURGO map unit inside the basin in a single Soil Data Access query (outline thinned to ~600 vertices; Knife River's 86 mi² takes 3–8 s). It shows the group shares, the effective A/B/C/D split with dual groups counted as their D side (and the "if drained" alternative), and composite TR-55 curve numbers for a handful of whole-basin covers to show how the soils alone move the number.

## Lakes (MN DNR LakeFinder)

Click on a lake and the Point panel opens with a **Lake** section: basin name, DOW number, county, acreage and shoreline from the DNR hydrography layer (the polygon is outlined on the map); the DNR water-level record as a chart with the **Ordinary High Water Level** line, plus period of record, highest and lowest readings, last reading and its offset from OHW, datum, and benchmarks; **outlet / control structures** from the DNR dams inventory within about 0.5 km of the basin (principal spillway elevation, top of dam, height, datum, purpose, owner, hazard, condition, comments) or a note that none is on record; and LakeFinder morphology (littoral area, depths, clarity, last fisheries survey). Sources: DNR hydrography `water_dnr_hydrography` layer 1 (point lookup, 0.5 s), LakeFinder `water_levels_export.cgi` CSV and `detail.cgi`, the water-levels page parsed for OHW/datum (served with CORS), and `struc_mn_dams_inventory_pub`. Level datums vary by lake (MSL 1912, NGVD 29, local) and are shown; they are not NAVD88 lidar elevations.

## Parcels (county tax parcels)

The **Parcels** layer draws tax-parcel boundaries with owner labels from zoom 16, loading the current view (zoom 14+) live from each county's own ArcGIS service, since MnGeo's statewide open compilation takes 30–60 s per query. Field names differ by county and are normalized to PIN, owner, acres (GIS and deeded), site address, use/ownership, homestead, estimated market value, tax year, legal description. Hover a parcel for the summary; the Point panel's **Parcel at this point** section queries the county service at the clicked point.

| County | Service | Notes |
|---|---|---|
| St. Louis | `gis.stlouiscountymn.gov/server2/.../GeneralUse/Open_Data/MapServer/7` | ~0.7 s |
| Cook | ArcGIS Online `Tax_Parcel_Polygons` (state-standard fields) | ~0.9 s |
| Lake | MnGeo-hosted `us_mn_co_lake/plan_tax_parcels` | ~3 s |
| Carlton | `gis.co.carlton.mn.us/.../OpenData/Parcels_CarltonCountyMN` | no acreage field; computed from geometry |
| Aitkin | `gisweb.co.aitkin.mn.us/.../ParcelTaxData` | ~0.5 s |
| Mille Lacs | `gis.co.mille-lacs.mn.us/.../AGO_Parcels_and_Lots/MapServer/3` | no paging; 1,000-feature cap per view |
| Kanabec | Schneider/Beacon `KanabecCountyMN_WFS` | ~4 s |
| Pine | none | no public service; not in the state open compilation |

Wisconsin (Douglas, Bayfield) is not covered yet.

## Soils (NRCS SSURGO via Soil Data Access)

The **Soils** layer colors SSURGO map units by the dominant component's hydrologic soil group (A, B, C, D and the dual A/D, B/D, C/D classes) with map-unit outlines and symbols. It loads for the current view at zoom 12 and closer (views under about 7 km wide) by sending a spatial SQL query to NRCS Soil Data Access (`sdmdataaccess.sc.egov.usda.gov`, CORS-enabled, no key) that returns simplified polygons as WKT; hover for the unit name, group, dominant component and drainage class. The Point panel gets a **Soils at this point** section: map unit and survey area, then every component with percent, hydrologic group, drainage class, hydric rating, flooding frequency, shallowest wet-state water-table depth, surface texture, Kw, surface Ksat, and depth to a restrictive layer (the slower per-component lookups fill in a second stage), with links to Web Soil Survey and SoilWeb. St. Louis County is five survey areas (MN613–MN621); the query does not care which.

## Terrain (MnTOPO lidar)

The **Terrain** menu in the header adds MnGeo/MnTOPO lidar layers, all from `enterprise.gisdata.mn.gov` (CORS-enabled):

| Layer | Source | Notes |
|---|---|---|
| Hillshade 1 m (2008–12) | `1st_Generation_Hillshade` cached MapServer | Statewide first-generation lidar; fast default |
| Hillshade 0.5 m (2021–24) | `agsimg/.../MnTopo/2nd_Generation_Seamless_Lidar_DEM` ImageServer, `exportImage` with a Hillshade rendering rule per 512 px tile | Second-generation 3DEP lidar rendered on demand; enabled from zoom 12 to keep requests small |
| Elevation color ramp 1 m | `elevation_mn_1mDEM_cache` cached MapServer | |
| Contours 2 ft | `MnTopo/1st_Generation_2ft_Contours` VectorTileServer | Index/intermediate/depression styled here; labels from zoom 14 |
| Contours 10 ft (raster) | `1st_Generation_10ft_Contours` cached MapServer | Pre-rendered with labels, zoom 14+ |

The cached MapServers number their levels from their coarsest LOD (hillshade level 0 = zoom 6, DEM = zoom 7, 10 ft contours = zoom 14), so `js/terrain.js` registers an `mnlod://` MapLibre protocol that rewrites `{z}` to the service's level. Opacity slider applies to the raster layers; terrain state is in the URL (`t=`, `to=`).

For the future CAD export: the second-generation DEM is also available as 0.5 m cloud-optimized GeoTIFFs (BigTIFF, 512 px LZW tiles, 8 overviews, EPSG 6344 NAD83(2011) UTM 15N, elevations in meters NAVD88) in MnGeo's STAC catalog (`stac.gisdata.mn.gov`, collections `minnesota-100km-sections` and `lake-superior-work-units`); Azure serves byte ranges with CORS and geotiff.js reads a 256 px window in about 0.2 s. The ImageServer's `exportImage` also returns float32 GeoTIFF clips in UTM (`imageSR=26915`, 1000×1000 in 1.7 s).

## CAD export (area of interest)

**CAD export** in the header opens the Export tab: click two corners on the map and build a ZIP for AutoCAD in **NAD83 UTM zone 15N, US survey feet** (Civil 3D coordinate system UTM83-15F), elevations NAVD88 feet:

- **Aerial imagery** as JPG + JGW world file + PRJ, from MnGeo's WMS in EPSG:26915 (composite "best available" or FSA/NAIP by year, 0.3/0.5/1 m pixels, up to 8,191 px a side). The world file is written in feet.
- **Lidar DEM** as GeoTIFF (left as served: EPSG:26915 meters, float32) and as an ESRI ASCII grid in UTM feet with foot elevations, from the MnTOPO ImageServer (2nd generation 0.5 m or 1st generation 1 m; 0.5/1/2 m cells, up to 4,000 cells a side).
- **Contours** as DXF R12 3D polylines (Z = elevation, layers CONTOUR-INDEX every fifth interval and CONTOUR-INTER), generated in the browser from the DEM by marching squares with light simplification, at 0.5/1/2/5 ft intervals. The AOI boundary and a coordinate-system note are included. These are derived contours, not an official MnGeo product.
- A README in the ZIP restates the coordinate system, extents in meters and feet, sources, and step-by-step Civil 3D import instructions; the same steps are on the Export panel (collapsible "Bringing these into Civil 3D").

The rectangle drawn in lon/lat is snapped to a north-up, whole-meter rectangle in UTM so every product shares the same grid. Coordinates and elevations use 1 m = 3937/1200 US survey feet. Verified: the ImageServer returns exactly the requested UTM extent and cell count, so the world file, ASCII grid and contours line up with the GeoTIFF.

## Site hydrology report

**Print site report** (Point panel) or **Print report** (project detail) opens `report.html`: a letter-size, print-ready summary with a map snapshot, the current window's rainfall at the nearest stations and PRISM point totals with percent of normal and Atlas 14 return periods, nearest gauges with flow class, NWS forecast and QPF, active alerts, the Atlas 14 design-storm table, the watershed analysis (live, or the project's latest saved one) with basin characteristics and regression flows, the regional-curve bankfull dimensions with the other curves for comparison, and a numbered sources-and-methods list with retrieval times and a permalink that reproduces the view. "Download JSON" saves the same document as data. Use the browser's print dialog to save a PDF; enable background graphics.

## Deploying a change

Run `python tools/stamp_version.py` before committing. It writes a build id into `js/config.js` and lists every asset in `version.json`. On load, the site fetches `version.json` uncached; if the build differs from the running one it refetches the assets past GitHub Pages' 10-minute cache and reloads once, so users never see a half-updated page.

## Run it

No build step. Any static host works.

```bash
python -m http.server 8765 --directory northland-hydro
```

Then open http://localhost:8765/. The URL hash carries the full view state (date, window, layers, basemap, selection), so a link reproduces exactly what you were looking at.

Panel views (Region, Station, Gauge, Point, Projects, project) are kept in a history: a **‹ Back** button and breadcrumbs appear under the tabs (Alt+← also goes back). Table headers and stat labels with a dotted underline carry hover definitions (PI, SEp, AEP, Q90, W/D, HSG, Ksat and so on); the glossary lives in `js/nav.js`.

Keyboard: ← / → step the end date one day (also the ‹ › Today buttons); `/` focuses search; `?` opens help; Esc closes dialogs. Search covers gauges, stations, projects and place names (Photon geocoder). The last station and gauge results are cached in the browser, so a revisit draws the map immediately while fresh data loads. The help dialog opens automatically on a first visit.

## Deploy

- **GitHub Pages**: push the folder as a repo, enable Pages on the `main` branch root. `.nojekyll` is included so the `js/` directory is served as-is.
- **Railway** (if a backend ever becomes necessary): a static-site service pointed at this folder works, but there is nothing here that needs a server yet, so GitHub Pages is the default.
- Anything else that serves static files (an SWCD web host, S3) also works.

The only file that is not live is `data/atlas14_grid.json`. NOAA's Atlas 14 server has no CORS header, so `tools/build_atlas14_grid.py` samples it on a 0.2° grid over the region once (≈15 min, polite 0.4 s spacing). Atlas 14 Volume 8 is static, so this never needs to re-run unless the region or spacing changes. Nodes over Lake Superior and Ontario are intentionally absent.

## Layout

```
index.html            page shell, controls, panel tabs
css/app.css           dark UI; under 900 px: two-row header with a horizontally scrolling control strip, map fills the screen, panel is a bottom sheet (peek / half / full via the handle; any selection opens it to half), legend top-right, menus fixed full-width
js/app.js             state, controls, boot, URL sync, 10-minute live refresh
js/config.js          region bbox, counties, endpoints, color scales, flow classes
js/map.js             MapLibre map, basemaps (OpenFreeMap positron/liberty/dark, USGS imagery), county outlines, QPE raster, station/gauge layers
js/precip.js          station layer + legend + regional summary
js/gauges.js          USGS ⟷ DNR merge, flow-class coloring, legend
js/panels.js          Region / Station / Gauge / Point panels (Plotly charts)
js/lake.js            Lake Superior chip + charts
js/alerts.js          NWS alert filter for the region
js/url.js             hash state
js/projects.js        team watch list (auth, CRUD, map stars, pick-on-map)
js/watershed.js       StreamStats delineation → basin characteristics → NSS flows → regional curves
js/regional.js        TSA3 regional-curve calculations and chart
js/report.js          gathers the site hydrology summary document → report.html (js/report-view.js, css/report.css)
js/terrain.js         MnTOPO lidar layers, mnlod:// tile protocol, legend
js/soils.js, js/api/sda.js   SSURGO hydrologic-group layer and point soils section (Soil Data Access SQL)
js/parcels.js         county parcel services (7 counties), normalized fields, point lookup
js/dnrlayers.js       trout streams, karst/springs and wetlands viewport layers
js/fema.js            FEMA NFHL zones/floodway/BFE/XS/LOMR layer and point section
js/crossings.js       DNR culvert inventory + National Bridge Inventory layer and point section
js/wells.js           County Well Index wells/borings layer, driller-log point section, basin depth-to-bedrock
js/basinsoils.js      basin-wide HSG breakdown and composite CN
js/nav.js             panel history (back/breadcrumbs) and header-tooltip glossary
js/lakes.js, js/api/dnrlakes.js   DNR LakeFinder levels, OHW, hydrograph, dams inventory outlets
js/export.js          AOI export: imagery + world file, DEM GeoTIFF/ASCII, DXF contours (UTM 15N US ft)
tools/build_regional_curves.py, data/regional_curves.json
js/api/*.js           one thin client per upstream API (incl. supabase.js)
tools/build_atlas14_grid.py
data/atlas14_grid.json
```

## Data notes an engineer will care about

- **Observation day.** CoCoRaHS/COOP values are the 24 h ending at the morning observation (~7 AM) on the date shown. "Sep 5" precipitation mostly fell on Sep 4. ASOS stations (DLH, HIB, INL…) are calendar-day totals.
- **Flags.** `T` trace, `A` multi-day accumulation reported on that date (the preceding `S` days are inside it), `M` missing. Window sums come from ACIS's own reducer, which handles these consistently; "partial" marks windows with missing days.
- **Percent of normal** is only shown for 7-day and longer windows (1-day normals are ~0.1" and the ratio is noise). It uses the station's own 1991–2020 normals if it has them (COOP/ASOS and a subset of CoCoRaHS), otherwise the nearest station that does.
- **Return periods** interpolate log-linearly between Atlas 14 PDS depths at the nearest 0.2° node. Daily gauge totals are fixed-clock 24 h, which run about 13% under true peak 24 h depths (the Atlas 14 conversion factor is 1.13). Use the official PFDS point query for anything that goes in a report.
- **Flow classes** are the DNR's: today's flow versus the site's period-of-record percentiles for this date. USGS-only sites without a DNR record show as unclassified. USGS values are provisional.
- **PRISM** lags one to two days; the point panel says which date its windows end on.
- **Lake Superior** at Duluth includes seiche and wind set-up; the monthly-mean chart is the real regime. Long-term average 601.4 ft IGLD85 (USACE, 1918–2023).

## Phase 2 (needs a small scheduled harvester)

These sources have no CORS header, so a GitHub Actions cron job (Python, every 1–3 h) writing static JSON into `data/` would add them at zero cost:

- **CoCoRaHS direct export** (`data.cocorahs.org/export/exportreports.aspx`): same-morning reports before they reach ACIS, snow/SWE/depth, hail and significant-weather reports, multi-day reports.
- **NWS NWPS** (`api.water.noaa.gov/nwps/v1`): official river forecasts, flood categories and crest history for the forecast points in the region (St. Louis at Scanlon, Nemadji, Kettle, Snake, Rainy…). The endpoint timed out during testing; retry with backoff.
- **NDBC buoys** 45027 (McQuade Harbor) and 45028 (western Lake Superior): wave height/period for shoreline work, pairs with the wave-runup calculator.
- **MN State Climatology MNGage/HIDEN** daily dumps for the observers that never reach GHCN.
- **DNR CSG tabular series.** The CGI serves only PNG hydrographs; the site-report page's Data tab is HTML that a harvester could scrape for the ~150 DNR-only sites.

Other ideas: area-weighted regression regions and gage-adjusted estimates as in the StreamStats app, saving delineations to projects, NLDI upstream flowlines, email/SMS rain alerts per project (Supabase cron + edge function), MRMS 1 km QPE as an alternative to the RFC mosaic, and a printable storm report for a project site (station totals, QPE, return period, gauge response) for construction-oversight files.

## Credits

Built on public data from NOAA RCC-ACIS, USGS, MN DNR / MPCA, NWS, Open-Meteo and NOAA CO-OPS. Basemaps by OpenFreeMap / OpenMapTiles / OpenStreetMap contributors and USGS The National Map. Inspired by the CoCoRaHS map and by Rekin226's AquaScope Explorer (MIT), whose "harvest to static files, compute in the browser, no server" approach this follows.
