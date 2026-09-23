"""Build the Trails layer: agency trails (MN DNR state trails, state park trails, grant-in-aid snowmobile trails, USFS
Superior National Forest trails) plus OpenStreetMap paths, cycleways, bridleways and nordic ski trails, merged into one
line layer with a common use vocabulary. Writes data/layers/trails/ (0.25° cells + index, like build_static_layers.py)
and overview.json (agency trails and named/route OSM trails, simplified) for zoomed-out views.

    python tools/build_trails.py

OpenStreetMap data © OpenStreetMap contributors, available under the Open Database License (ODbL); this extract is
published openly under the same license (see "license" in index.json).
"""
import json, os, sys, time, urllib.request, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_static_layers import fetch, write, BBOX, OUT  # same paging, cell layout and region

A = "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr"
USFS = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
UA = "northland-eco trails build (github.com/Madruin/northland-hydro; matiasvalero@tsa3.org)"
DNR_USE = {"use_hike": "hike", "use_hiking": "hike", "use_selfgu": "hike", "use_accpat": "hike", "use_wntrhi": "hike", "use_horse": "horse", "use_bike": "bike", "use_inline": "bike",
           "use_mntbik": "mtb", "use_snosho": "snowshoe", "use_sleddo": "dogsled", "use_atvcl1": "atv", "use_atvcl2": "atv", "use_ohm": "atv", "use_orv": "atv"}
USFS_USE = {"hiker_pedestrian_managed": "hike", "pack_saddle_managed": "horse", "bicycle_managed": "bike", "motorcycle_managed": "atv", "atv_managed": "atv",
            "snowmobile_managed": "snowmobile", "snowshoe_managed": "snowshoe", "xcountry_ski_managed": "ski", "e_bike_class1_managed": "bike"}
MOTOR = {"snowmobile", "atv"}

def category(uses):
    u = set(uses)
    if u and u <= MOTOR | {"dogsled"}: return "motor"
    if "ski" in u and not u & {"bike", "mtb"}: return "ski"
    if u & {"bike", "mtb"} and "hike" in u: return "multi"
    if u & {"bike", "mtb"}: return "bike"
    if u & MOTOR and not u & {"hike", "horse", "snowshoe"}: return "motor"
    return "hike"

def arcgis(url, fields, where="1=1", oid="objectid"):
    base = {"geometry": ",".join(map(str, BBOX)), "geometryType": "esriGeometryEnvelope", "inSR": "4326", "spatialRel": "esriSpatialRelIntersects", "outFields": fields,
            "outSR": "4326", "geometryPrecision": "5", "maxAllowableOffset": "0.00004", "where": where, "f": "geojson", "orderByFields": oid, "resultRecordCount": "2000"}
    out, off = [], 0
    while True:
        d = fetch(url, {**base, "resultOffset": str(off)}); got = d.get("features", []); out += got
        if not got or not ((d.get("properties") or {}).get("exceededTransferLimit") or d.get("exceededTransferLimit")): return out
        off += len(got)

def feat(geom, name, src, uses, mgr, surf=None, ref=None, routes=None):
    uses = sorted(set(uses)); name = (name or "").strip() or None
    return {"type": "Feature", "geometry": geom, "properties": {k: v for k, v in {"name": name, "src": src, "uses": ",".join(uses), "cat": category(uses), "mgr": mgr, "surf": surf, "ref": ref, "routes": routes}.items() if v}}

def agency():
    out = []
    uf = ",".join(DNR_USE)
    for f in arcgis(f"{A}/trans_state_trails_minnesota/FeatureServer/0", "trail_name,surfacetyp," + uf):
        p = f["properties"]; uses = [v for k, v in DNR_USE.items() if p.get(k) == 1] or ["hike"]
        out.append(feat(f["geometry"], p.get("trail_name"), "MN DNR state trail", uses, "MN DNR Parks and Trails", p.get("surfacetyp")))
    n1 = len(out)
    for f in arcgis(f"{A}/trans_state_park_trails_roads/FeatureServer/0", "trail_name,road_name,public_use,service_rd," + uf):
        p = f["properties"]; uses = [v for k, v in DNR_USE.items() if p.get(k) == 1]
        if not uses or p.get("service_rd") == 1: continue  # park roads and service roads are not trails ("public_use" is vehicle access on roads)
        out.append(feat(f["geometry"], p.get("trail_name"), "MN DNR state park trail", uses, "MN DNR state park"))
    n2 = len(out)
    for f in arcgis(f"{A}/trans_snowmobile_trails_mn/FeatureServer/0", "trail_num,trail_name,owner_type,maint_by,pocwebsite"):
        p = f["properties"]
        out.append(feat(f["geometry"], p.get("trail_name"), f"MN snowmobile trail ({p.get('owner_type') or 'grant-in-aid'} #{p.get('trail_num')})", ["snowmobile"], p.get("maint_by"), None, p.get("pocwebsite")))
    n3 = len(out)
    for f in arcgis(USFS, "trail_name,trail_type,trail_surface," + ",".join(USFS_USE)):
        p = f["properties"]; uses = [v for k, v in USFS_USE.items() if p.get(k)]
        if p.get("trail_type") == "WATER" or not f.get("geometry"): continue
        out.append(feat(f["geometry"], (p.get("trail_name") or "").title() or None, "USFS Superior National Forest trail", uses or ["hike"], "Superior National Forest", (p.get("trail_surface") or "").lower() or None))
    print(f"agency: DNR state {n1}, DNR park {n2-n1}, snowmobile {n3-n2}, USFS {len(out)-n3}", flush=True)
    return out

