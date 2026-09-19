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

# Critical Windows Kernel processes protected from accidental termination (BSOD prevention)
PROTECTED_PROCESSES = {
    'system', 'system idle process', 'registry', 'smss.exe', 'csrss.exe',
    'wininit.exe', 'services.exe', 'lsass.exe', 'svchost.exe', 'fontdrvhost.exe',
    'winlogon.exe', 'dwm.exe'
}

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


import subprocess

def check_task_scheduler():
    if sys.platform != 'win32':
        return {"installed": True, "status": "Non-Windows OS"}
    try:
        creationflags = 0x08000000 # CREATE_NO_WINDOW
        out = subprocess.run(['schtasks', '/query', '/tn', 'ComputerMonitorAgent', '/fo', 'list'],
                             capture_output=True, text=True, timeout=2, creationflags=creationflags)
        if out.returncode == 0:
            status = "Ready / Running"
            for line in out.stdout.splitlines():
                if "Status:" in line:
                    status = line.split(":", 1)[1].strip()
            return {"installed": True, "status": status}
        return {"installed": False, "status": "Task Not Found / Deleted"}
    except Exception:
        return {"installed": False, "status": "Unavailable"}


def background_metrics_collector():
    """Runs in background thread with minimal CPU footprint (<0.2%)."""
    global LATEST_METRICS
    cycle = 0
    cached_sched = {"installed": True, "status": "Checking..."}
    cached_procs = []
    num_cpus = psutil.cpu_count(logical=True) or 1 if HAS_PSUTIL else 1

    while True:
        try:
            # 1. Update Task Scheduler check only every 20 seconds (saves subprocess overhead)
            if cycle % 20 == 0:
                cached_sched = check_task_scheduler()

            m = {
                'hostname': platform.node(),
                'os': f"{platform.system()} {platform.release()}",
                'arch': platform.machine(),
                'task_scheduler': cached_sched,
            }

            if HAS_PSUTIL:
                # Real CPU (System-wide, ~1ms)
                m['cpu'] = psutil.cpu_percent(interval=None)
                m['cores'] = psutil.cpu_percent(percpu=True)
                m['cpu_count'] = num_cpus

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

                # 2. Update Top Processes every 3.0 seconds (saves 90% CPU)
                # Omit 'status' query to prevent Windows kernel locks
                # Exclude System Idle Process (PID 0)
                # Normalize CPU% across logical cores (0-100% total system scale)
                if cycle % 3 == 0 or not cached_procs:
                    procs = []
                    for p in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_info']):
                        try:
                            pid = p.info['pid']
                            name = p.info['name'] or 'Process'
                            # Exclude PID 0 / Idle Process
                            if pid == 0 or name.lower() in ('system idle process', 'idle'):
                                continue
                            raw_cpu = p.info.get('cpu_percent') or 0.0
                            # Normalize by total logical CPUs like Windows Task Manager
                            norm_cpu = round(raw_cpu / num_cpus, 1)
                            mem_mb = round((p.info['memory_info'].rss or 0) / (1024 * 1024), 1)
                            procs.append({
                                'pid': pid,
                                'name': name,
                                'cpu': norm_cpu,
                                'mem': mem_mb,
                                'io': 'Active',
                                'status': 'running'
                            })
                        except (psutil.NoSuchProcess, psutil.AccessDenied):
                            continue

                    # Sort by CPU descending, top 12
                    cached_procs = sorted(procs, key=lambda x: x['cpu'], reverse=True)[:12]

                m['processes'] = cached_procs
            else:
                m['cpu'] = 0
                m['ram'] = {'total_gb': 0, 'used_gb': 0, 'free_gb': 0, 'percent': 0}
                m['processes'] = []

            with METRICS_LOCK:
                LATEST_METRICS = m

        except Exception:
            pass

        cycle += 1
        time.sleep(1.0)


