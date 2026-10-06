# NASA Earthdata audit for Northland Eco

*Audited 2026-10-05. Scope: datasets useful to TSA3 conservation engineering in Cook, Lake, St. Louis, Carlton, Aitkin, Mille Lacs, Kanabec and Pine counties (bbox W −93.85, S 45.50, E −89.45, N 48.65), and how a client-side MapLibre site can use them.*

## 1. Method

- **CMR collection search** (`cmr.earthdata.nasa.gov/search/collections.json?bounding_box=-93.85,45.5,-89.45,48.65`), no login.
  - **11,419** collections intersect the bbox. Of these, 7,317 have granules, 6,019 are cloud-hosted and 2,120 are flagged `standard_product`.
  - Collection counts by science keyword: precipitation 1,007; snow/ice 532; land use/land cover 449; surface water 426; topography 316; soil moisture 303; land surface temperature 265; vegetation index 219; canopy 118; evapotranspiration 114; erosion/sedimentation 102; ground water 65; water quality 63; lake ice 48.
  - About 45 keyword searches followed, covering every topic in the brief (IMERG, SMAP, ECOSTRESS, OPERA, SWOT, Daymet, HLS, GEDI, PACE, GRACE, NLDAS, burned area, lake ice, turbidity and others).
- **Verification.** For each candidate:
  - UMM-JSON for the DOI and resolution.
  - A granule search over the bbox, sorted newest first. The date of the newest granule against its posting time gives the **observed** latency.
  - A test download of one granule.
- **GIBS check.** I pulled the EPSG:3857 WMTS capabilities (1,345 layers) and fetched test tiles over Duluth with `Origin: https://northland.eco`.

**Access findings that drive every recommendation:**

| Service | Login | CORS | Notes |
|---|---|---|---|
| GIBS WMTS (`gibs.earthdata.nasa.gov/wmts/epsg3857/best/...`) | none | `Access-Control-Allow-Origin: *` | PNG/JPEG raster tiles, and MVT vector tiles for fires. Each layer has a maximum zoom: the HLS/OPERA layers stop at `GoogleMapsCompatible_Level12`, about 25 m/px at 47°N. Requests beyond that return **400**, so set `maxzoom` on the source and let MapLibre overzoom. Empty tiles return 404 or a transparent PNG. |
| CMR granule search | none | `*` | The browser can list the dates and cloud cover of clear scenes for a point. Tested with HLS at Duluth: 14 scenes with ≤20% cloud between June and October 2026. |
| SWOT Hydrocron API (`soto.podaac.earthdatacloud.nasa.gov/hydrocron/v1/timeseries`) | none | `*` | Returns a time series by `feature_id` only, so it needs a lookup of lake and reach IDs. |
| Granule downloads (PO.DAAC, LP DAAC, ORNL, NSIDC) | **Earthdata Login** | — | Every test returned 302 to `urs.earthdata.nasa.gov`. These are usable only in a server job with an EDL token, AppEEARS or Harmony. |
| Daymet single-pixel API (`daymet.ornl.gov/single-pixel/api/data`) | none | **no ACAO header** | Needs a same-origin proxy (Caddy) or a server job. |

## 2. Ranked datasets

Recommendation codes: **Layer** = add as map layer; **Panel** = point panel or report; **Job** = server-side job on Railway; **Skip**.

