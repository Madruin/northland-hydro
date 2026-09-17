"""Recency check of every data source the site draws from. Writes data/freshness.json, which the Sources & methods tab
reads to show an "as of" date next to each source, and exits 1 when something is stale or a newer edition has appeared
(so the monthly GitHub Action fails loudly and emails the repo owner). Run by hand any time:

    python tools/check_freshness.py

Each check returns (asOf, detail); status is derived from the source's max age or an "expected edition" constant below.
Network errors give status "error" (reported, never fatal): a service being down for an hour is not staleness.
"""
import json, os, re, sys, datetime as dt, urllib.request, urllib.parse
import concurrent.futures as cf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "freshness.json")
A = "https://enterprise.gisdata.mn.gov/aghost/rest/services"
GDRS = "https://resources.gisdata.mn.gov/pub/gdrs/data/pub"
TODAY = dt.date.today()
# What the site is built around; a check reports "newer" when the world has moved past these.
EXPECTED = {"imagery_fsa_year": 2025, "impaired_list_year": 2024, "nss_peak_citation_year": 2023,
            "lidar_services": {"1st_Generation_DEM_Data", "2nd_Generation_Seamless_Lidar_DEM", "Generation_2_Minnesota_HPI"}}


def get(u, params=None, post=None, timeout=120):
    if params: u += ("&" if "?" in u else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(u, headers={"User-Agent": "northland-eco freshness check (github.com/Madruin/northland-hydro)"},
                                 data=urllib.parse.urlencode(post).encode() if post else None)
    return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")
def gj(u, params=None, post=None): return json.loads(get(u, params, post))
def ms(v): return dt.datetime.fromtimestamp(v / 1000, dt.UTC).date() if isinstance(v, (int, float)) and v > 1e11 else None
def ymd(v):  # 20260825 -> date
    s = str(int(v)) if v else ""
    return dt.date(int(s[:4]), int(s[4:6]), int(s[6:8])) if len(s) == 8 else None
def stat_max(url, field, where="1=1"):
    d = gj(url + "/query", {"where": where, "outStatistics": json.dumps([{"statisticType": "max", "onStatisticField": field, "outStatisticFieldName": "m"}]), "f": "json"})
    if d.get("error"): raise RuntimeError(d["error"].get("message"))
    return d["features"][0]["attributes"]["m"]
def gdrs_content_date(org, name):
    t = re.sub(r"<[^>]+>", " ", get(f"{GDRS}/{org}/{name}/metadata/metadata.html")); t = re.sub(r"\s+", " ", t)
    m = re.search(r"Time Period of Content Date:?\s*(\d{2})/(\d{2})/(\d{4})", t)
    return dt.date(int(m.group(3)), int(m.group(1)), int(m.group(2))) if m else None


# ---- checks: each returns (asOf, detail) ----
def c_stlouis(): return ymd(stat_max("https://gis.stlouiscountymn.gov/server2/rest/services/GeneralUse/Open_Data/MapServer/7", "LASTSALEDATE")), "newest recorded sale"
def c_cook():
    d = gj("https://services.arcgis.com/L3KwVADPEG6iD24f/arcgis/rest/services/Tax_Parcel_Layer_(Current)/FeatureServer/0?f=json")
    return ms(d["editingInfo"]["dataLastEditDate"]), "service data edit"
def c_carlton(): return int(stat_max("https://gis.co.carlton.mn.us/arcgis/rest/services/OpenData/Parcels_CarltonCountyMN/MapServer/0", "TPYEAR")), "tax-parcel year"
def c_aitkin(): return int(stat_max("https://gisweb.co.aitkin.mn.us/arcgis/rest/services/ParcelTaxData/FeatureServer/0", "TAX_YR")), "tax year"
def c_millelacs():
    u = "https://gis.co.mille-lacs.mn.us/arcgis/rest/services/AGO_Parcels_and_Lots/MapServer/3/query"
    for y in (TODAY.year + 1, TODAY.year, TODAY.year - 1):
        if gj(u, {"where": f"dbo.tblParcelJoin.TAX_YEAR={y}", "returnCountOnly": "true", "f": "json"}).get("count", 0): return y, "tax year (count query; server has no statistics)"
    return None, "no records for recent tax years"
def c_lake(): return ms(stat_max(f"{A}/us_mn_co_lake/plan_tax_parcels/FeatureServer/0", "gis_editdate")), "newest GIS edit (MnGeo copy)"
def c_kanabec(): return ymd(stat_max("https://wfs.schneidercorp.com/arcgis/rest/services/KanabecCountyMN_WFS/MapServer/0", "SALEDATE")), "newest recorded sale"
def c_pine():
    src = json.load(open(os.path.join(ROOT, "data", "pine_parcels", "index.json"), encoding="utf-8")).get("source", "")
    m = re.search(r"export (\d{4}-\d{2}-\d{2})", src)
    return (dt.date.fromisoformat(m.group(1)) if m else None), "county export shipped by email; ask the Auditor's office for a new one"
def c_gdrs(org, name, what): return lambda: (gdrs_content_date(org, name), what)
def c_indata(url, field, what, conv=ms): return lambda: (conv(stat_max(url, field)), what)
def c_ssurgo():
    r = gj("https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest", post={"query": "SELECT areasymbol, saverest FROM sacatalog WHERE areasymbol IN ('MN001','MN017','MN031','MN061','MN065','MN075','MN095','MN115','MN137')", "format": "JSON"})
    ds = {a: dt.datetime.strptime(s.split(" ")[0], "%m/%d/%Y").date() for a, s in r["Table"]}
    return min(ds.values()), "oldest county survey refresh (" + ", ".join(f"{a} {d}" for a, d in sorted(ds.items())) + ")"
def c_nbi():
    d = gj("https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_National_Bridge_Inventory/FeatureServer/0?f=json")
    m = re.search(r"as of ([A-Z][a-z]+ \d{1,2}, \d{4})", d.get("description") or "")
    return (dt.datetime.strptime(m.group(1), "%B %d, %Y").date() if m else ms(d["editingInfo"]["dataLastEditDate"])), "FHWA file vintage per BTS description"
def c_imagery():
    cap = get("https://imageserver.gisdata.mn.gov/cgi-bin/wmsll?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities")
    yrs = sorted({int(m) for m in re.findall(r"<Name>fsa(\d{4})(?:cir)?</Name>", cap)})
    return yrs[-1], f"newest statewide FSA flight in MnGeo WMS (site default: {EXPECTED['imagery_fsa_year']})"
def c_lidar():
    names = {s["name"].split("/")[-1] for s in gj("https://enterprise.gisdata.mn.gov/agsimg/rest/services/MnTopo?f=json")["services"]}
    new = names - EXPECTED["lidar_services"]
    return ("NEW: " + ", ".join(sorted(new))) if new else "2021-2023 seamless DEM", "MnTopo image services"
def c_impaired():
    names = {s["name"].split("/")[-1] for s in gj(f"{A}/us_mn_state_pca?f=json")["services"]}
    final = sorted(int(m.group(1)) for n in names for m in [re.fullmatch(r"env_impaired_water_(\d{4})", n)] if m)
    drafts = sorted(n for n in names if re.fullmatch(r"env_impaired_water_\d{4}_(draft|proposed)", n))
    return final[-1], f"newest final list service on MnGeo (site uses {EXPECTED['impaired_list_year']}); drafts: {', '.join(drafts[-2:]) or 'none'}"
def c_nss():
    cites = gj("https://streamstats.usgs.gov/nssservices/citations?regions=MN")
    yrs = sorted(int(m.group(1)) for c in cites for m in [re.match(r"(\d{4})", c.get("title") or "")] if m)
    return yrs[-1], "newest MN citation year in NSS (peak-flow regressions: SIR 2023-5079)"
def c_wlssd():
    d = json.load(open(os.path.join(ROOT, "data", "wlssd.json"), encoding="utf-8"))
    return dt.datetime.fromisoformat(d["harvestedAt"]).date(), f"hourly harvest; gauges updated {d.get('updated')}"
def c_snapshots():
    ds = {n: json.load(open(os.path.join(ROOT, "data", "layers", n, "index.json"), encoding="utf-8"))["fetched"] for n in os.listdir(os.path.join(ROOT, "data", "layers"))}
    return dt.date.fromisoformat(min(ds.values())), "oldest layer snapshot in data/layers (monthly rebuild)"
def c_qpe():
    d = gj("https://mapservices.weather.noaa.gov/raster/rest/services/obs/rfc_qpe/MapServer/27/query", {"where": "1=1", "outFields": "idp_issueddate", "orderByFields": "idp_issueddate DESC", "resultRecordCount": "1", "returnGeometry": "false", "f": "json"})
    v = d["features"][0]["attributes"]["idp_issueddate"]
    return (dt.datetime.fromisoformat(v).date() if isinstance(v, str) else ms(v)), "last 24-h mosaic issue date (updates hourly)"


# id: (label, check, max_age_days or None, kind)   kind: date | year | edition
CHECKS = {
    "parcels_stlouis": ("St. Louis County parcels", c_stlouis, 120, "date"),
    "parcels_cook": ("Cook County parcels", c_cook, 150, "date"),
    "parcels_carlton": ("Carlton County parcels", c_carlton, None, "year"),
    "parcels_aitkin": ("Aitkin County parcels", c_aitkin, None, "year"),
    "parcels_millelacs": ("Mille Lacs County parcels", c_millelacs, None, "year"),
    "parcels_lake": ("Lake County parcels", c_lake, 150, "date"),
    "parcels_kanabec": ("Kanabec County parcels", c_kanabec, 120, "date"),
    "parcels_pine": ("Pine County parcels", c_pine, 400, "date"),
    "pwi": ("DNR Public Waters Inventory", c_gdrs("us_mn_state_dnr", "water_mn_public_waters", "MnGeo content date"), 400, "date"),
    "hydrography": ("DNR hydrography", c_gdrs("us_mn_state_dnr", "water_dnr_hydrography", "MnGeo content date"), 400, "date"),
    "dams": ("DNR dams inventory", c_gdrs("us_mn_state_dnr", "struc_mn_dams_inventory_pub", "MnGeo content date"), 400, "date"),
    "culverts": ("DNR culvert inventory", c_indata(f"{A}/us_mn_state_dnr/struc_culvert_inventory_pub/FeatureServer/0", "last_edited_date", "newest edited survey"), 400, "date"),
    "karst_pts": ("Karst feature points", c_gdrs("us_mn_state_dnr", "geos_karst_feature_inventory_pts", "MnGeo content date"), 400, "date"),
    "karst_polys": ("Karst-prone regions", c_gdrs("us_mn_state_dnr", "geos_surface_karst_feature_devel", "MnGeo content date"), 1500, "date"),
    "springs": ("Springs inventory", c_gdrs("us_mn_state_dnr", "env_mn_springs_inventory", "MnGeo content date"), 400, "date"),
    "rim": ("BWSR RIM easements", c_indata(f"{A}/us_mn_state_bwsr/bdry_bwsr_rim_cons_easements/FeatureServer/0", "rec_date", "newest recorded easement"), 400, "date"),
    "wetbank": ("Wetland bank easements", c_indata(f"{A}/us_mn_state_bwsr/bdry_wetland_banking_easements/FeatureServer/0", "recording_date", "newest recorded easement"), 400, "date"),
    "nwi": ("National Wetlands Inventory (MN update)", c_gdrs("us_mn_state_dnr", "water_nat_wetlands_inv_2009_2014", "MnGeo content date; 2009-2014 imagery"), None, "date"),
    "trout": ("Designated trout streams", c_gdrs("us_mn_state_dnr", "env_trout_stream_designations", "MnGeo content date"), None, "date"),
    "impaired": ("MPCA impaired waters list", c_impaired, None, "edition"),
    "tmdl": ("TMDL allocation areas", c_gdrs("us_mn_state_pca", "env_tmdl_allocation_areas", "MnGeo content date"), 800, "date"),
    "cwi": ("County Well Index", c_indata(f"{A}/us_mn_state_health/water_well_information_non_pws/FeatureServer/0", "entry_date", "newest well entry", ymd), 120, "date"),
    "drillholes": ("DNR drill holes", c_gdrs("us_mn_state_dnr", "geos_boring_hole_locations", "MnGeo content date"), 400, "date"),
    "obwells": ("DNR observation wells", c_indata(f"{A}/us_mn_state_dnr/env_wiski_groundwater_monitoring/FeatureServer/0", "lastfieldvisit", "newest field visit"), 200, "date"),
    "ssurgo": ("SSURGO soils", c_ssurgo, 450, "date"),
    "nbi": ("National Bridge Inventory", c_nbi, 480, "date"),
    "imagery": ("MnGeo imagery (FSA)", c_imagery, None, "edition"),
    "lidar": ("MnTOPO lidar", c_lidar, None, "edition"),
    "nss": ("USGS NSS regressions", c_nss, None, "edition"),
    "wlssd": ("WLSSD gauges", c_wlssd, 3, "date"),
    "snapshots": ("Site layer snapshots", c_snapshots, 45, "date"),
    "qpe": ("NWS radar QPE", c_qpe, 3, "date"),
}
EDITION_EXPECTED = {"imagery": EXPECTED["imagery_fsa_year"], "impaired": EXPECTED["impaired_list_year"], "nss": EXPECTED["nss_peak_citation_year"], "lidar": "2021-2023 seamless DEM"}


def run(cid):
    label, fn, max_age, kind = CHECKS[cid]
    try:
        v, detail = fn(); status = "ok"
        if kind == "date" and isinstance(v, dt.date):
            age = (TODAY - v).days
            if max_age and age > max_age: status = "stale"
            elif max_age and age > max_age * 0.75: status = "watch"
            as_of = v.isoformat()
        elif kind == "year":
            as_of = str(v); status = "ok" if v >= TODAY.year else "stale" if v < TODAY.year - 1 else "watch"
        else:
            as_of = str(v); exp = EDITION_EXPECTED.get(cid)
            if exp is not None and str(v) != str(exp): status = "newer"
        return cid, {"label": label, "asOf": as_of, "detail": detail, "status": status}
    except Exception as e:
        return cid, {"label": label, "asOf": None, "detail": f"check failed: {str(e)[:160]}", "status": "error"}


if __name__ == "__main__":
    prev = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {"sources": {}}
    with cf.ThreadPoolExecutor(6) as ex: results = dict(ex.map(run, list(CHECKS)))
    for cid, r in results.items():  # keep the last good date when a check errors this time
        if r["status"] == "error" and prev["sources"].get(cid, {}).get("asOf"): r["lastGood"] = prev["sources"][cid]["asOf"]
    flags = [f"{r['label']}: {r['status']} ({r['asOf']}; {r['detail']})" for r in results.values() if r["status"] in ("stale", "newer")]
    out = {"checked": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), "flags": flags, "sources": results}
    json.dump(out, open(OUT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    for cid, r in results.items(): print(f"{r['status']:6} {r['label']:38} {r['asOf'] or '-':12} {r['detail'][:90]}")
    print(f"\n{len(flags)} flag(s)")
    for f in flags: print("  !", f)
    sys.exit(1 if flags else 0)
