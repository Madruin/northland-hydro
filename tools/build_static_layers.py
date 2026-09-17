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
BBOX = [-93.45, 45.55, -89.45, 48.35]   # TSA3 counties plus a margin
CELL = 0.25
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "layers")
# id: (url, fields, where, options) — options: offset = maxAllowableOffset in degrees (default 0.00004 ≈ 4 m),
# single = write one all.json instead of cells (for a few huge polygons that would be duplicated across many cells)
OPTS = {"tmdl-areas": {"offset": 0.0004, "single": True}, "pwi-basins": {"offset": 0.00006}, "pwi-lines": {"offset": 0.00006}, "imp-lakes": {"offset": 0.00006}}
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
    "xing-dnr":    (f"{B}/us_mn_state_dnr/struc_culvert_inventory_pub/FeatureServer/0", "crossing_id,crossing_type,stream_name,stream_kittle,road_path_or_railway_name,total_span,bankfull_width_ft,crossing_condition,priority,fish_barrier_at_some_flows,fish_barrier_at_all_flows,recommended_corrective_actions", None),
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

def page(lid):
    url, fields, where = LAYERS[lid]
    base = {"geometry": ",".join(map(str, BBOX)), "geometryType": "esriGeometryEnvelope", "inSR": "4326", "spatialRel": "esriSpatialRelIntersects",
            "outFields": fields, "outSR": "4326", "geometryPrecision": "5", "maxAllowableOffset": str(OPTS.get(lid, {}).get("offset", 0.00004)), "where": where or "1=1", "f": "geojson", "orderByFields": "objectid", "resultRecordCount": "2000"}
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
    for f in os.listdir(d): os.remove(os.path.join(d, f))
    cells = {}
    for i, f in enumerate(feats):
        if not f.get("geometry"): continue
        f["properties"]["__id"] = i
        bb = bbox_of(f["geometry"])
        for cx in range(math.floor(bb[0] / CELL), math.floor(bb[2] / CELL) + 1):
            for cy in range(math.floor(bb[1] / CELL), math.floor(bb[3] / CELL) + 1):
                cells.setdefault((cx, cy), []).append(f)
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
        index["cells"].append({"f": name, "bbox": [round(cx * CELL, 4), round(cy * CELL, 4), round((cx + 1) * CELL, 4), round((cy + 1) * CELL, 4)], "n": len(fs)})
    with open(os.path.join(d, "index.json"), "w", encoding="utf-8") as fh: json.dump(index, fh, separators=(",", ":"))
    print(f"{lid}: {len(feats)} features, {len(cells)} cells, {total/1e6:.1f} MB", flush=True)

def build(lid):
    t = time.time()
    try:
        feats = page(lid); write(lid, feats, LAYERS[lid][0]); return f"{lid} ok in {time.time()-t:.0f}s"
    except Exception as e: return f"{lid} FAILED: {e}"

if __name__ == "__main__":
    ids = sys.argv[1:] or list(LAYERS)
    with cf.ThreadPoolExecutor(4) as ex:
        for r in ex.map(build, ids): print(r, flush=True)
