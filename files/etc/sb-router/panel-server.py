#!/usr/bin/python3
from router_platform import lan_address
import functools
import pathlib
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT=pathlib.Path('/etc/sb-router/panels')
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):
        pass
    def end_headers(self):
        self.send_header('Referrer-Policy','no-referrer')
        super().end_headers()
    def do_GET(self):
        path=pathlib.Path(self.translate_path(self.path))
        if not path.exists() and '.' not in path.name and 'text/html' in self.headers.get('Accept',''):
            self.path='/index.html'
        super().do_GET()
servers=[]
for name,port in [('yacd',9092),('metacubexd',9093),('zashboard',9094)]:
    path=ROOT/name
    if not (path/'index.html').exists():
        continue
    server=ThreadingHTTPServer((lan_address(),port),functools.partial(Handler,directory=str(path)))
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    servers.append(server)
threading.Event().wait()
