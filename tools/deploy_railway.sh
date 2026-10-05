#!/usr/bin/env bash
# Deploy Northland Eco to Railway (project "northland-eco", service "web"), independent of GitHub.
# Assembles the Docker build folder from this repo (deploy/railway/* + site files + tools) and uploads it.
# Railway builds the image: Caddy serves the site, supercronic runs the data jobs (see deploy/railway/).
#   bash tools/deploy_railway.sh        (run python tools/stamp_version.py first, as for any release)
# Job outputs on the volume (/vol/data) win over the data in the image. To push locally rebuilt layers or tiles,
# deploy, then set RESEED=1 on the service for one restart (railway variables --set RESEED=1), then remove it.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="${NORTHLAND_BUILD_DIR:-$HOME/Desktop/northland-eco-site}"   # this folder is linked to the Railway project
mkdir -p "$BUILD"; cd "$BUILD"
rm -rf site tools Dockerfile Caddyfile entrypoint.sh run_job.sh crontab
cp "$REPO"/deploy/railway/* .
mkdir site; for f in index.html report.html manifest.webmanifest version.json LICENSE assets css data js; do cp -r "$REPO/$f" site/; done
mkdir tools; cp "$REPO"/tools/*.py tools/
railway up --service web --detach
echo "Uploaded. Build progress: railway deployment list --service web"
