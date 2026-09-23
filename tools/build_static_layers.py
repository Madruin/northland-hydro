"""Snapshot the slow-changing regional MnGeo layers into cell-chunked GeoJSON under data/layers/<id>/ so the site can
draw them without waiting on enterprise.gisdata.mn.gov (which was answering every query in exactly 60 s on
2026-09-17). Run when a layer is known to have changed (PWI and impaired-waters lists update yearly or less):

    python tools/build_static_layers.py            # all layers
    python tools/build_static_layers.py trout rim  # selected ids

Each layer becomes data/layers/<id>/index.json {cell, bbox, source, fetched, n, cells:[{f,bbox,n}]} and c_<x>_<y>.json
FeatureCollections (a feature is written into every cell its bbox touches; the client dedupes by __id).
"""
import json, math, os, sys, time, urllib.request, urllib.parse
import concurrent.futures as cf

B = "https://enterprise.gisdata.mn.gov/aghost/rest/services"
BBOX = [-93.85, 45.50, -89.45, 48.65]   # TSA3 counties (TIGER extent -93.81..-89.48, 45.56..48.63) plus a margin
CELL = 0.25
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "layers")
# id: (url, fields, where, options) — options: offset = maxAllowableOffset in degrees (default 0.00004 ≈ 4 m),
# single = write one all.json instead of cells (for a few huge polygons that would be duplicated across many cells)
# ov_where = extra filter for the overview pass; overview_only = no detail cells (source too big to snapshot); oid = order field
OPTS = {"tmdl-areas": {"offset": 0.0004, "single": True}, "pwi-basins": {"offset": 0.00006}, "pwi-lines": {"offset": 0.00006}, "imp-lakes": {"offset": 0.00006},
        "fema-zones": {"offset": 0.0001, "oid": "OBJECTID"}, "fema-xs": {"oid": "OBJECTID"}, "fema-bfe": {"oid": "OBJECTID"}, "fema-lomr": {"oid": "OBJECTID"},
        "huc8": {"offset": 0.0015, "prec": 4, "single": True, "no_overview": True}, "huc10": {"offset": 0.001, "prec": 4, "single": True, "no_overview": True},
        "huc12": {"offset": 0.0006, "prec": 4, "single": True, "no_overview": True},
        "crithab": {"offset": 0.0008, "prec": 4, "single": True, "no_overview": True, "oid": "OBJECTID"},
        "xing-dnr": {"single": True, "no_overview": True}, "xing-nbi": {"single": True, "no_overview": True, "oid": "OBJECTID"}}
