"""Convert the Pine County parcel shapefile (delivered by the county Auditor's Office, NAD83 HARN Pine County feet)
into WGS84 GeoJSON chunks the site can load per viewport: data/pine_parcels/index.json + c_{col}_{row}.json.

Usage: python tools/build_pine_parcels.py "path/to/090926 Parcels.shp"
Keeps only the fields the other counties' public services expose (PIN, owner, acres, site address, class, district,
legal, year built); drops mailing addresses, tax, sale and building details. Requires pyshp and pyproj.
"""
import json, math, os, sys
import shapefile, pyproj

src = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Downloads/090926 Pine County Parcels/090926 Parcels.shp")
out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "pine_parcels")
os.makedirs(out, exist_ok=True)
CELL = 0.1  # degrees; Pine County spans ~-93.1 to -92.3, 45.7 to 46.4 → about 8 x 7 cells
r = shapefile.Reader(src)
crs = pyproj.CRS.from_wkt(open(src[:-4] + ".prj").read())
tr = pyproj.Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
names = [f[0] for f in r.fields[1:]]
cells = {}
search = []
n = 0
def clean(s): return " ".join(str(s or "").split())
for sr in r.iterShapeRecords():
    rec = dict(zip(names, sr.record)); shp = sr.shape
    if not shp.points: continue
    parts = list(shp.parts) + [len(shp.points)]
    rings = []
    for a, b in zip(parts[:-1], parts[1:]):
        pts = shp.points[a:b]
        xs, ys = tr.transform([p[0] for p in pts], [p[1] for p in pts])
        rings.append([[round(x, 6), round(y, 6)] for x, y in zip(xs, ys)])
    # shapefile rings: outer clockwise, holes counter-clockwise → group into polygons
    def area(ring): return sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1] for i in range(len(ring) - 1)) / 2
    polys = []
    for ring in rings:
        if area(ring) < 0 or not polys: polys.append([ring])  # clockwise (negative) = outer
        else: polys[-1].append(ring)
    geom = {"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1 else {"type": "MultiPolygon", "coordinates": polys}
    owner = " & ".join(x for x in [clean(rec.get("OwnerName1")), clean(rec.get("OwnerName2"))] if x)
    addr = clean(f"{rec.get('HouseNumbe') or ''} {rec.get('Address') or ''}")
    props = {"pin": clean(rec.get("ParcelID")), "owner": owner, "acres": rec.get("Acreage"), "acresDeed": rec.get("PYACTACR"), "address": addr, "city": clean(rec.get("City")),
             "use": clean(rec.get("Class")), "district": clean(rec.get("DISTRICT_N")), "legal": clean(rec.get("LegalDesc"))[:200], "year": int(rec["YearBuilt"]) if rec.get("YearBuilt") else None, "str": clean(rec.get("SecTwpRng"))}
    feat = {"type": "Feature", "geometry": geom, "properties": props}
    xs = [p[0] for ring in rings for p in ring]; ys = [p[1] for ring in rings for p in ring]
    for cx in range(math.floor(min(xs) / CELL), math.floor(max(xs) / CELL) + 1):
        for cy in range(math.floor(min(ys) / CELL), math.floor(max(ys) / CELL) + 1):
            cells.setdefault((cx, cy), []).append(feat)
    n += 1
    cx_, cy_ = tr.transform(rec.get("CENTROID_X") or shp.points[0][0], rec.get("CENTROID_Y") or shp.points[0][1])
    search.append([props["pin"], owner, addr, round(cx_, 5), round(cy_, 5)])
index = {"cell": CELL, "crs": "EPSG:4326", "source": "Pine County Auditor's Office, parcel export 2026-09-09 (received 2026-09-14)", "parcels": n, "cells": []}
for (cx, cy), feats in sorted(cells.items()):
    name = f"c_{cx}_{cy}.json"
    with open(os.path.join(out, name), "w", encoding="utf-8") as f: json.dump({"type": "FeatureCollection", "features": feats}, f, separators=(",", ":"))
    index["cells"].append({"f": name, "bbox": [round(cx * CELL, 4), round(cy * CELL, 4), round((cx + 1) * CELL, 4), round((cy + 1) * CELL, 4)], "n": len(feats)})
with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as f: json.dump(index, f, separators=(",", ":"))
with open(os.path.join(out, "search.json"), "w", encoding="utf-8") as f: json.dump(search, f, separators=(",", ":"))  # [pin, owner, address, lon, lat] for the search box
total = sum(os.path.getsize(os.path.join(out, c["f"])) for c in index["cells"])
print(f"{n} parcels -> {len(index['cells'])} cells, {total/1e6:.1f} MB; largest cell {max(c['n'] for c in index['cells'])} parcels")
