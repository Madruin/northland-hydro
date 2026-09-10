"""Stamp a build id into js/config.js and write version.json listing every asset.

Run before each commit (python tools/stamp_version.py). At runtime app.js fetches version.json with
cache: "no-store"; if its build differs from the one compiled into config.js, the page refetches every
listed asset bypassing the cache and reloads once. This defeats GitHub Pages' 10-minute asset cache
without a build step or service worker.
"""
import json, os, re, subprocess, datetime

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(root)
try:
    sha = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
except Exception:
    sha = "nogit"
build = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M") + "-" + sha

files = []
for d, _, names in os.walk(root):
    rel = os.path.relpath(d, root).replace("\\", "/")
    if rel.startswith((".git", "tools", "data")) or rel == ".":
        if rel != ".":
            continue
    for n in names:
        if n.endswith((".js", ".css", ".html")) and not n.startswith("."):
            p = (n if rel == "." else f"{rel}/{n}")
            if not p.startswith(("tools/", "data/")):
                files.append(p)
files.sort()

cfg_path = "js/config.js"
cfg = open(cfg_path, encoding="utf-8").read()
if re.search(r'build:\s*"[^"]*"', cfg):
    cfg = re.sub(r'build:\s*"[^"]*"', f'build: "{build}"', cfg)
else:
    cfg = cfg.replace('version: "0.1.0",', f'version: "0.1.0",\n  build: "{build}",')
open(cfg_path, "w", encoding="utf-8").write(cfg)
json.dump({"build": build, "files": files}, open("version.json", "w", encoding="utf-8"), indent=1)
print("build", build, "|", len(files), "assets")