| # | Dataset (short name · DOI) | Measures | Resolution · record · latency | NE MN use case | Browser access | Rec. |
|---|---|---|---|---|---|---|
| 1 | **OPERA DSWx-HLS** `OPERA_L3_DSWX-HLS_V1` · [10.5067/OPDSW-PL3V1](https://doi.org/10.5067/OPDSW-PL3V1) | Surface water class: open water, partial water, snow/ice, cloud | 30 m · each HLS pass (2–3 days, if clear) · 2016–19 sample, then Apr 2023→ · **~2 days** (10/02 scene posted 10/04) | Pre/post-storm water extent; beaver-pond and wetland inundation change; impoundment and outlet pool extent; inland lake shoreline position | GIBS `OPERA_L3_Dynamic_Surface_Water_Extent-HLS` (z≤12). COGs need EDL. | **Layer** |
| 2 | **OPERA DSWx-S1** `OPERA_L3_DSWX-S1_V1` · [10.5067/OPDSWS1-L3V1](https://doi.org/10.5067/OPDSWS1-L3V1) | Water extent from SAR, which sees through cloud | 30 m · Sentinel-1 revisit (~6–12 days) · Dec 2023→ · **~6 h** (10/04 23:50Z posted 10/05 06:10Z) | Flood extent *during* cloudy storm weeks, when optical sensors are blind | GIBS `OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1` (z≤12) | **Layer** (same control as #1) |
| 3 | **HLS v2** `HLSS30` / `HLSL30` · [10.5067/HLS/HLSS30.002](https://doi.org/10.5067/HLS/HLSS30.002), [HLSL30.002](https://doi.org/10.5067/HLS/HLSL30.002) | Harmonized Landsat 8/9 + Sentinel-2 surface reflectance | 30 m · combined 2–3 days · L30 2013→, S30 2015→ · **~1.5–2 days** | Dated imagery for post-storm washouts and gullies; red-clay plumes off the south shore and the St. Louis River; construction checks; new beaver dams; burn scars | GIBS `HLS_S30_Nadir_BRDF_Adjusted_Reflectance` and `HLS_L30_…` (true color, z≤12). Scene finder through CMR. | **Layer** (dated imagery in Compare) |
| 4 | **OPERA DIST-ALERT / DIST-ANN** `OPERA_L3_DIST-ALERT-HLS_V1`, `…DIST-ANN-HLS_V1` · [10.5067/SNWG/OPERA_L3_DIST-ALERT-HLS_V1.001](https://doi.org/10.5067/SNWG/OPERA_L3_DIST-ALERT-HLS_V1.001) | Loss of vegetation cover against a multi-year baseline | 30 m · alert on each HLS pass, annual summaries 2023, 2024, 2025 · ~2 days | Riparian canopy loss; logging near streams; windthrow; burn scars; trees killed by beaver flooding; vegetation loss at bluff tops | GIBS `OPERA_L3_DIST-ALERT-HLS_Color_Index`, `OPERA_L3_DIST-ANN-HLS_Color_Index` (z≤12) | **Layer** |
| 5 | **Daymet V4 R1 daily** `Daymet_Daily_V4R1_2129` · [10.3334/ORNLDAAC/2129](https://doi.org/10.3334/ORNLDAAC/2129) | tmax, tmin, prcp, **SWE**, srad, vp, day length | 1 km · daily · 1980 to last full year (2025 posted 2026-05-22) · annual release | Site snowpack history and melt-out timing for spring design flows; antecedent precipitation; freeze–thaw cycle counts for culvert and riprap design; normals at ungauged sites | Single-pixel API: no login, no CORS. NetCDF needs EDL. | **Panel** (via proxy) + **Job** |
| 6 | **SWOT Lake/River single-pass** `SWOT_L2_HR_LakeSP_D` · [10.5067/SWOT-LAKESP-D](https://doi.org/10.5067/SWOT-LAKESP-D); `SWOT_L2_HR_RiverSP_D` · [10.5067/SWOT-RIVERSP-D](https://doi.org/10.5067/SWOT-RIVERSP-D) | Water surface elevation (WSE) and area for lakes; WSE, slope and width for river reaches | Lakes ≳250×250 m; rivers ≳100 m wide · a few passes per 21-day cycle · 2023→ · **~4 days** (10/01 pass posted 10/05) | Level history for **ungauged** lakes behind shoreline and outlet projects; St. Louis River estuary and Mississippi (Aitkin) WSE | Hydrocron (CORS, no login) once lake and reach IDs are known | **Panel** (lake panel) |
| 7 | **VIIRS 375 m active fire** `VNP14IMGTDL_NRT` · [10.5067/FIRMS/VIIRS/VNP14IMGT_NRT.002](https://doi.org/10.5067/FIRMS/VIIRS/VNP14IMGT_NRT.002) | Fire detections | 375 m · several passes a day · 2012→ · near real time | Wildfire awareness in the BWCAW and Superior NF; flags post-fire erosion-risk sites | GIBS **MVT** `VIIRS_SNPP_Thermal_Anomalies_375m_All` (and `_NOAA20_`, `_NOAA21_`), z≤8 | **Layer** (quick win, seasonal) |
| 8 | **MODIS/VIIRS daily true color** (GIBS Corrected Reflectance) | Daily imagery | 250 m (MODIS) / 375 m (VIIRS) · daily · 2000→ · a few hours | Lake Superior storm plumes; ice cover on Superior and the large lakes; smoke | GIBS `MODIS_Terra_CorrectedReflectance_TrueColor`, `VIIRS_NOAA20_CorrectedReflectance_TrueColor` (JPEG, z≤9) | **Layer** (context, quick win) |
| 9 | **Snow cover, cloud-gap-filled** `VNP10A1F` · [10.5067/PN50Y51IVNLE](https://doi.org/10.5067/PN50Y51IVNLE); `MOD10A1F` · [10.5067/MODIS/MOD10A1F.061](https://doi.org/10.5067/MODIS/MOD10A1F.061) | NDSI snow cover | 375 m / 500 m · daily · 2012→ / 2000→ · 2–6 days | Regional snow-off date; check on whether melt has started | GIBS `VIIRS_NOAA20_NDSI_Snow_Cover`, `MODIS_Terra_L3_NDSI_Snow_Cover_Daily` (z≤8, not gap-filled). The CGF files need EDL. | **Layer** (context) + **Job** (median snow-off date raster) |
| 10 | **HLS Vegetation Indices** `HLSS30_VI` / `HLSL30_VI` · [10.5067/HLS/HLSS30_VI.002](https://doi.org/10.5067/HLS/HLSS30_VI.002) | NDVI, EVI, NDWI and others | 30 m · as HLS · 2013→ · ~1.5 days | Whether seeded banks and plantings at restored sites are establishing; a greenness time series per project | No GIBS layer; COGs need EDL | **Job** (NDVI series per project, as JSON) |
| 11 | **ECOSTRESS ET** `ECO_L3T_ET_ALEXI` (CONUS, 24-hour) · [10.5067/ECOSTRESS/ECO_L3T_ET_ALEXI.002](https://doi.org/10.5067/ECOSTRESS/ECO_L3T_ET_ALEXI.002); `ECO_L3T_JET` v003. Fallback: `MOD16A2GF` · [10.5067/MODIS/MOD16A2GF.061](https://doi.org/10.5067/MODIS/MOD16A2GF.061) | Actual ET | 70 m, irregular ISS overpasses, cloud-limited, 2018→, ~10–14 days. MOD16: 500 m, 8-day, gap-filled annually (latest Dec 2025). | ET term in pond and wetland water budgets for site hydrology reports | EDL COGs; AppEEARS | **Job** (monthly ET climatology by HUC12 for reports; low priority) |
| 12 | **Ocean color, Lake Superior.** `OLCIS3A/B_L2_EFR_OC` · [10.5067/S3A/OLCI/L2/EFR/OC/2022.0](https://doi.org/10.5067/S3A/OLCI/L2/EFR/OC/2022.0); `PACE_OCI_L2_BGC` · [10.5067/PACE/OCI/L2/OC_BGC/3.2](https://doi.org/10.5067/PACE/OCI/L2/OC_BGC/3.2); `MODISA_L2_OC` | Chlorophyll-a, Kd490, Rrs | OLCI 300 m; PACE and MODIS ~1 km · daily, cloud-limited · OLCI 2016→, PACE 2024→ | Extent of turbidity plumes after storms (Kd490 and Rrs, not chl) | GIBS `S3A_OLCI_Chlorophyll_a`, `OCI_PACE_Chlorophyll_a` (z≤7). L2 files need EDL. | **Skip for now.** The chl algorithms are unreliable in sediment- and CDOM-rich nearshore water; #3 and #8 show plumes better. |
| 13 | **SMAP enhanced soil moisture and freeze/thaw** `SPL3SMP_E` · [10.5067/M20OXIZHY3RJ](https://doi.org/10.5067/M20OXIZHY3RJ); `SPL3FTP_E`; L4 `SPL4SMGP` | Surface and root-zone soil moisture; frozen ground | 9 km · daily / 3-hourly · 2015→ · 1–2 days | Regional antecedent wetness and frozen ground. It is observation-based, which the Open-Meteo model is not, but far coarser. | GIBS `SMAP_L4_Analyzed_Root_Zone_Soil_Moisture`, `SMAP_L3_Passive_Enhanced_Day_Freeze_Thaw` (z≤6) | **Skip.** Optional regional percentile in the region panel later. |
| 14 | **GEDI L4B biomass / L3 canopy height** · [10.3334/ORNLDAAC/2299](https://doi.org/10.3334/ORNLDAAC/2299) | Biomass; canopy height | 1 km grid (footprints 25 m, sparse) · 2019–2023 | Regional forest structure only | GIBS `GEDI_ISS_L3_Canopy_Height_Mean_RH100_201904-202303` (z≤7) | **Skip.** MnTOPO lidar gives sub-meter canopy height. |
| 15 | **OPERA DISP-S1** `OPERA_L3_DISP-S1_V1` · [10.5067/SNWG/OPL3DISPS1-V1](https://doi.org/10.5067/SNWG/OPL3DISPS1-V1) | InSAR surface displacement | ~30 m · 12-day stacks · 2016 to mid-2025 so far | Possible slow creep of red-clay bluffs (Carlton/St. Louis) or Iron Range embankments. Forest and snow decorrelate the signal over most of the area. | EDL netCDF | **Skip** (case-by-case research only) |

## 3. Top 5 to build first

All five reuse one helper:

```js
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const gibs = (layer, date, tms = "GoogleMapsCompatible_Level12", ext = "png") =>
  `${GIBS}/${layer}/default/${date}/${tms}/{z}/{y}/{x}.${ext}`;
const cmrDates = (shortNames, lon, lat, start, end, cloud) =>
  `https://cmr.earthdata.nasa.gov/search/granules.json?${shortNames.map(s => `short_name=${s}`).join("&")}` +
  `&point=${lon},${lat}&temporal=${start},${end}${cloud ? `&cloud_cover=0,${cloud}` : ""}&sort_key=-start_date&page_size=100`;
```

GIBS tiles are 256 px. Set `maxzoom` to the layer's level (12, 9 or 8). Add the GIBS acknowledgement to the attribution.

**1. Surface water now and then (OPERA DSWx-HLS + DSWx-S1).**
- **Data:**
  - Source: `{type:"raster", tiles:[gibs("OPERA_L3_Dynamic_Surface_Water_Extent-HLS", date)], tileSize:256, maxzoom:12}`.
  - A second source does the same with `OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1`.
  - The date list comes from `cmrDates(["OPERA_L3_DSWX-HLS_V1","OPERA_L3_DSWX-S1_V1"], …)` at the map center.
- **User sees:**
  - A "Surface water (satellite)" overlay with a date dropdown: "Sep 22 · optical" and "Oct 4 · radar (sees through cloud)".
  - Two dates can be swiped in the existing Compare control for before/after views (a storm, a beaver dam, a drawdown).
  - Legend: open water, partial water, snow/ice, cloud.

**2. Dated 30 m imagery (HLS) in Compare.**
- **Data:**
  - `cmrDates(["HLSS30","HLSL30"], lon, lat, start, end, 30)` returns clear scenes, each with `cloud_cover`.
  - Tiles come from `gibs("HLS_S30_Nadir_BRDF_Adjusted_Reflectance", date)` or `…HLS_L30…`.
- **User sees:** Compare entries such as "HLS 2026-10-02 · Sentinel-2 · 0% cloud". After a storm they can pull up the first clear 30 m image within days. That shows plumes, washouts and fresh sediment fans, which the 0.5 m aerial basemaps (flown years apart) cannot show. 30 m is coarse for the site itself; it is meant for change, not design.

**3. Vegetation disturbance (OPERA DIST).**
- **Data:**
  - `gibs("OPERA_L3_DIST-ANN-HLS_Color_Index", "2025-01-01")`. The annual years 2023, 2024 and 2025 are available as `YYYY-01-01`.
  - `gibs("OPERA_L3_DIST-ALERT-HLS_Color_Index", latestDate)` gives the rolling alert.
- **User sees:** a "Canopy / vegetation loss" overlay that colors pixels where vegetation fell below the baseline, by severity and confirmation. With streams and parcels on top, riparian clearing, blowdown or new beaver flooding upstream of a culvert stands out.
- **Later job:** compute the percentage of disturbed area within 100 ft of streams per project from the COGs.

**4. Daymet climate and snowpack history in the point panel.**
- **Data:**
  - Add a Caddy `reverse_proxy` route, for example `/api/daymet/*` → `https://daymet.ornl.gov/single-pixel/api/*`. It is same-origin and needs no login.
  - Fetch `…/data?lat={lat}&lon={lon}&vars=prcp,swe,tmax,tmin&start=1980-01-01&end=2025-12-31`.
  - Cache the result per 1 km cell in IndexedDB.
- **User sees:** a "Climate (Daymet 1 km)" card with:
  - median and 90th-percentile annual peak SWE;
  - median melt-out date;
  - the largest 1- and 3-day precipitation, ranked against Atlas 14;
  - freeze–thaw cycles per year;
  - mean annual precipitation;
  - a sparkline of SWE for the selected winter.
- **Optional job:** a monthly Railway job reads the annual NetCDF with EDL and writes small 1 km climatology rasters (median April 1 SWE, melt-out day of year) to `data/tiles/`.

**5. SWOT lake levels in the lake panel.**
- **Data:**
  - A one-time server job (EDL) downloads the SWOT Prior Lake Database outlines (LakeSP *Prior* files) for passes over the bbox.
  - It spatially joins them to the DNR lake polygons the site already shows, and writes `data/swot_lakes.json` (`dow → lake_id`). SWORD does the same for river reaches.
  - The browser then calls `https://soto.podaac.earthdatacloud.nasa.gov/hydrocron/v1/timeseries?feature=PriorLake&feature_id={lake_id}&start_time=2023-07-01T00:00:00Z&end_time={now}&output=geojson&fields=lake_id,time_str,wse,area_total,quality_f`.
  - Drop the fill values (-999999999999) and bad `quality_f` passes.
- **User sees:**
  - A level chart with dots every 1–3 weeks for lakes with no DNR gauge.
  - Show it as change in feet relative to the record median. SWOT WSE is referenced to the EGM2008 geoid, not NAVD88/NGVD29, so do not compare it directly with OHW elevations.

**Quick wins (one source each, no jobs):**
- VIIRS fire detections as MVT: `gibs("VIIRS_SNPP_Thermal_Anomalies_375m_All", date, "GoogleMapsCompatible_Level8", "mvt")`. Expect 404s on empty tiles, so keep them out of the tile-error status messages.
- Daily MODIS/VIIRS true color (z≤9, JPEG) for Lake Superior plumes and ice.
- VIIRS NDSI snow cover (z≤8) as a context layer.

## 4. Considered and rejected

- **GPM IMERG** (`GPM_3IMERGDL` etc., 0.1° ≈ 11 km; Late run about 1 day), GPCP (0.5°), TRMM (ended 2019). MRMS, NWS QPE, CoCoRaHS and ACIS on the site are finer and faster.
- **NLDAS-2** (`NLDAS_NOAH0125_H`, 0.125° ≈ 14 km), **GLDAS** (0.25°/1°), FLDAS, MERRA-2. Model grids far coarser than a site. Open-Meteo already covers modeled soil moisture.
- **GRACE/GRACE-FO mascons** (`TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4`, 0.5° grid, true resolution about 300 km) and **GRACE-DA** (`GRACEDADM_CLSM0125US_7D`, 0.125°, weekly, about 3 months behind). Statewide drought context only.
- **GFMS** is not in CMR (University of Maryland, ~12 km). The **MODIS/VIIRS NRT Global Flood** layers (`MCDWD_L3_F2_NRT`, 250 m; GIBS `MODIS_Combined_Flood_2-Day`) are superseded at site scale by DSWx (30 m).
- **NASADEM / SRTM / ASTER GDEM** (30 m, 2000). MnTOPO lidar at 0.5–1 m is far better.
- **MCD12Q1** land cover (500 m) is worse than NLCD at 30 m. **MCD64A1 / VNP64A1** burned area (500 m, monthly) is worse than DIST or HLS at 30 m; MTBS (USGS/USFS) is the non-NASA alternative for burn severity.
- **Lake ice phenology** `NSIDC-0726` (AMSR, 5 km, ended 2022, large lakes only). Use #8 true color or #1's snow/ice class instead.
- **SMAP/Sentinel-1 3 km** `SPL2SMAP_S`: irregular, and the latest granule over the bbox is from April 2026. The **ICESat-2** `ATL13`/`ATL08` tracks are too sparse. **SWOT PIXC** is a large research-grade product.
- **OPERA RTC-S1** (raw SAR backscatter; DSWx-S1 is the useful derivative). **LHASA landslide nowcast** (1 km, global, v2 ended 2021). **ABoVE** collections (Alaska and Canada only).

## 5. Caveats

- **Site scale.** Most TSA3 sites are under 1 sq mi (about 2.6 km²).
  - **Anything coarser than about 1 km is context only:** Daymet (1 km), SMAP (9 km), IMERG, NLDAS, GLDAS, GRACE, GEDI L4B, PACE, MODIS ET (500 m), and snow cover (375–500 m).
  - Only HLS, DSWx, DIST and ECOSTRESS (30–70 m) resolve features inside a site, and 30 m still means a 20 ft channel is a sub-pixel line. Use them for change detection and extent, not for design dimensions.
- **Clouds and season.**
  - Optical products (HLS, DSWx-HLS, DIST, ECOSTRESS, ocean color) miss most storm days. DSWx-S1 is the storm-week fallback.
  - Snow, low sun angle and lake ice from November to April degrade the optical water and vegetation products.
  - Forest canopy hides small streams and ponds from every sensor.
- **Latency.** The latencies quoted are what was observed on 2026-10-05, not guaranteed:
  - DSWx-S1: hours.
  - HLS, DSWx-HLS, DIST: about 2 days.
  - SWOT: about 4 days.
  - ECOSTRESS: about 2 weeks.
  - Daymet: annual, with the previous year posted around May.
- **Mission aging.** Terra and Aqua MODIS are past their design life. Prefer the VIIRS (NOAA-20/21) versions of snow, fire and true color layers.
- **GIBS is visualization only.** Its PNG tiles carry rendered colors, not values. Any number shown in a panel (NDVI, ET, area of water change) has to come from a server job reading the EDL-protected COGs, or from AppEEARS (also EDL).
- **Datums.** SWOT heights are relative to the EGM2008 geoid. Present changes, not absolute elevations, next to DNR or OHW data.

**Key links:**
- CMR search API: <https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html>
- GIBS capabilities: <https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml>
- OPERA products: <https://www.jpl.nasa.gov/go/opera/products/>
- HLS: <https://lpdaac.usgs.gov/products/hlss30v002/>
- Daymet: <https://daymet.ornl.gov/>
- Hydrocron: <https://podaac.github.io/hydrocron/>
- AppEEARS: <https://appeears.earthdatacloud.nasa.gov/>
- Collection pages: `https://cmr.earthdata.nasa.gov/search/concepts/<concept-id>.html`, using concept IDs such as C2617126679-POCLOUD (DSWx-HLS), C2949811996-POCLOUD (DSWx-S1), C2746980408-LPCLOUD (DIST-ALERT), C2519119034-LPCLOUD (DIST-ANN), C2021957295-LPCLOUD (HLSS30), C2532426483-ORNL_CLOUD (Daymet), C3233944983-POCLOUD (SWOT LakeSP D)
