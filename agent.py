#!/usr/bin/env python3
"""
ComputerMonitor Local Hardware Agent
Streams real-time CPU, RAM, Disk, and Process stats to the web dashboard.
Runs an HTTP server on port 5500 with CORS headers enabled.
"""

import http.server
import json
import socketserver
import platform
import os

PORT = 5500

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False
    print("[*] Notice: 'psutil' package is not installed. Using fallback telemetry.")
    print("    To get accurate hardware stats, run: pip install psutil\n")


class MetricsHandler(http.server.BaseHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS so the Cloudflare Pages web app can read local metrics
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Type', 'application/json')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == '/metrics' or self.path == '/':
            self.send_response(200)
            self.end_headers()
            
            data = self.gather_metrics()
            self.wfile.write(json.dumps(data).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

    def gather_metrics(self):
        metrics = {
            'hostname': platform.node(),
            'os': f"{platform.system()} {platform.release()}",
            'arch': platform.machine(),
        }

        if HAS_PSUTIL:
            # Real CPU
            metrics['cpu'] = psutil.cpu_percent(interval=None)
            
            # Real RAM
            mem = psutil.virtual_memory()
            metrics['ram'] = {
                'total_gb': round(mem.total / (1024 ** 3), 1),
                'used_gb': round(mem.used / (1024 ** 3), 1),
                'free_gb': round(mem.available / (1024 ** 3), 1),
                'percent': mem.percent
            }

            # Top Processes
            procs = []
            for p in sorted(psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_info']),
                            key=lambda x: (x.info.get('cpu_percent') or 0), reverse=True)[:10]:
                try:
                    mem_mb = round((p.info['memory_info'].rss or 0) / (1024 * 1024), 1)
                    procs.append({
                        'pid': p.info['pid'],
                        'name': p.info['name'] or 'Process',
                        'cpu': round(p.info['cpu_percent'] or 0.0, 1),
                        'mem': mem_mb,
                        'io': 'Active',
                        'status': 'running'
                    })
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
            metrics['processes'] = procs
        else:
            # Basic fallback
            metrics['cpu'] = 25.0
            metrics['ram'] = {'total_gb': 16.0, 'used_gb': 7.4, 'free_gb': 8.6, 'percent': 46.2}
            metrics['processes'] = []

        return metrics

    def log_message(self, format, *args):
        # Quiet logger to avoid spamming the console every second
        return


def main():
    print("=" * 60)
    print(" 🖥️  ComputerMonitor Hardware Agent")
    print("=" * 60)
    print(f"[*] Running agent server on http://localhost:{PORT}")
    print(f"[*] Host: {platform.node()} ({platform.system()} {platform.release()})")
    print(f"[*] Ready! Open your ComputerMonitor web dashboard and toggle 'Local Agent (Live)'.")
    print("    Press Ctrl+C to stop.")
    print("=" * 60)

    # Allow fast address reuse
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), MetricsHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[*] Shutting down agent.")


if __name__ == '__main__':
    main()
