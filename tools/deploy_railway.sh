#!/usr/bin/env bash
# Deploy Northland Eco to Railway (project "northland-eco", service "web"), independent of GitHub.
# Copies the site files from this repo into the Docker build folder and uploads it; Railway builds the
# Caddy image (Dockerfile + Caddyfile in the build folder) and serves northland.eco and www.northland.eco.
#   bash tools/deploy_railway.sh        (run python tools/stamp_version.py first, as for any release)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="${NORTHLAND_BUILD_DIR:-$HOME/Desktop/northland-eco-site}"
[ -f "$BUILD/Dockerfile" ] || { echo "no Dockerfile in $BUILD"; exit 1; }
rm -rf "$BUILD/site"; mkdir -p "$BUILD/site"
for f in index.html report.html manifest.webmanifest version.json LICENSE assets css data js; do cp -r "$REPO/$f" "$BUILD/site/"; done
cd "$BUILD"
railway up --service web --detach
echo "Uploaded. Build progress: railway deployment list --service web"
