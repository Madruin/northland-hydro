"""Vector tiles (PMTiles) for the regional overlays, so the map draws accurate geometry at every zoom with no
overview/detail swaps. One .pmtiles per layer group in data/tiles/, one source-layer per overlay id (the same ids the
map already uses: fema-zones, pwi-basins, ...).

  python tools/build_tiles.py            # needs tippecanoe (>= 2.17, for .pmtiles output) on PATH

Polygons and lines are fetched fresh at ~1 m (maxAllowableOffset 0.00001 deg, 6 decimals) from FEMA and MnGeo;
tippecanoe then simplifies per zoom to well under a screen pixel. Points, contamination polygons and trails come from
the monthly snapshots in data/layers/ (built by build_static_layers.py, build_mpca.py, build_trails.py; run those
first). Each feature carries the colour/opacity the map paints with (these rules mirror decorate() in
js/dnrlayers.js and zoneStyle() in js/fema.js; keep them in step). A group is rebuilt only when its input changed
(sha256 in data/tiles/manifest.json), so unchanged tiles don't add to the repository history every month.
"""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_static_layers as b

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILES = os.path.join(ROOT, "data", "tiles")
LAYERS_DIR = os.path.join(ROOT, "data", "layers")

GROUPS = {
    "fema": ["fema-zones", "fema-xs", "fema-bfe", "fema-lomr"],
    "pwi": ["pwi-basins", "pwi-lines"],
    "impaired": ["tmdl-areas", "imp-lakes", "imp-streams"],
    "easements": ["rim", "wetbank"],
    "trout": ["trout"],
    "karst": ["karst-poly", "karst-pts", "springs"],
    "contam": ["mpca-landfill", "mpca-ic", "mpca-gwconcern", "mpca-gwline", "mpca-sites"],
    "trails": ["trails"],
    "bathy": ["bathy"],  # DNR lake bathymetric depth contours (abs_depth, ft)
}
# Layers only tiled (no data/layers snapshot): registered with the snapshot fetcher here
b.LAYERS["bathy"] = ("https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/water_lake_bathymetry/MapServer/0", "objectid,abs_depth,lake_name,dowlknum", None)
# Bump when the tippecanoe options change, so every group is rebuilt once
OPTS_VERSION = "2: no tiny-polygon reduction (small zones stay exact at every zoom; the live check relies on it)"
FRESH = {"bathy", "fema-zones", "fema-xs", "fema-bfe", "fema-lomr", "pwi-basins", "pwi-lines", "tmdl-areas", "imp-lakes", "imp-streams", "rim", "wetbank", "trout", "karst-poly"}
HP = {"offset": 0.00001, "prec": 6}           # ~1 m
HP_OVERRIDE = {"tmdl-areas": {"offset": 0.00003, "prec": 6}, "bathy": {"offset": 0.00002, "prec": 6}}  # allocation areas are whole watersheds; 3 m is plenty

# Stable feature IDs, so the map's live check can tell exactly which FEMA features changed since the build
ID_FIELDS = {"fema-zones": "FLD_AR_ID", "fema-xs": "XS_LN_ID", "fema-bfe": "BFE_LN_ID"}
def fetch_fresh(lid):
    o = dict(b.OPTS.get(lid, {})); o.update(HP_OVERRIDE.get(lid, HP)); b.OPTS[lid] = o
    if lid in ID_FIELDS and ID_FIELDS[lid] not in b.LAYERS[lid][1]:
        url, fields, where = b.LAYERS[lid]; b.LAYERS[lid] = (url, fields + "," + ID_FIELDS[lid], where)
    return b.page(lid)

def load_snapshot(lid):
    d = os.path.join(LAYERS_DIR, lid); idx = json.load(open(os.path.join(d, "index.json"), encoding="utf-8"))
    files = [idx["single"]] if idx.get("single") else [c["f"] for c in idx["cells"]]
    feats = []
    for f in files: feats += json.load(open(os.path.join(d, f), encoding="utf-8"))["features"]
    return feats, idx.get("fetched")

# ---- colours (mirror js/dnrlayers.js decorate() and js/fema.js zoneStyle()) ----
TRAIL_COLORS = {"hike": "#a16207", "bike": "#ea580c", "multi": "#0d9488", "ski": "#2563eb", "motor": "#7c3aed"}
def fema_style(z, sub):
    s = (sub or "").upper(); z = z or ""
    if "FLOODWAY" in s: return "#7f1d1d", 0.55, 0
    if re.fullmatch(r"A|AE|AH|AO|A99|V|VE", z): return "#ef4444", 0.35, 0
    if "0.2 PCT" in s: return "#f59e0b", 0.3, 0
    if "LEVEE" in s: return "#a16207", 0.3, 0
    if z == "D": return "#a3a3a3", 0.25, 0
    return "#9ca3af", 0.08, 1
