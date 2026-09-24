#!/usr/bin/env python3
"""Render the real frontend with synthetic data; never contacts the monitoring server."""
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright
from demo_data import dataset

ROOT = Path(__file__).resolve().parent.parent


def main():
    data = dataset()
    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_GET(self):
            url = urlparse(self.path)
            if url.path == '/':
                self.path = '/static/index.html'
            if url.path.startswith('/api/'):
                query = parse_qs(url.query)
                if url.path == '/api/history':
                    result = data['history'](int(query['start'][0]), int(query['end'][0]))
                elif url.path == '/api/disk-history':
                    result = {'scans': data['scans']}
                elif url.path == '/api/events':
                    result = {'events': data['events']}
                elif url.path in ('/api/live', '/api/hardware'):
                    result = data[url.path.split('/')[-1]]
                else:
                    self.send_error(404)
                    return
                body = json.dumps(result).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                super().do_GET()
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    output = ROOT / 'docs/assets'
    output.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=['--no-sandbox'])
            page = browser.new_page(viewport={'width':1440,'height':1060}, device_scale_factor=1)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            origin = f'http://127.0.0.1:{server.server_port}'
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(origin + '/') else route.abort())
            page.goto(origin, wait_until='networkidle')
            page.wait_for_function("() => state.charts.size===8 && state.hardware?.collected_at")
            page.evaluate("document.querySelector('.live-tag').textContent='DEMO'; document.querySelector('.workspace-label').textContent='SYNTHETIC DEMO DATA'")
            overview=page.locator('#overview').bounding_box()
            page.set_viewport_size({'width':1440,'height':int(overview['y']+overview['height']+24)})
            page.screenshot(path=str(output / 'overview.png'))
            page.add_style_tag(content='.topbar{visibility:hidden!important}')
            page.locator('#storage').screenshot(path=str(output / 'storage.png'))
            page.locator('#power').screenshot(path=str(output / 'power.png'))
            page.locator('a[href="#hardware"]').click()
            page.locator('#hardware-details').screenshot(path=str(output / 'hardware.png'))
            page.evaluate("""()=>{
                window.originalDemoHardware=state.hardware;
                const example=structuredClone(state.hardware);
                example.system['Product name']='Example four-socket server';
                example.board.Model='Example quad-socket board';
                example.cpu['Socket(s)']='3';example.cpu['CPU(s)']='48';
                example.memory.slots=32;example.memory.empty_slots=16;example.memory.total_bytes=256*1024**3;
                example.memory.modules=Array.from({length:16},(_,i)=>({Locator:'DIMM '+(i+1),'Part Number':'DEMO-DDR4-16G',Size:'16 GB',Type:'DDR4'}));
                example.firmware_records=[
                    ...Array.from({length:4},(_,i)=>({type:4,fields:{'Socket Designation':'CPU'+(i+1),Version:i===3?'Not Specified':'Example 8-Core Processor',Status:i===3?'Unpopulated':'Populated, Enabled','Core Count':i===3?'Unknown':'8','Thread Count':i===3?'Unknown':'16'}})),
                    ...example.memory.modules.map(fields=>({type:17,fields})),
                    ...Array.from({length:16},(_,i)=>({type:17,fields:{Locator:'DIMM '+(i+17),Size:'No Module Installed'}}))];
                state.hardware=example;HardwareUI.render(example,{esc,bytes,date});
            }""")
            page.locator('#hardware-details').screenshot(path=str(output / 'hardware-four-socket.png'))
            page.evaluate('state.hardware=window.originalDemoHardware;HardwareUI.render(state.hardware,{esc,bytes,date})')
            page.add_style_tag(content='.topbar{visibility:visible!important}')
            page.set_viewport_size({'width':390,'height':1100})
            page.evaluate("I18n.setLanguage('zh'); scrollTo(0,0)")
            page.screenshot(path=str(output / 'mobile-zh.png'))
            assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print('Rendered six screenshots from synthetic data only; no real monitoring endpoint was accessed.')


if __name__ == '__main__':
    main()