def overpass(q):
    for ep in OVERPASS:
        for i in range(3):
            try:
                req = urllib.request.Request(ep, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": UA})
                return json.loads(urllib.request.urlopen(req, timeout=300).read())
            except Exception as e:
                print(f"  overpass {ep} try {i+1}: {e}", flush=True); time.sleep(20 * (i + 1))
    raise RuntimeError("Overpass unavailable")

def osm():
    s, w, n, e = BBOX[1], BBOX[0], BBOX[3], BBOX[2]; bb = f"({s},{w},{n},{e})"
    rel = overpass(f'[out:json][timeout:180];relation["route"~"^(hiking|foot|walking|mtb|bicycle|ski|horse|snowmobile)$"]{bb};out body;')
    routes = {}
    for r in rel.get("elements", []):
        t = r.get("tags", {}); nm = t.get("name") or t.get("ref")
        for m in r.get("members", []):
            if m.get("type") == "way": routes.setdefault(m["ref"], []).append((nm, t.get("route")))
    ways = overpass(f'[out:json][timeout:300];(way["highway"~"^(path|footway|cycleway|bridleway)$"]["footway"!~"sidewalk|crossing"]["access"!~"^(private|no)$"]{bb};way["piste:type"="nordic"]{bb};way["highway"="track"]["mtb:scale"]{bb};way["snowmobile"~"^(designated|yes)$"]["highway"~"^(track|path)$"]{bb};);out tags geom;')
    out = []
    for wy in ways.get("elements", []):
        g = wy.get("geometry"); t = wy.get("tags", {})
        if not g or len(g) < 2: continue
        rs = routes.get(wy["id"], []); rt = {r for _, r in rs}
        uses = []
        hw = t.get("highway")
        if hw in ("path", "footway", "bridleway") and t.get("foot") != "no": uses.append("hike")
        if hw == "cycleway" or t.get("bicycle") in ("yes", "designated", "permissive"): uses.append("bike")
        if hw == "cycleway" and t.get("foot") in ("yes", "designated", "permissive"): uses.append("hike")
        if "mtb:scale" in t or "mtb" in rt: uses.append("mtb")
        if t.get("piste:type") == "nordic" or "ski" in rt: uses.append("ski")
        if t.get("snowmobile") in ("yes", "designated") or "snowmobile" in rt: uses.append("snowmobile")
        if hw == "bridleway" or t.get("horse") in ("yes", "designated") or "horse" in rt: uses.append("horse")
        if t.get("atv") in ("yes", "designated") or t.get("motorcycle") in ("yes", "designated"): uses.append("atv")
        if rt & {"hiking", "foot", "walking"}: uses.append("hike")
        if "bicycle" in rt: uses.append("bike")
        names = sorted({nm for nm, _ in rs if nm})
        geom = {"type": "LineString", "coordinates": [[round(p["lon"], 5), round(p["lat"], 5)] for p in g]}
        out.append(feat(geom, t.get("name") or (names[0] if names else None), "OpenStreetMap (community)", uses or ["hike"], None, t.get("surface"), f"https://www.openstreetmap.org/way/{wy['id']}", "; ".join(names) or None))
    print(f"osm: {len(out)} ways, {len(routes)} ways in {len(rel.get('elements', []))} route relations", flush=True)
    return out

def rdp(pts, eps):
    if len(pts) < 3: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]; dx, dy = x2 - x1, y2 - y1; L = (dx * dx + dy * dy) ** 0.5 or 1e-12
    i, dmax = 0, -1
    for k in range(1, len(pts) - 1):
        d = abs(dy * pts[k][0] - dx * pts[k][1] + x2 * y1 - y2 * x1) / L
        if d > dmax: i, dmax = k, d
    if dmax <= eps: return [pts[0], pts[-1]]
    return rdp(pts[: i + 1], eps)[:-1] + rdp(pts[i:], eps)

def simplify(g, eps=0.0005):
    if g["type"] == "LineString": return {"type": "LineString", "coordinates": [[round(x, 4), round(y, 4)] for x, y in rdp(g["coordinates"], eps)]}
    if g["type"] == "MultiLineString": return {"type": "MultiLineString", "coordinates": [[[round(x, 4), round(y, 4)] for x, y in rdp(l, eps)] for l in g["coordinates"]]}
    return g

if __name__ == "__main__":
    sys.setrecursionlimit(10000)
    feats = agency() + osm()
    feats = [f for f in feats if f.get("geometry")]
    write("trails", feats, "MN DNR state/park/snowmobile trails, USFS Superior NF trails, OpenStreetMap")
    d = os.path.join(OUT, "trails"); idx = json.load(open(os.path.join(d, "index.json"), encoding="utf-8"))
    idx["license"] = "Contains OpenStreetMap data (c) OpenStreetMap contributors, available under the Open Database License (ODbL) https://opendatacommons.org/licenses/odbl/; this extract is published under the same license."
    json.dump(idx, open(os.path.join(d, "index.json"), "w", encoding="utf-8"), separators=(",", ":"))
    slim = lambda p: {k: p[k] for k in ("name", "cat", "src", "routes") if p.get(k)}  # full attributes load with the cells when zoomed in
    ov = [{"type": "Feature", "geometry": simplify(f["geometry"]), "properties": slim(f["properties"])} for f in feats
          if f["properties"].get("routes") or (f["properties"].get("name") and not f["properties"]["src"].startswith("OpenStreetMap")) or f["properties"]["src"].startswith(("MN DNR state trail", "MN snowmobile"))]
    with open(os.path.join(d, "overview.json"), "w", encoding="utf-8") as fh: json.dump({"type": "FeatureCollection", "features": ov}, fh, separators=(",", ":"))
    print(f"trails: {len(feats)} segments; overview {len(ov)} features, {os.path.getsize(os.path.join(d, 'overview.json'))/1e6:.1f} MB", flush=True)
