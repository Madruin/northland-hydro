"""Watershed (HUC-8/10/12) boundary lines for drawing, without the Lake Superior shore strip.

USGS WBD puts a thin strip of coastal slivers along the whole Lake Superior shore in its own units (HUC 0418...,
e.g. 041800000102 "Nodaway Point-Frontal Lake Superior", ~2,600 pieces) next to the lake itself (041800000200).
The strip's inland edge is a sawtooth, so the land watersheds' lakeward boundaries drew as jagged zig-zags along the
shore. This writes data/layers/<huc>/lines.json: every boundary except the 0418 units, with the parts that run
along those units cut away, and labels.json: one label point per watershed (pole of inaccessibility), so the map
draws without the larger polygons. all.json stays as it is (the Point panel uses it for lookups).
Run after tools/build_static_layers.py; needs shapely."""
import json, os, sys
from shapely.geometry import shape as _shape, mapping
from shapely.validation import make_valid
from shapely.ops import unary_union, polylabel

def shape(g): # the server-generalized polygons can self-touch; repair before overlay operations
    s = _shape(g); return s if s.is_valid else make_valid(s)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "layers")
LEVELS = {"huc8": "huc8", "huc10": "huc10", "huc12": "huc12"}
LAKE = "0418"          # WBD subregion for Lake Superior's own units (the lake and the shore strip)
TRIM_DEG = 0.0009      # ~70-100 m: cut boundary parts lying along the strip

def rnd(c): return [round(c[0], 5), round(c[1], 5)] if isinstance(c[0], float) else [rnd(x) for x in c]

def run(level, mask):
    p = os.path.join(ROOT, level, "all.json")
    fc = json.load(open(p, encoding="utf-8")); code = LEVELS[level]
    out, labels = [], []
    for f in fc["features"]:
        pr = f["properties"]
        if str(pr.get(code, "")).startswith(LAKE) or not f.get("geometry"): continue
        poly = shape(f["geometry"]); b = poly.boundary
        big = max(getattr(poly, "geoms", [poly]), key=lambda g: g.area)
        if big.geom_type == "Polygon":
            pt = polylabel(big, tolerance=0.002); labels.append({"type": "Feature", "properties": {"label": pr.get("name", "")}, "geometry": {"type": "Point", "coordinates": [round(pt.x, 4), round(pt.y, 4)]}})
        if mask is not None and b.intersects(mask): b = b.difference(mask)
        if b.is_empty: continue
        b = b.simplify(0)  # merge collinear points left by the cut
        out.append({"type": "Feature", "properties": {k: pr[k] for k in (code, "name", "areasqkm", "hutype") if k in pr}, "geometry": {**(m := mapping(b)), "coordinates": rnd(m["coordinates"])}})
    q = os.path.join(ROOT, level, "lines.json")
    json.dump({"type": "FeatureCollection", "features": out}, open(q, "w", encoding="utf-8"), separators=(",", ":"))
    json.dump({"type": "FeatureCollection", "features": labels}, open(os.path.join(ROOT, level, "labels.json"), "w", encoding="utf-8"), separators=(",", ":"))
    print(f"{level}: {len(out)} boundary lines, {os.path.getsize(q) / 1e6:.1f} MB; {len(labels)} labels")

if __name__ == "__main__":
    # the strip and lake are clearest in HUC-12; the same mask trims the coarser levels' shore edges
    h12 = json.load(open(os.path.join(ROOT, "huc12", "all.json"), encoding="utf-8"))
    lake = [shape(f["geometry"]) for f in h12["features"] if str(f["properties"].get("huc12", "")).startswith(LAKE) and f.get("geometry")]
    mask = unary_union(lake).buffer(TRIM_DEG) if lake else None
    print(f"Lake Superior units: {len(lake)}")
    for lv in (sys.argv[1:] or LEVELS): run(lv, mask)