WBD = "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer"
FEMA = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer"
LAYERS = {
    "trout":       (f"{B}/us_mn_state_dnr/env_trout_stream_designations/FeatureServer/0", "kittle_nbr,kittle_name,trout_flag,length_mi", None),
    "karst-poly":  (f"{B}/us_mn_state_dnr/geos_surface_karst_feature_devel/FeatureServer/1", "maplabel,descriptn,map", None),
    "karst-pts":   (f"{B}/us_mn_state_dnr/geos_karst_feature_inventory_pts/FeatureServer/0", "feature,name,feat_label,status,depth2bdrk,first_bdrk,elevation,vert_datum,field_check_date", None),
    "springs":     (f"{B}/us_mn_state_dnr/env_mn_springs_inventory/FeatureServer/0", "name,feature,spring_type,lithology,flowing,flow,flow_units,temp_c,field_check_date", None),
    "rim":         (f"{B}/us_mn_state_bwsr/bdry_bwsr_rim_cons_easements/FeatureServer/0", "ease_num,ease_type,ease_cat,fund_type,ease_acres,ease_year,exp_status,exp_date,swcd_name,recorded,rec_date", None),
    "wetbank":     (f"{B}/us_mn_state_bwsr/bdry_wetland_banking_easements/FeatureServer/0", "county,siteid,easement_number,acres,instrument_type,recording_date,description", None),
    "imp-streams": (f"{B}/us_mn_state_pca/env_impaired_water_2024/FeatureServer/7", "auid,name,reach_desc,affected_u,imp_param,new_impair,approved,needs_pln,huc_8_name,use_class,length_miles", None),
    "imp-lakes":   (f"{B}/us_mn_state_pca/env_impaired_water_2024/FeatureServer/13", "auid,name,reach_desc,affected_u,imp_param,new_impair,approved,needs_pln,huc_8_name,use_class,area_acres", "area_acres < 200000"),
    "tmdl-areas":  (f"{B}/us_mn_state_pca/env_tmdl_allocation_areas/FeatureServer/3", "waterbody_name,tmdl_pollutant,epa_approval,source,area_sq_mi,wid", None),
    "pwi-basins":  (f"{B}/us_mn_state_dnr/water_mn_public_waters/FeatureServer/1", "pw_basin_name,dowlknum,pwi_class,pwi_label,wettype,acres,shore_mi,dnr_shoreland_class", "dowlknum <> '16000100'"),
    "pwi-lines":   (f"{B}/us_mn_state_dnr/water_mn_public_waters/FeatureServer/0", "kittle_name,kittle_nbr,pwi_label,entire", None),
    # FEMA NFHL: hazard zones only (SFHA + 0.2%); unshaded X covers most land and is drawn live at zoom 12+
    "fema-zones":  (f"{FEMA}/28", "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DEPTH,V_DATUM,STUDY_TYP,DFIRM_ID,SOURCE_CIT", "SFHA_TF = 'T' OR ZONE_SUBTY LIKE '%0.2%'"),
    "fema-xs":     (f"{FEMA}/14", "XS_LTR,WSEL_REG,STREAM_STN,WTR_NM,XS_LN_TYP,V_DATUM", None),
    "fema-bfe":    (f"{FEMA}/16", "ELEV,V_DATUM", None),
    "fema-lomr":   (f"{FEMA}/1", "CASE_NO,EFF_DATE,STATUS", None),
    # USFWS critical habitat (Canada lynx, piping plover, gray wolf in the region); IPaC gives the species list per point
    "crithab":     ("https://services.arcgis.com/QVENGdaPbd4LUkLV/arcgis/rest/services/USFWS_Critical_Habitat/FeatureServer/0", "comname,sciname,status,fedreg,unitname,listing_status,pubdate,effectdate", None),
    # USGS Watershed Boundary Dataset (drawn at every zoom; wetlands zoomed out come from the FWS 100 m raster instead)
    "huc8":        (f"{WBD}/4", "huc8,name,areasqkm,states", None),
    "huc10":       (f"{WBD}/5", "huc10,name,areasqkm,states,hutype", None),
    "huc12":       (f"{WBD}/6", "huc12,name,areasqkm,states,hutype,tohuc", None),
    # Stream crossings, drawn region-wide at every zoom (field lists match js/crossings.js so popups are the same zoomed in or out)
    "xing-dnr":    (f"{B}/us_mn_state_dnr/struc_culvert_inventory_pub/FeatureServer/0", "crossing_id,crossing_type,stream_name,stream_kittle,road_path_or_railway_name,own_type,maint_name,county,year_built,crossing_condition,condition_issues,total_span,bankfull_width_ft,bankfull_estimate_confidence,fish_barrier_at_some_flows,fish_barrier_at_all_flows,primary_limiting_factor_for_pas,scour_pool,scour_pool_depth_ft,upstream_pool,upstream_deposition,bank_erosion_caused_by_crossing,crossing_properly_aligned,stream_stability_impact,priority,recommended_corrective_actions,field_date,survey_purpose,quantity,channel_gradient,floodprone_width_ft,inlet_bed_elevation,outlet_bed_elevation,headwater_surface_elevation,tailwater_surface_elevation,road_width_ft,notes_and_comments", None),
    "xing-nbi":    ("https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_National_Bridge_Inventory/FeatureServer/0", "STRUCTURE_NUMBER_008,FACILITY_CARRIED_007,FEATURES_DESC_006A,YEAR_BUILT_027,YEAR_RECONSTRUCTED_106,STRUCTURE_KIND_043A,STRUCTURE_TYPE_043B,MAIN_UNIT_SPANS_045,STRUCTURE_LEN_MT_049,MAX_SPAN_LEN_MT_048,DECK_WIDTH_MT_052,DECK_COND_058,SUPERSTRUCTURE_COND_059,SUBSTRUCTURE_COND_060,CHANNEL_COND_061,CULVERT_COND_062,SCOUR_CRITICAL_113,WATERWAY_EVAL_071,OWNER_022,MAINTENANCE_021,BRIDGE_CONDITION,LOWEST_RATING,OPERATING_RATING_064,INVENTORY_RATING_066,POSTING_EVAL_070", None),
}

def fetch(url, params, tries=4):
    for i in range(tries):
        try:
            r = urllib.request.urlopen(url + "/query?" + urllib.parse.urlencode(params), timeout=180)
            d = json.loads(r.read())
            if d.get("error"): raise RuntimeError(d["error"].get("message"))
            return d
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(5 * (i + 1))

OV_OFFSET = 0.002   # ~200 m: region-wide "overview" geometry drawn below each layer's normal zoom (a few hundred KB per layer)
def page(lid, offset=None, where=None):
    url, fields, where0 = LAYERS[lid]
    where = " AND ".join(f"({w})" for w in (where0, where) if w) or "1=1"
    base = {"geometry": ",".join(map(str, BBOX)), "geometryType": "esriGeometryEnvelope", "inSR": "4326", "spatialRel": "esriSpatialRelIntersects",
            "outFields": fields, "outSR": "4326", "geometryPrecision": "4" if offset else str(OPTS.get(lid, {}).get("prec", 5)), "maxAllowableOffset": str(offset or OPTS.get(lid, {}).get("offset", 0.00004)), "where": where, "f": "geojson", "orderByFields": OPTS.get(lid, {}).get("oid", "objectid"), "resultRecordCount": "2000"}
    feats, offset = [], 0
    while True:
        d = fetch(url, {**base, "resultOffset": str(offset)})
        got = d.get("features", [])
        feats += got
        print(f"  {lid}: {len(feats)} so far", flush=True)
        exceeded = bool((d.get("properties") or {}).get("exceededTransferLimit")) or bool(d.get("exceededTransferLimit"))
        if not got or not exceeded: break  # ArcGIS caps a page by record count *or* bytes; only its flag says whether more remain
        offset += len(got)
    return feats

