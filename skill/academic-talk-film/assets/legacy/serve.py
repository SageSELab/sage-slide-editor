#!/usr/bin/env python3
"""Serve the talk locally and save in-page text edits straight into index.html.

    python3 serve.py            # http://localhost:8765/  (opens in your browser)
    python3 serve.py 9000       # another port

With the deck open through this server, pressing E to edit and then ⌘S writes the
edits into index.html with no file dialog. Chrome does not allow a page opened from
disk (file://) to write files, which is why the deck falls back to a download there.
The previous index.html is kept as index.html.bak.
"""
import http.server
import json
import os
import re
import shutil
import socketserver
import sys
import threading
import time
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
BLOCK = re.compile(r'(<script type="application/json" id="text-overrides">)[\s\S]*?(</script>)')


def write_overrides(overrides):
    path = os.path.join(HERE, 'index.html')
    with open(path, encoding='utf-8') as f:
        src = f.read()
    if not BLOCK.search(src):
        raise ValueError('overrides block not found in index.html')
    body = json.dumps(overrides, indent=1, ensure_ascii=False).replace('</', '<\\/')
    out = BLOCK.sub(lambda m: m.group(1) + '\n' + body + '\n' + m.group(2), src, count=1)
    shutil.copy2(path, path + '.bak')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(out)


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path.split('?')[0] != '/save':
            return self.send_error(404)
        try:
            n = int(self.headers.get('Content-Length') or 0)
            overrides = json.loads(self.rfile.read(n).decode('utf-8'))
            if not isinstance(overrides, dict) or 'text' not in overrides:
                raise ValueError('bad payload')
            write_overrides(overrides)
            self.reply(200, {'ok': True, 'saved': time.strftime('%H:%M:%S')})
            sys.stderr.write('saved index.html at %s\n' % time.strftime('%H:%M:%S'))
        except Exception as e:  # report to the page instead of dying
            self.reply(500, {'ok': False, 'error': str(e)})

    def reply(self, code, obj):
        data = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        http.server.SimpleHTTPRequestHandler.end_headers(self)

    def log_message(self, fmt, *args):
        pass  # quiet; saves are reported above


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    os.chdir(HERE)
    url = 'http://localhost:%d/' % PORT
    srv = Server(('127.0.0.1', PORT), Handler)
    print('talk at %s  (E to edit, ⌘S saves into index.html, Ctrl-C to stop)' % url)
    if '--no-open' not in sys.argv:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