class MetricsHandler(http.server.BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Content-Type', 'application/json')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        if self.path == '/kill':
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length).decode('utf-8')
                data = json.loads(body) if body else {}

                pid = data.get('pid')
                proc_name = data.get('name')

                if not HAS_PSUTIL:
                    self.send_response(500)
                    self.end_headers()
                    self.wfile.write(json.dumps({'success': False, 'error': 'psutil not installed on agent'}).encode('utf-8'))
                    return

                # Option 1: Stop by PID
                if pid is not None:
                    try:
                        pid = int(pid)
                    except ValueError:
                        self.send_response(400)
                        self.end_headers()
                        self.wfile.write(json.dumps({'success': False, 'error': 'Invalid PID'}).encode('utf-8'))
                        return

                    if pid in (0, 4):
                        self.send_response(200)
                        self.end_headers()
                        self.wfile.write(json.dumps({'success': False, 'error': 'Cannot terminate Windows system kernel (PID 0 or 4)'}).encode('utf-8'))
                        return

                    if pid == os.getpid():
                        self.send_response(200)
                        self.end_headers()
                        self.wfile.write(json.dumps({'success': True, 'message': 'ComputerMonitorAgent stopped successfully'}).encode('utf-8'))
                        self.wfile.flush()
                        threading.Thread(target=lambda: (time.sleep(0.3), os._exit(0)), daemon=True).start()
                        return

                    try:
                        p = psutil.Process(pid)
                        name = p.name()
                        if name.lower() in PROTECTED_PROCESSES:
                            self.send_response(200)
                            self.end_headers()
                            self.wfile.write(json.dumps({'success': False, 'error': f"Terminating critical OS process '{name}' is protected"}).encode('utf-8'))
                            return

                        if name.lower() in ('computermonitoragent.exe', 'computermonitoragent'):
                            self.send_response(200)
                            self.end_headers()
                            self.wfile.write(json.dumps({'success': True, 'message': f"Process '{name}' (PID {pid}) stopped successfully"}).encode('utf-8'))
                            self.wfile.flush()
                            threading.Thread(target=lambda: (time.sleep(0.3), p.terminate(), os._exit(0)), daemon=True).start()
                            return

                        p.terminate()
                        try:
                            p.wait(timeout=1.0)
                        except psutil.TimeoutExpired:
                            p.kill()

                        self.send_response(200)
                        self.end_headers()
                        self.wfile.write(json.dumps({'success': True, 'message': f"Process '{name}' (PID {pid}) stopped successfully"}).encode('utf-8'))
                        return
                    except psutil.NoSuchProcess:
                        self.send_response(200)
                        self.end_headers()
                        self.wfile.write(json.dumps({'success': False, 'error': f"Process with PID {pid} not found (already stopped)"}).encode('utf-8'))
                        return
                    except psutil.AccessDenied:
                        self.send_response(200)
                        self.end_headers()
                        self.wfile.write(json.dumps({'success': False, 'error': f"Access denied stopping PID {pid}. Elevated permissions required."}).encode('utf-8'))
                        return

                # Option 2: Stop by process name
                elif proc_name:
                    target_name = proc_name.strip().lower()
                    if target_name in PROTECTED_PROCESSES:
                        self.send_response(200)
                        self.end_headers()
                        self.wfile.write(json.dumps({'success': False, 'error': f"Process '{proc_name}' is a protected Windows system process"}).encode('utf-8'))
                        return

                    if target_name in ('computermonitoragent', 'computermonitoragent.exe'):
                        self.send_response(200)
                        self.end_headers()
                        self.wfile.write(json.dumps({'success': True, 'message': 'ComputerMonitorAgent stopped successfully'}).encode('utf-8'))
                        self.wfile.flush()
                        threading.Thread(target=lambda: (time.sleep(0.3), os._exit(0)), daemon=True).start()
                        return

                    killed = []
                    failed = []
                    for p in psutil.process_iter(['pid', 'name']):
                        try:
                            pname = (p.info['name'] or '').lower()
                            if pname == target_name or pname == f"{target_name}.exe":
                                if p.info['pid'] not in (0, 4) and p.info['pid'] != os.getpid():
                                    proc_obj = psutil.Process(p.info['pid'])
                                    proc_obj.terminate()
                                    try:
                                        proc_obj.wait(timeout=0.8)
                                    except psutil.TimeoutExpired:
                                        proc_obj.kill()
                                    killed.append(p.info['pid'])
                        except (psutil.NoSuchProcess, psutil.AccessDenied) as err:
                            failed.append(str(err))

                    if killed:
                        self.send_response(200)
                        self.end_headers()
                        self.wfile.write(json.dumps({'success': True, 'message': f"Stopped {len(killed)} process(es) matching '{proc_name}' (PIDs: {', '.join(map(str, killed))})"}).encode('utf-8'))
                    else:
                        self.send_response(200)
                        self.end_headers()
                        self.wfile.write(json.dumps({'success': False, 'error': f"No running processes found matching '{proc_name}'"}).encode('utf-8'))
                    return

                else:
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(json.dumps({'success': False, 'error': 'Must provide either "pid" or "name" in JSON payload'}).encode('utf-8'))
                    return

            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'Not Found'}).encode('utf-8'))

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
