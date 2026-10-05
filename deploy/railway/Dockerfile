# Northland Eco on Railway: Caddy serves the static site; supercronic runs the data jobs that used to be
# GitHub Actions (WLSSD hourly, layer snapshots + vector tiles monthly, freshness check monthly).
# Job outputs live on the Railway volume mounted at /vol and are served in preference to the copies baked in here.

# tippecanoe (vector tiles), built from the public source tag
FROM debian:bookworm-slim AS tippecanoe
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libsqlite3-dev zlib1g-dev git ca-certificates \
 && git clone --depth 1 --branch 2.79.0 https://github.com/felt/tippecanoe.git /tc && make -C /tc -j4 tippecanoe

FROM caddy:2 AS caddy

FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libsqlite3-0 zlib1g libstdc++6 rsync util-linux \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /usr/local/bin/supercronic https://github.com/aptible/supercronic/releases/download/v0.2.33/supercronic-linux-amd64 \
 && chmod +x /usr/local/bin/supercronic
COPY --from=tippecanoe /tc/tippecanoe /usr/local/bin/tippecanoe
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && tippecanoe --version
COPY site /srv
COPY tools /app/tools
COPY entrypoint.sh run_job.sh crontab /app/
# files edited on Windows may carry CRLF line endings, which break sh and cron
RUN sed -i 's/\r$//' /app/entrypoint.sh /app/run_job.sh /app/crontab && chmod +x /app/entrypoint.sh /app/run_job.sh
ENV TZ=UTC PYTHONUNBUFFERED=1
CMD ["/app/entrypoint.sh"]
