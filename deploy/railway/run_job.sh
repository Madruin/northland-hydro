#!/bin/sh
# Run one data job in a scratch copy of the data, check the result, then swap it into the live volume.
#   /app/run_job.sh wlssd | snapshots | tiles | freshness
# A failed or implausible run leaves the live data untouched (the GitHub jobs only committed when sane).
set -eu
JOB="$1"; LIVE=/vol/data; WORK="/tmp/job-$JOB"
exec 9>"/tmp/job-$JOB.lock"; flock -n 9 || { echo "[$JOB] already running"; exit 0; }
log() { echo "[$JOB $(date -u +%Y-%m-%dT%H:%MZ)] $*"; }
rm -rf "$WORK"; mkdir -p "$WORK/data"; cp -r /app/tools "$WORK/tools"; cd "$WORK"
# swap a directory into place atomically-ish (rename), keeping the old one until the new is in
swapdir() { rm -rf "$LIVE/$1.old"; [ -e "$LIVE/$1" ] && mv "$LIVE/$1" "$LIVE/$1.old"; mv "$WORK/data/$1" "$LIVE/$1"; rm -rf "$LIVE/$1.old"; }
putfile() { cp "$WORK/data/$1" "$LIVE/$1.tmp" && mv "$LIVE/$1.tmp" "$LIVE/$1"; }

case "$JOB" in
  wlssd)
    [ -f "$LIVE/wlssd.json" ] && cp "$LIVE/wlssd.json" data/
    python tools/harvest_wlssd.py
    putfile wlssd.json; log "updated" ;;
  snapshots)
    cp -a /srv/data/. data/; cp -a "$LIVE/." data/ 2>/dev/null || true
    python tools/build_static_layers.py
    python tools/build_huc_lines.py || log "watershed lines failed; the map falls back to polygon outlines"
    python tools/build_mpca.py
    python tools/build_trails.py || log "trails build failed; keeping last month's trails"
    total=$(du -sm data/layers | cut -f1); log "snapshot size ${total} MB"
    [ "$total" -le 250 ] || { log "snapshot unexpectedly large, not swapping in"; exit 1; }
    for d in data/layers/*/; do [ -f "$d/index.json" ] || { log "missing index in $d"; exit 1; }; done
    swapdir layers; log "layers swapped in"
    cd /; rm -rf "$WORK"; exec /app/run_job.sh tiles ;;
  tiles)
    mkdir -p data/layers; cp -a "$LIVE/layers/." data/layers/; mkdir -p data/tiles; cp -a "$LIVE/tiles/." data/tiles/ 2>/dev/null || true
    python tools/build_tiles.py ${GROUPS:-}
    total=$(du -sm data/tiles | cut -f1); log "tiles size ${total} MB"
    [ "$total" -le 300 ] || { log "tiles unexpectedly large, not swapping in"; exit 1; }
    swapdir tiles; log "tiles swapped in" ;;
  freshness)
    cp -a /srv/data/. data/; cp -a "$LIVE/." data/ 2>/dev/null || true
    python tools/check_freshness.py || log "freshness flagged something; see above and data/freshness.json"
    putfile freshness.json; log "updated" ;;
  *) echo "unknown job $JOB"; exit 2 ;;
esac
rm -rf "$WORK"
