"""Precompute a NOAA Atlas 14 precipitation-frequency grid for the TSA3 region.

Atlas 14's PFDS CGI has no CORS header, so the browser cannot query it live.
This script samples it on a regular lat/lon grid once and writes a static JSON
that the site loads. Atlas 14 values are static (Volume 8, 2013), so this only
needs re-running if the region or grid spacing changes.

Usage:  python tools/build_atlas14_grid.py [--step 0.2] [--out data/atlas14_grid.json]
"""
import argparse, json, re, sys, time, urllib.request

URL = ("https://hdsc.nws.noaa.gov/cgi-bin/new/cgi_readH5.py"
       "?lat={lat:.3f}&lon={lon:.3f}&type=pf&data=depth&units=english&series=pds")
DURATIONS = ["5-min","10-min","15-min","30-min","60-min","2-hr","3-hr","6-hr","12-hr",
             "24-hr","2-day","3-day","4-day","7-day","10-day","20-day","30-day","45-day","60-day"]
ARIS = [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000]

def fetch(lat, lon, tries=3):
    req = urllib.request.Request(URL.format(lat=lat, lon=lon),
                                 headers={"User-Agent": "northland-hydro atlas14 grid builder"})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                txt = r.read().decode("utf-8", "replace")
            m = re.search(r"quantiles\s*=\s*(\[\[.*?\]\]);", txt, re.S)
            if not m:
                return None
            rows = json.loads(m.group(1).replace("'", '"'))
            return [[float(v) for v in row] for row in rows]
        except Exception as e:  # noqa
            time.sleep(2 * (i + 1))
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", type=float, default=0.2)
    ap.add_argument("--bbox", default="-94.4,45.4,-89.2,48.8")  # W,S,E,N
    ap.add_argument("--out", default="data/atlas14_grid.json")
    a = ap.parse_args()
    w, s, e, n = [float(x) for x in a.bbox.split(",")]
    lats, lons = [], []
    y = s
    while y <= n + 1e-9:
        lats.append(round(y, 3)); y += a.step
    x = w
    while x <= e + 1e-9:
        lons.append(round(x, 3)); x += a.step
    out = {"source": "NOAA Atlas 14 Volume 8 (PDS-based depth, inches)",
           "url": "https://hdsc.nws.noaa.gov/pfds/",
           "step": a.step, "lats": lats, "lons": lons,
           "durations": DURATIONS, "aris": ARIS, "grid": {}}
    total = len(lats) * len(lons); k = 0; miss = 0
    for lat in lats:
        for lon in lons:
            k += 1
            q = fetch(lat, lon)
            if q is None:
                miss += 1
            else:
                out["grid"][f"{lat:.3f},{lon:.3f}"] = q
            if k % 25 == 0:
                print(f"{k}/{total} done, {miss} missing", flush=True)
            time.sleep(0.4)
    with open(a.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {a.out}: {len(out['grid'])} points, {miss} missing")

if __name__ == "__main__":
    main()
