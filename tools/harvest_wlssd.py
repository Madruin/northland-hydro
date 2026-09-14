"""Harvest WLSSD's rainfall overview page (http://extranet.wlssd.com/plantoverview/rain.aspx) into data/wlssd.json.

The page is an ASP.NET form with absolutely positioned spans: gauge names in the header rows (top 15/16/32 px) and
values in rows at top 56 (this hour), 80 (last hour), 104 (today), 128 (yesterday), one column per gauge (left px).
It sends no CORS header and is http-only, so the browser cannot read it; a scheduled GitHub Action runs this script
and commits the JSON, and the site reads the JSON from its own origin.

Kept in the JSON: the latest snapshot per gauge, plus a daily history of "today" totals (the last value seen for each
calendar day, i.e. the day's total once the day has rolled over) capped at 400 days.
"""
import json, os, re, sys, urllib.request
from datetime import datetime, timezone, timedelta

URL = "http://extranet.wlssd.com/plantoverview/rain.aspx"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "wlssd.json")
ROWS = {56: "thisHour", 80: "lastHour", 104: "today", 128: "yesterday"}
# Approximate gauge locations (WLSSD facilities and communities); refine if WLSSD provides coordinates.
SITES = {
    "WLSSD Plant": (-92.1249, 46.7522), "Scanlon": (-92.4268, 46.7050), "Endion": (-92.0705, 46.7960), "Munger Trail": (-92.2010, 46.7230),
    "Wrenshall": (-92.3835, 46.6180), "Pike Lake": (-92.2855, 46.8460), "Rice Lake": (-92.1080, 46.8960), "Proctor": (-92.2250, 46.7470),
    "Hermantown": (-92.2380, 46.8070),
}
CENTRAL = timezone(timedelta(hours=-5))  # WLSSD clock is Central; harvest runs in UTC. CDT until early Nov, then -6.

def parse(html):
    spans = re.findall(r'<span id="([^"]+)" style="([^"]*)"[^>]*>(.*?)</span>', html, re.S)
    cols, vals = {}, {}
    for id_, style, inner in spans:
        text = re.sub(r"<[^>]+>", "", inner).replace("&nbsp;", " ").strip()
        m_left = re.search(r"left:\s*(\d+)px", style); m_top = re.search(r"top:\s*(\d+)px", style)
        if not m_left or not m_top: continue
        left, top = int(m_left.group(1)), int(m_top.group(1))
        if id_.startswith("Label") and top < 50 and left >= 90: cols.setdefault(left, []).append((top, text))
        elif id_.startswith("lblDataVal") and top in ROWS: vals.setdefault(left, {})[ROWS[top]] = text
    gauges = []
    for left in sorted(vals):  # columns without values are page titles, not gauges
        name = " ".join(t for _, t in sorted(cols.get(left, []))) or f"col{left}"
        v = vals[left]
        def num(s):
            if s is None: return None
            s = s.strip(); return None if s in ("", "NV") else float(s)
        gauges.append({"name": name, **{k: num(v.get(k)) for k in ROWS.values()}, "raw": v})
    m = re.search(r"Last Updated:\s*([\d/]+ [\d:]+ [AP]M)", html)
    updated = m.group(1) if m else None
    return gauges, updated

def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "northland-eco-harvester (TSA3)"})
    html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
    gauges, updated = parse(html)
    if not gauges: print("no gauges parsed", file=sys.stderr); sys.exit(1)
    prev = {}
    if os.path.exists(OUT):
        try: prev = json.load(open(OUT, encoding="utf-8"))
        except Exception: prev = {}
    upd = datetime.strptime(updated, "%m/%d/%Y %I:%M:%S %p").replace(tzinfo=CENTRAL) if updated else datetime.now(CENTRAL)
    day = upd.strftime("%Y-%m-%d"); yday = (upd - timedelta(days=1)).strftime("%Y-%m-%d")
    history = prev.get("history", {})
    for g in gauges:
        name = g["name"]
        if g["today"] is not None: history.setdefault(day, {})[name] = g["today"]
        if g["yesterday"] is not None: history.setdefault(yday, {})[name] = g["yesterday"]  # the page's own closed-day total, authoritative
    keep = sorted(history)[-400:]
    history = {d: history[d] for d in keep}
    doc = {"source": URL, "updated": upd.isoformat(), "harvestedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "gauges": [{**g, "lon": SITES.get(g["name"], (None, None))[0], "lat": SITES.get(g["name"], (None, None))[1], "approxLocation": True} for g in gauges],
           "history": history}
    if prev.get("updated") == doc["updated"] and prev.get("history") == history:
        print("unchanged", doc["updated"]); return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(doc, open(OUT, "w", encoding="utf-8"), indent=0)
    print("wrote", OUT, doc["updated"], [(g["name"], g["today"]) for g in gauges])

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1].endswith(".html"):
        g, u = parse(open(sys.argv[1], encoding="utf-8", errors="replace").read()); print(u); [print(x) for x in g]
    else: main()