def paint(lid, p):
    if lid == "fema-zones": p["color"], p["opacity"], p["minimal"] = fema_style(p.get("FLD_ZONE"), p.get("ZONE_SUBTY"))
    elif lid == "fema-xs": p["label"] = p.get("XS_LTR") or ""
    elif lid == "fema-bfe": p["label"] = str(p.get("ELEV", ""))
    elif lid == "pwi-basins": p["color"], p["opacity"] = ("#a3e635" if re.search("wetland", p.get("pwi_label") or "", re.I) else "#38bdf8"), 0.35
    elif lid == "pwi-lines": p["color"] = "#0284c7"
    elif lid == "imp-streams": p["color"] = "#dc2626"
    elif lid == "imp-lakes": p["color"], p["opacity"] = "#f97316", 0.4
    elif lid == "tmdl-areas": p["color"], p["opacity"] = "#a855f7", 0.18
    elif lid == "mpca-sites":
        on = p.get("active") != "N"
        p["color"] = {"cleanup": "#dc2626" if on else "#fca5a5", "waste": "#ea580c" if on else "#fdba74", "permit": "#6366f1" if on else "#c7d2fe"}.get(p.get("cat"), "#6b7280")
    elif lid in ("mpca-gwconcern", "mpca-gwline"): p["color"], p["opacity"] = "#9333ea", 0.22
    elif lid == "mpca-ic": p["color"], p["opacity"] = "#be123c", 0.25
    elif lid == "mpca-landfill": p["color"], p["opacity"] = "#57534e", 0.3
    elif lid == "trails": p["color"] = "#9ca3af" if p.get("access") == "private" else TRAIL_COLORS.get(p.get("cat"), "#a16207")
    elif lid == "rim": p["color"], p["opacity"] = "#16a34a", 0.4
    elif lid == "wetbank": p["color"], p["opacity"] = "#0d9488", 0.4
    elif lid == "trout": p["color"] = "#1d4ed8" if p.get("trout_flag") == 1 else "#60a5fa"
    elif lid == "karst-pts": p["color"] = "#7e22ce"
    elif lid == "springs": p["color"] = "#06b6d4"
    return p

def write_layer(lid, feats, path):
    h = hashlib.sha256(); n = 0
    with open(path, "w", encoding="utf-8") as fh:
        for f in feats:
            if not f.get("geometry"): continue
            p = {k: v for k, v in (f.get("properties") or {}).items() if v is not None and not k.startswith("__")}
            line = json.dumps({"type": "Feature", "geometry": f["geometry"], "properties": paint(lid, p)}, separators=(",", ":"), sort_keys=True)
            fh.write(line + "\n"); h.update(line.encode()); n += 1
    return h.hexdigest(), n

def main(only=None):
    if not shutil.which("tippecanoe"): sys.exit("tippecanoe not found on PATH")
    os.makedirs(TILES, exist_ok=True)
    mpath = os.path.join(TILES, "manifest.json")
    manifest = json.load(open(mpath)) if os.path.exists(mpath) else {"groups": {}}
    work = tempfile.mkdtemp()
    for g, ids in GROUPS.items():
        if only and g not in only: continue
        t0 = time.time(); files, hashes, counts, dates = [], [], {}, []
        try:
            for lid in ids:
                if lid in FRESH: feats, date = fetch_fresh(lid), time.strftime("%Y-%m-%d")
                else: feats, date = load_snapshot(lid)
                path = os.path.join(work, lid + ".geojsonl"); hx, n = write_layer(lid, feats, path)
                files.append((lid, path)); hashes.append(hx); counts[lid] = n; dates.append(date)
                print(f"  {g}/{lid}: {n} features", flush=True)
        except Exception as e:
            print(f"!! {g}: input failed ({e}); keeping the previous tiles", flush=True); continue
        digest = hashlib.sha256((OPTS_VERSION + "".join(hashes)).encode()).hexdigest()
        out = os.path.join(TILES, g + ".pmtiles")
        if manifest["groups"].get(g, {}).get("sha256") == digest and os.path.exists(out):
            print(f"{g}: unchanged, tiles kept", flush=True); manifest["groups"][g]["checked"] = time.strftime("%Y-%m-%d"); continue
        points_only_drop = g == "trails"
        cmd = ["tippecanoe", "-o", out, "--force", "-Z5", "-z14", "-r1", "--detect-shared-borders", "--no-feature-limit", "--no-tiny-polygon-reduction", "-P",
               *(["--drop-densest-as-needed", "--extend-zooms-if-still-dropping"] if points_only_drop else ["--no-tile-size-limit"]),
               "--name", f"Northland Eco {g}", "--attribution", "Northland Eco snapshot of agency data",
               *[a for lid, p in files for a in ("-L", json.dumps({"file": p, "layer": lid}))]]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
        manifest["groups"][g] = {"sha256": digest, "built": time.strftime("%Y-%m-%d"), "fetched": min(d for d in dates if d) if any(dates) else None,
                                 "layers": counts, "bytes": os.path.getsize(out)}
        print(f"{g}: built {os.path.getsize(out) / 1e6:.1f} MB in {time.time() - t0:.0f}s", flush=True)
    json.dump(manifest, open(mpath, "w"), indent=1)
    shutil.rmtree(work, ignore_errors=True)

if __name__ == "__main__":
    main(set(sys.argv[1:]) or None)
