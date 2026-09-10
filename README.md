# Northland Hydro

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

Keyboard: ← / → step the end date one day (also the ‹ › Today buttons); `/` focuses search; `?` opens help; Esc closes dialogs. Search covers gauges, stations, projects and place names (Photon geocoder). The last station and gauge results are cached in the browser, so a revisit draws the map immediately while fresh data loads. The help dialog opens automatically on a first visit.

## Deploy

- **GitHub Pages**: push the folder as a repo, enable Pages on the `main` branch root. `.nojekyll` is included so the `js/` directory is served as-is.
- **Railway** (if a backend ever becomes necessary): a static-site service pointed at this folder works, but there is nothing here that needs a server yet, so GitHub Pages is the default.
- Anything else that serves static files (an SWCD web host, S3) also works.

The only file that is not live is `data/atlas14_grid.json`. NOAA's Atlas 14 server has no CORS header, so `tools/build_atlas14_grid.py` samples it on a 0.2° grid over the region once (≈15 min, polite 0.4 s spacing). Atlas 14 Volume 8 is static, so this never needs to re-run unless the region or spacing changes. Nodes over Lake Superior and Ontario are intentionally absent.

## Layout

```
index.html            page shell, controls, panel tabs
css/app.css           dark UI, responsive (<900px stacks map over panel)
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