def bbox_of(g):
    xs, ys = [], []
    def walk(c):
        if isinstance(c[0], (int, float)): xs.append(c[0]); ys.append(c[1])
        else:
            for x in c: walk(x)
    walk(g["coordinates"]); return [min(xs), min(ys), max(xs), max(ys)]

def write(lid, feats, url):
    d = os.path.join(OUT, lid); os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        if f != "overview.json": os.remove(os.path.join(d, f))
    # Each feature is stored once, in the cell holding its bbox centre; the cell's index bbox is then widened to the
    # union of its features' bboxes, so the client (which picks cells by index bbox) still finds long river-following
    # polygons and lines without them being copied into every cell they cross (FEMA zones were 5x inflated).
    cells, cbb = {}, {}
    for i, f in enumerate(feats):
        if not f.get("geometry"): continue
        f["properties"]["__id"] = i
        bb = bbox_of(f["geometry"])
        cx, cy = math.floor((bb[0] + bb[2]) / 2 / CELL), math.floor((bb[1] + bb[3]) / 2 / CELL)
        cells.setdefault((cx, cy), []).append(f)
        u = cbb.get((cx, cy)); cbb[(cx, cy)] = [min(u[0], bb[0]), min(u[1], bb[1]), max(u[2], bb[2]), max(u[3], bb[3])] if u else list(bb)
    index = {"cell": CELL, "bbox": BBOX, "source": url, "fetched": time.strftime("%Y-%m-%d"), "n": len(feats), "cells": []}
    total = 0
    if OPTS.get(lid, {}).get("single"):
        p = os.path.join(d, "all.json")
        with open(p, "w", encoding="utf-8") as fh: json.dump({"type": "FeatureCollection", "features": [f for f in feats if f.get("geometry")]}, fh, separators=(",", ":"))
        index["single"] = "all.json"; index["cells"] = []
        with open(os.path.join(d, "index.json"), "w", encoding="utf-8") as fh: json.dump(index, fh, separators=(",", ":"))
        print(f"{lid}: {len(feats)} features, single file {os.path.getsize(p)/1e6:.1f} MB", flush=True); return
    for (cx, cy), fs in sorted(cells.items()):
        name = f"c_{cx}_{cy}.json"; p = os.path.join(d, name)
        with open(p, "w", encoding="utf-8") as fh: json.dump({"type": "FeatureCollection", "features": fs}, fh, separators=(",", ":"))
        total += os.path.getsize(p)
        b = cbb[(cx, cy)]; index["cells"].append({"f": name, "bbox": [round(b[0] - 1e-4, 4), round(b[1] - 1e-4, 4), round(b[2] + 1e-4, 4), round(b[3] + 1e-4, 4)], "n": len(fs)})
    with open(os.path.join(d, "index.json"), "w", encoding="utf-8") as fh: json.dump(index, fh, separators=(",", ":"))
    print(f"{lid}: {len(feats)} features, {len(cells)} cells, {total/1e6:.1f} MB", flush=True)

def write_overview(lid, feats):
    """One simplified FeatureCollection for the whole region (points: the full set), read by the site below the layer's minZoom."""
    d = os.path.join(OUT, lid)
    is_point = any((f.get("geometry") or {}).get("type", "").endswith("Point") for f in feats[:20])
    ov = feats if is_point else page(lid, OV_OFFSET, OPTS.get(lid, {}).get("ov_where"))
    for i, f in enumerate(ov): f["properties"]["__id"] = i
    p = os.path.join(d, "overview.json")
    with open(p, "w", encoding="utf-8") as fh: json.dump({"type": "FeatureCollection", "features": [f for f in ov if f.get("geometry")]}, fh, separators=(",", ":"))
    print(f"{lid}: overview {len(ov)} features, {os.path.getsize(p)/1e6:.1f} MB", flush=True)

def build(lid):
    t = time.time()
    try:
        if OPTS.get(lid, {}).get("overview_only"):
            os.makedirs(os.path.join(OUT, lid), exist_ok=True); write_overview(lid, [])
            with open(os.path.join(OUT, lid, "index.json"), "w", encoding="utf-8") as fh: json.dump({"cell": CELL, "bbox": BBOX, "source": LAYERS[lid][0], "fetched": time.strftime("%Y-%m-%d"), "n": 0, "cells": [], "overview_only": True}, fh, separators=(",", ":"))
            return f"{lid} overview ok in {time.time()-t:.0f}s"
        feats = page(lid); write(lid, feats, LAYERS[lid][0])
        if not OPTS.get(lid, {}).get("no_overview"): write_overview(lid, feats)
        return f"{lid} ok in {time.time()-t:.0f}s"
    except Exception as e: return f"{lid} FAILED: {e}"

if __name__ == "__main__":
    ids = sys.argv[1:] or list(LAYERS)
    with cf.ThreadPoolExecutor(4) as ex:
        for r in ex.map(build, ids): print(r, flush=True)
