"""Local preview server: serves the site like `python -m http.server` and passes /api/daymet/data through to ORNL,
the same as the Caddy route on Railway (deploy/railway/Caddyfile), and answers byte-range requests (PMTiles).
Usage: python tools/dev_server.py [port] [dir]"""
import http.server, sys, urllib.request, urllib.parse, os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        if u.path == "/api/daymet/data":
            try:
                with urllib.request.urlopen("https://daymet.ornl.gov/single-pixel/api/data?" + u.query, timeout=60) as r:
                    body = r.read(); self.send_response(r.status); self.send_header("Content-Type", r.headers.get("Content-Type", "text/csv"))
            except urllib.error.HTTPError as e:
                body = e.read(); self.send_response(e.code); self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
        rng = self.headers.get("Range")
        fpath = self.translate_path(u.path)
        if rng and rng.startswith("bytes=") and os.path.isfile(fpath): # PMTiles reads byte ranges
            size = os.path.getsize(fpath); a, _, b = rng[6:].split(",")[0].partition("-")
            start = int(a) if a else max(0, size - int(b)); end = min(size - 1, int(b)) if a and b else size - 1
            with open(fpath, "rb") as f: f.seek(start); body = f.read(end - start + 1)
            self.send_response(206); self.send_header("Content-Type", self.guess_type(fpath)); self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
        super().do_GET()

if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
