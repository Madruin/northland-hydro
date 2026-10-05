#!/bin/sh
# Seed the volume with the data baked into this image (first start, or RESEED=1 to push locally rebuilt data),
# then run the job scheduler alongside the web server.
set -e
mkdir -p /vol/data
for p in wlssd.json freshness.json layers tiles; do
  if [ "${RESEED:-0}" = "1" ] || [ ! -e "/vol/data/$p" ]; then
    echo "seed: /vol/data/$p from the image"
    rm -rf "/vol/data/$p.seed" && cp -a "/srv/data/$p" "/vol/data/$p.seed"
    rm -rf "/vol/data/$p" && mv "/vol/data/$p.seed" "/vol/data/$p"
  fi
done
supercronic -passthrough-logs /app/crontab &
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
