"""Serves the control page at http://localhost:8765.

Browsers are told not to cache anything, so a refresh always shows the latest
version. It only listens on this PC (127.0.0.1), not the network.
"""
import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
HERE = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(NoCacheHandler, directory=HERE)
    print(f"Trading Office on http://localhost:{PORT}  (close this window to stop it)")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler).serve_forever()
