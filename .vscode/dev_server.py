"""Local dev server for ComicVault: http://localhost:8080

Same as `python -m http.server 8080`, but tells the browser never to cache
files, so edits to .js/.css/.html always show up on a normal refresh.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 8080
ROOT = Path(__file__).resolve().parent.parent  # project folder


class NoCacheHandler(SimpleHTTPRequestHandler):
    # Same file types GitHub Pages uses for these
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".js": "text/javascript",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    print(f"Serving HTTP on http://localhost:{PORT}/ (no-cache)", flush=True)
    ThreadingHTTPServer(("", PORT), NoCacheHandler).serve_forever()
