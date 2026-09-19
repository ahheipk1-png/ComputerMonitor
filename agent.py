#!/usr/bin/env python3
"""
ComputerMonitor Local Hardware Agent
Streams real-time CPU, RAM, Disk, and Process stats across your local network (LAN) or VPN.
Runs on port 5500 with CORS enabled for the Cloudflare Pages dashboard.
"""

import http.server
import json
import socketserver
import socket
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


def get_local_ip():
    """Discover primary LAN IP address of this machine."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Doesn't actually send packets, just finds default route interface
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip


class MetricsHandler(http.server.BaseHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS so Cloudflare Pages (or any browser) can query this computer
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
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
            # CPU
            metrics['cpu'] = psutil.cpu_percent(interval=None)
            
            # RAM
            mem = psutil.virtual_memory()
            metrics['ram'] = {
                'total_gb': round(mem.total / (1024 ** 3), 1),
                'used_gb': round(mem.used / (1024 ** 3), 1),
                'free_gb': round(mem.available / (1024 ** 3), 1),
                'percent': mem.percent
            }

            # Storage (Primary drive)
            try:
                root_path = 'C:\\' if platform.system() == 'Windows' else '/'
                disk = psutil.disk_usage(root_path)
                metrics['disk'] = {
                    'total_gb': round(disk.total / (1024 ** 3), 1),
                    'used_gb': round(disk.used / (1024 ** 3), 1),
                    'free_gb': round(disk.free / (1024 ** 3), 1),
                    'percent': disk.percent
                }
            except Exception:
                pass

            # Top Processes by CPU
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
            # Fallback
            metrics['cpu'] = 24.5
            metrics['ram'] = {'total_gb': 16.0, 'used_gb': 7.2, 'free_gb': 8.8, 'percent': 45.0}
            metrics['processes'] = []

        return metrics

    def log_message(self, format, *args):
        # Quiet logger to avoid spamming terminal
        return


import sys
import webbrowser
import threading
import time

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass


def auto_open_browser():
    time.sleep(1.2)
    url = "https://computermonitor.pages.dev?mode=agent"
    print(f"[*] Launching live dashboard in your browser: {url}")
    webbrowser.open(url)


def main():
    lan_ip = get_local_ip()
    print("=" * 65)
    print(" [COMPUTER MONITOR] Hardware Telemetry Agent (Multi-Machine Edition)")
    print("=" * 65)
    print(f"[*] Computer Name : {platform.node()}")
    print(f"[*] Platform      : {platform.system()} {platform.release()} ({platform.machine()})")
    print(f"[*] Localhost URL : http://localhost:{PORT}/metrics")
    print(f"[*] LAN Network IP: http://{lan_ip}:{PORT}/metrics")
    print("-" * 65)
    print(f"[*] To monitor this computer from another device:")
    print(f"    1. Open your Cloudflare website.")
    print(f"    2. Click '+ Add Computer' and paste: http://{lan_ip}:{PORT}/metrics")
    print("    Press Ctrl+C to stop.")
    print("=" * 65)

    # Automatically open the live web dashboard in browser
    threading.Thread(target=auto_open_browser, daemon=True).start()

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), MetricsHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[*] Stopping agent.")


if __name__ == '__main__':
    main()
