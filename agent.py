#!/usr/bin/env python3
"""
ComputerMonitor High-Performance Hardware Agent
Asynchronous background telemetry collector with instant sub-millisecond HTTP responses.
Runs on port 5500 with CORS and Private Network Access enabled.
"""

import http.server
import json
import socket
import platform
import os
import sys
import webbrowser
import threading
import time

PORT = 5500

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

# Global thread-safe metrics cache
LATEST_METRICS = {
    'hostname': platform.node(),
    'os': f"{platform.system()} {platform.release()}",
    'arch': platform.machine(),
    'cpu': 0,
    'cores': [],
    'cpu_count': 0,
    'uptime': 0,
    'ram': {'total_gb': 0, 'used_gb': 0, 'free_gb': 0, 'percent': 0},
    'disk': {'total_gb': 0, 'used_gb': 0, 'free_gb': 0, 'percent': 0},
    'net': {'bytes_sent': 0, 'bytes_recv': 0},
    'processes': []
}
METRICS_LOCK = threading.Lock()


def get_local_ip():
    """Discover primary LAN IP address of this machine."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip


def background_metrics_collector():
    """Runs in background thread to keep LATEST_METRICS updated without slowing down HTTP responses."""
    global LATEST_METRICS
    while True:
        try:
            m = {
                'hostname': platform.node(),
                'os': f"{platform.system()} {platform.release()}",
                'arch': platform.machine(),
            }

            if HAS_PSUTIL:
                # Real CPU
                m['cpu'] = psutil.cpu_percent(interval=None)
                m['cores'] = psutil.cpu_percent(percpu=True)
                m['cpu_count'] = psutil.cpu_count(logical=True) or len(m['cores'])

                try:
                    freq = psutil.cpu_freq()
                    if freq and freq.current:
                        m['cpu_freq'] = f"{round(freq.current / 1000, 2)} GHz" if freq.current > 1000 else f"{round(freq.current, 0)} MHz"
                except Exception:
                    pass

                # Uptime
                try:
                    m['uptime'] = int(time.time() - psutil.boot_time())
                except Exception:
                    m['uptime'] = 0

                # RAM
                mem = psutil.virtual_memory()
                m['ram'] = {
                    'total_gb': round(mem.total / (1024 ** 3), 1),
                    'used_gb': round(mem.used / (1024 ** 3), 1),
                    'free_gb': round(mem.available / (1024 ** 3), 1),
                    'percent': mem.percent
                }

                # Storage (Primary drive)
                try:
                    root_path = 'C:\\' if platform.system() == 'Windows' else '/'
                    disk = psutil.disk_usage(root_path)
                    m['disk'] = {
                        'total_gb': round(disk.total / (1024 ** 3), 1),
                        'used_gb': round(disk.used / (1024 ** 3), 1),
                        'free_gb': round(disk.free / (1024 ** 3), 1),
                        'percent': disk.percent
                    }
                except Exception:
                    pass

                # Network counters
                try:
                    net = psutil.net_io_counters()
                    m['net'] = {
                        'bytes_sent': net.bytes_sent,
                        'bytes_recv': net.bytes_recv,
                    }
                except Exception:
                    pass

                # Top Processes (limit to 12 to keep payload nimble)
                procs = []
                for p in sorted(psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_info', 'status']),
                                key=lambda x: (x.info.get('cpu_percent') or 0), reverse=True)[:12]:
                    try:
                        mem_mb = round((p.info['memory_info'].rss or 0) / (1024 * 1024), 1)
                        procs.append({
                            'pid': p.info['pid'],
                            'name': p.info['name'] or 'Process',
                            'cpu': round(p.info['cpu_percent'] or 0.0, 1),
                            'mem': mem_mb,
                            'io': 'Active',
                            'status': p.info.get('status') or 'running'
                        })
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        continue
                m['processes'] = procs
            else:
                m['cpu'] = 0
                m['ram'] = {'total_gb': 0, 'used_gb': 0, 'free_gb': 0, 'percent': 0}
                m['processes'] = []

            with METRICS_LOCK:
                LATEST_METRICS = m

        except Exception:
            pass

        time.sleep(1.0)


class MetricsHandler(http.server.BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Content-Type', 'application/json')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == '/metrics' or self.path == '/':
            try:
                with METRICS_LOCK:
                    payload = json.dumps(LATEST_METRICS).encode('utf-8')

                self.send_response(200)
                self.end_headers()
                self.wfile.write(payload)
            except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                pass
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Quiet logger so console stays clean
        return


class QuietThreadingHTTPServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        # Suppress disconnect tracebacks
        pass


def auto_open_browser():
    time.sleep(1.2)
    url = "https://computermonitor.pages.dev"
    print(f"[*] Launching live dashboard in your browser: {url}")
    webbrowser.open(url)


def main():
    lan_ip = get_local_ip()
    print("=" * 65)
    print(" [COMPUTER MONITOR] Real-Time Hardware Agent")
    print("=" * 65)
    print(f"[*] Computer Name : {platform.node()}")
    print(f"[*] Platform      : {platform.system()} {platform.release()} ({platform.machine()})")
    print(f"[*] Localhost URL : http://localhost:{PORT}/metrics")
    print(f"[*] LAN Network IP: http://{lan_ip}:{PORT}/metrics")
    print("-" * 65)
    print(f"[*] Agent server active! Streaming live metrics to your dashboard.")
    print("    Press Ctrl+C in this window to stop.")
    print("=" * 65)

    # Start background metric collector
    collector = threading.Thread(target=background_metrics_collector, daemon=True)
    collector.start()

    # Automatically open the web dashboard in browser (unless --background or --no-browser flag is passed)
    if '--background' not in sys.argv and '--no-browser' not in sys.argv:
        threading.Thread(target=auto_open_browser, daemon=True).start()

    server = QuietThreadingHTTPServer(("", PORT), MetricsHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Stopping agent.")
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
