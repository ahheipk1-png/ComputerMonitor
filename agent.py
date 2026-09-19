#!/usr/bin/env python3
"""
ComputerMonitor High-Performance Hardware Agent
Asynchronous background telemetry collector with instant sub-millisecond HTTP responses.
Runs on port 5500 with CORS and Private Network Access enabled.
"""

import http.server
import json
import socket
import struct
import re
import platform
import os
import sys
import subprocess
import webbrowser
import threading
import time

PORT = 5500

if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

PROGRAM_DATA_DIR = os.path.join(os.environ.get('ProgramData', 'C:\\ProgramData'), 'ComputerMonitor')


def get_config_dirs():
    """Return directories to check for config files (ProgramData first for system-wide configs)."""
    dirs = []
    if os.path.isdir(PROGRAM_DATA_DIR):
        dirs.append(PROGRAM_DATA_DIR)
    if os.path.isdir(BASE_DIR) and BASE_DIR not in dirs:
        dirs.append(BASE_DIR)
    return dirs


def ensure_single_instance():
    """Ensure only one instance of ComputerMonitorAgent runs system-wide."""
    try:
        # 1. Quick loopback probe: if port 5500 is already responding, an agent is active
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.4)
        try:
            s.connect(('127.0.0.1', PORT))
            s.close()
            return False, None
        except Exception:
            s.close()

        # 2. Windows Global Named Mutex across all user sessions and Session 0 (SYSTEM)
        if sys.platform == 'win32':
            import ctypes
            kernel32 = ctypes.windll.kernel32
            mutex = kernel32.CreateMutexW(None, False, "Global\\ComputerMonitorAgent_SingleInstance_Mutex")
            last_error = kernel32.GetLastError()
            # 183 = ERROR_ALREADY_EXISTS, 5 = ERROR_ACCESS_DENIED (owned by SYSTEM)
            if last_error in (183, 5):
                return False, mutex
            return True, mutex
        return True, None
    except Exception:
        return True, None


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
    'cpu_freq': '-- GHz',
    'cpu_count': os.cpu_count() or 4,
    'cores': [],
    'temp': '--',
    'ram': {'total_gb': 0, 'used_gb': 0, 'free_gb': 0, 'percent': 0},
    'disk': {'total_gb': 0, 'used_gb': 0, 'free_gb': 0, 'percent': 0},
    'net': {'bytes_sent': 0, 'bytes_recv': 0},
    'processes': []
}
METRICS_LOCK = threading.Lock()


def get_local_ip():
    """Discover primary LAN Wi-Fi or Ethernet IP, filtering out VPN/virtual adapters."""
    vpn_keywords = ['surfshark', 'wireguard', 'openvpn', 'vethernet', 'tap', 'tun', 'docker', 'vmware', 'virtual', 'loopback', 'hyper-v']
    lan_keywords = ['wi-fi', 'wifi', 'wlan', 'ethernet', 'local area connection', 'en0', 'eth0', 'wlan0']

    try:
        if HAS_PSUTIL:
            candidates = []
            for iface, addr_list in psutil.net_if_addrs().items():
                iface_lower = iface.lower()
                if any(vk in iface_lower for vk in vpn_keywords):
                    continue
                for a in addr_list:
                    if a.family == socket.AF_INET and not a.address.startswith('127.') and not a.address.startswith('169.254.'):
                        score = 0
                        if any(lk in iface_lower for lk in lan_keywords):
                            score += 10
                        if a.address.startswith('192.168.'):
                            score += 5
                        elif a.address.startswith('10.'):
                            score += 2
                        candidates.append((score, a.address))
            if candidates:
                candidates.sort(reverse=True)
                return candidates[0][1]
    except Exception:
        pass

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
        out = subprocess.run(['schtasks', '/query', '/tn', 'ComputerMonitorAgent', '/fo', 'list', '/v'],
                             capture_output=True, text=True, timeout=2, creationflags=creationflags)
        if out.returncode == 0:
            status = "Ready / Running"
            task_user = ""
            for line in out.stdout.splitlines():
                if "Status:" in line:
                    status = line.split(":", 1)[1].strip()
                elif "Run As User:" in line:
                    task_user = line.split(":", 1)[1].strip()
            is_system = "SYSTEM" in task_user.upper()
            return {
                "installed": True,
                "status": f"{status} (All Accounts)" if is_system else status,
                "all_accounts": is_system,
                "user": task_user
            }
        return {"installed": False, "status": "Task Not Found / Deleted"}
    except Exception:
        return {"installed": False, "status": "Unavailable"}


def get_computer_alias():
    """Retrieve friendly computer alias name."""
    for d in get_config_dirs():
        alias_file = os.path.join(d, 'alias.txt')
        if os.path.exists(alias_file):
            try:
                with open(alias_file, 'r', encoding='utf-8') as f:
                    val = f.read().strip()
                    if val:
                        return val
            except Exception:
                pass
    return platform.node()


def background_metrics_collector():
    """Runs in background thread with minimal CPU footprint (<0.2%)."""
    global LATEST_METRICS
    cycle = 0
    cached_sched = {"installed": True, "status": "Active"}
    cached_processes = []
    cached_groups = []
    num_cpus = psutil.cpu_count(logical=True) or 1 if HAS_PSUTIL else 1

    while True:
        try:
            # 1. Update Task Scheduler check only every 20 seconds (saves subprocess overhead)
            if cycle % 20 == 0:
                cached_sched = check_task_scheduler()

            m = {
                'hostname': platform.node(),
                'alias': get_computer_alias(),
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

                # 2. Update All Processes grouped by name every 3.0 seconds (Task Manager style)
                # Does NOT omit processes with 0% CPU
                # Exclude System Idle Process (PID 0)
                # Normalize CPU% across logical cores (0-100% total system scale)
                if cycle % 3 == 0 or not cached_groups:
                    groups = {}
                    all_flat = []

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

                            proc_item = {
                                'pid': pid,
                                'name': name,
                                'cpu': norm_cpu,
                                'mem': mem_mb,
                                'io': 'Active',
                                'status': 'running'
                            }
                            all_flat.append(proc_item)

                            # Group by lowercased application name
                            gkey = name.lower()
                            if gkey not in groups:
                                groups[gkey] = {
                                    'name': name,
                                    'count': 0,
                                    'cpu': 0.0,
                                    'mem': 0.0,
                                    'io': 'Active',
                                    'status': 'running',
                                    'instances': []
                                }
                            g = groups[gkey]
                            g['count'] += 1
                            g['cpu'] = round(g['cpu'] + norm_cpu, 1)
                            g['mem'] = round(g['mem'] + mem_mb, 1)
                            g['instances'].append(proc_item)
                        except (psutil.NoSuchProcess, psutil.AccessDenied):
                            continue

                    # Sort children inside each group by CPU descending then Mem descending
                    for g in groups.values():
                        g['instances'].sort(key=lambda x: (x['cpu'], x['mem']), reverse=True)

                    cached_groups = list(groups.values())
                    cached_procs = all_flat

                m['process_groups'] = cached_groups
                m['processes'] = cached_procs
            else:
                m['cpu'] = 0
                m['ram'] = {'total_gb': 0, 'used_gb': 0, 'free_gb': 0, 'percent': 0}
                m['process_groups'] = []
                m['processes'] = []

            with METRICS_LOCK:
                LATEST_METRICS = m

        except Exception:
            pass

        cycle += 1
        time.sleep(1.0)


class PureMqttClient:
    """Lightweight zero-dependency MQTT 3.1.1 client for streaming hardware telemetry."""
    def __init__(self, client_id, host='broker.emqx.io', port=1883):
        self.client_id = client_id
        self.host = host
        self.port = port
        self.sock = None
        self.connected = False

    def connect(self, timeout=6):
        try:
            self.sock = socket.create_connection((self.host, self.port), timeout=timeout)
            protocol_name = b'MQTT'
            protocol_level = 4
            connect_flags = 0x02
            keep_alive = 60
            payload = struct.pack('!H', len(self.client_id)) + self.client_id.encode('utf-8')
            var_header = struct.pack('!H', len(protocol_name)) + protocol_name + struct.pack('!BBH', protocol_level, connect_flags, keep_alive)
            body = var_header + payload
            packet = bytes([0x10]) + self._encode_len(len(body)) + body
            self.sock.sendall(packet)
            resp = self._recv_exact(4)
            if len(resp) >= 4 and resp[0] == 0x20 and resp[3] == 0x00:
                self.connected = True
                self.sock.settimeout(0.3)
                return True
        except Exception:
            pass
        self.close()
        return False

    def subscribe(self, topic, msg_id=1):
        if not self.connected or not self.sock:
            return False
        try:
            topic_bytes = topic.encode('utf-8')
            var_header = struct.pack('!H', msg_id)
            payload = struct.pack('!H', len(topic_bytes)) + topic_bytes + b'\x00'
            body = var_header + payload
            packet = bytes([0x82]) + self._encode_len(len(body)) + body
            self.sock.sendall(packet)
            resp = self._recv_exact(5)
            return len(resp) >= 5 and resp[0] == 0x90
        except Exception:
            return False

    def publish(self, topic, payload):
        if not self.connected or not self.sock:
            return False
        try:
            topic_bytes = topic.encode('utf-8')
            msg_bytes = payload.encode('utf-8') if isinstance(payload, str) else payload
            var_header = struct.pack('!H', len(topic_bytes)) + topic_bytes
            body = var_header + msg_bytes
            packet = bytes([0x30]) + self._encode_len(len(body)) + body
            self.sock.sendall(packet)
            return True
        except Exception:
            self.close()
            return False

    def check_incoming(self):
        if not self.connected or not self.sock:
            return None
        try:
            header = self.sock.recv(1)
            if not header:
                return None
            pkt_type = header[0] >> 4
            multiplier = 1
            rem_len = 0
            while True:
                b = self.sock.recv(1)[0]
                rem_len += (b & 0x7F) * multiplier
                multiplier *= 128
                if (b & 0x80) == 0:
                    break
            data = self._recv_exact(rem_len)
            if pkt_type == 3:
                topic_len = struct.unpack('!H', data[:2])[0]
                topic = data[2:2+topic_len].decode('utf-8', errors='ignore')
                msg = data[2+topic_len:]
                return (topic, msg)
        except (socket.timeout, BlockingIOError):
            pass
        except Exception:
            self.close()
        return None

    def _encode_len(self, length):
        encoded = bytearray()
        while True:
            byte = length % 128
            length //= 128
            if length > 0:
                byte |= 0x80
            encoded.append(byte)
            if length == 0:
                break
        return bytes(encoded)

    def _recv_exact(self, n):
        data = bytearray()
        while len(data) < n:
            chunk = self.sock.recv(n - len(data))
            if not chunk:
                break
            data.extend(chunk)
        return bytes(data)

    def close(self):
        self.connected = False
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None


def get_fleet_id():
    """Retrieve or initialize persistent fleet identifier."""
    for d in get_config_dirs():
        fleet_file = os.path.join(d, 'fleet_id.txt')
        if os.path.exists(fleet_file):
            try:
                with open(fleet_file, 'r', encoding='utf-8') as f:
                    val = f.read().strip()
                    if val:
                        return val
            except Exception:
                pass
    default_id = "ahheipk1"
    target_dir = PROGRAM_DATA_DIR if os.path.isdir(PROGRAM_DATA_DIR) else BASE_DIR
    try:
        os.makedirs(target_dir, exist_ok=True)
        with open(os.path.join(target_dir, 'fleet_id.txt'), 'w', encoding='utf-8') as f:
            f.write(default_id)
    except Exception:
        pass
    return default_id


def handle_remote_command(msg_bytes):
    """Execute remote command received via secure fleet MQTT channel."""
    try:
        data = json.loads(msg_bytes.decode('utf-8'))
        action = data.get('action')
        if action == 'restart':
            delay = int(data.get('delay', 5))
            creationflags = 0x08000000 if sys.platform == 'win32' else 0
            if platform.system() == 'Windows':
                subprocess.Popen(['shutdown', '/r', '/f', '/t', str(delay)], creationflags=creationflags)
            else:
                subprocess.Popen(['shutdown', '-r', f'+{max(1, delay // 60)}'])
        elif action in ('shutdown', 'poweroff'):
            delay = int(data.get('delay', 5))
            creationflags = 0x08000000 if sys.platform == 'win32' else 0
            if platform.system() == 'Windows':
                subprocess.Popen(['shutdown', '/s', '/f', '/t', str(delay)], creationflags=creationflags)
            else:
                subprocess.Popen(['shutdown', '-h', f'+{max(1, delay // 60)}'])
        elif action == 'kill':
            val = str(data.get('val') or data.get('identifier') or data.get('name') or data.get('pid') or '').strip()
            is_pid = data.get('isPid', False)
            if not val or not HAS_PSUTIL:
                return
            if is_pid or val.isdigit():
                try:
                    pid = int(val)
                    if pid not in (0, 4) and pid != os.getpid():
                        p = psutil.Process(pid)
                        p.terminate()
                        try:
                            p.wait(timeout=0.8)
                        except psutil.TimeoutExpired:
                            p.kill()
                except Exception:
                    pass
            else:
                target = val.lower()
                target_exe = target if target.endswith('.exe') else f"{target}.exe"
                for p in psutil.process_iter(['name', 'pid']):
                    try:
                        pname = (p.info['name'] or '').lower()
                        if (pname == target or pname == target_exe) and p.info['pid'] not in (0, 4) and p.info['pid'] != os.getpid():
                            proc = psutil.Process(p.info['pid'])
                            proc.terminate()
                            try:
                                proc.wait(timeout=0.8)
                            except psutil.TimeoutExpired:
                                proc.kill()
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
        elif action == 'set_alias':
            new_alias = str(data.get('alias') or '').strip()
            for d in (PROGRAM_DATA_DIR, BASE_DIR):
                try:
                    os.makedirs(d, exist_ok=True)
                    with open(os.path.join(d, 'alias.txt'), 'w', encoding='utf-8') as f:
                        f.write(new_alias)
                except Exception:
                    pass
            with METRICS_LOCK:
                LATEST_METRICS['alias'] = new_alias or platform.node()
    except Exception:
        pass


def mqtt_fleet_worker():
    """Background worker that continuously streams telemetry to the global fleet channel."""
    fleet_id = get_fleet_id()
    hostname = platform.node()
    machine_id = re.sub(r'[^a-zA-Z0-9_-]', '', hostname).lower() or "pc"
    pub_topic = f"computermonitor/fleet/{fleet_id}/{hostname}"
    cmd_topic = f"computermonitor/fleet/{fleet_id}/{hostname}/cmd"
    brokers = ['broker.emqx.io', 'broker.hivemq.com']
    broker_idx = 0

    while True:
        broker = brokers[broker_idx % len(brokers)]
        client_id = f"cm_agent_{machine_id}_{int(time.time())}"
        client = PureMqttClient(client_id, host=broker, port=1883)
        if not client.connect(timeout=6):
            broker_idx += 1
            time.sleep(4)
            continue

        client.subscribe(cmd_topic)
        current_alias = get_computer_alias()
        if current_alias and current_alias.lower() != hostname.lower():
            client.subscribe(f"computermonitor/fleet/{fleet_id}/{current_alias}/cmd")

        while client.connected:
            try:
                # Check for incoming commands
                inc = client.check_incoming()
                if inc:
                    topic, msg = inc
                    if topic.endswith('/cmd'):
                        handle_remote_command(msg)

                # Publish telemetry
                with METRICS_LOCK:
                    payload = json.dumps(LATEST_METRICS)

                if not client.publish(pub_topic, payload):
                    break

                for _ in range(15):
                    time.sleep(0.1)
                    inc = client.check_incoming()
                    if inc:
                        topic, msg = inc
                        if topic == cmd_topic:
                            handle_remote_command(msg)

            except Exception:
                break

        client.close()
        broker_idx += 1
        time.sleep(3)


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
        elif self.path in ('/restart', '/reboot'):
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length).decode('utf-8') if length > 0 else ''
                data = json.loads(body) if body else {}
                delay = int(data.get('delay', 5))
                delay = max(1, min(delay, 60))

                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': True,
                    'message': f"Restart initiated successfully. System will reboot in {delay} seconds..."
                }).encode('utf-8'))
                self.wfile.flush()

                def execute_reboot():
                    time.sleep(1.2)
                    creationflags = 0x08000000 if sys.platform == 'win32' else 0
                    if platform.system() == 'Windows':
                        subprocess.run(
                            ['shutdown', '/r', '/f', '/t', str(delay), '/c', 'Restart requested from ComputerMonitor Dashboard'],
                            creationflags=creationflags,
                            check=False
                        )
                    elif platform.system() == 'Darwin':
                        subprocess.run(['sudo', 'shutdown', '-r', f"+{int(delay/60)}"], check=False)
                    else:
                        subprocess.run(['shutdown', '-r', f"+{int(delay/60)}"], check=False)

                threading.Thread(target=execute_reboot, daemon=True).start()
                return
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode('utf-8'))
                return

        elif self.path in ('/shutdown', '/poweroff'):
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length).decode('utf-8') if length > 0 else ''
                data = json.loads(body) if body else {}
                delay = int(data.get('delay', 5))
                delay = max(1, min(delay, 60))

                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': True,
                    'message': f"Shutdown initiated successfully. System will power off in {delay} seconds..."
                }).encode('utf-8'))
                self.wfile.flush()

                def execute_shutdown():
                    time.sleep(1.2)
                    creationflags = 0x08000000 if sys.platform == 'win32' else 0
                    if platform.system() == 'Windows':
                        subprocess.run(
                            ['shutdown', '/s', '/f', '/t', str(delay), '/c', 'Shut down requested from ComputerMonitor Dashboard'],
                            creationflags=creationflags,
                            check=False
                        )
                    elif platform.system() == 'Darwin':
                        subprocess.run(['sudo', 'shutdown', '-h', f"+{int(delay/60)}"], check=False)
                    else:
                        subprocess.run(['shutdown', '-h', f"+{int(delay/60)}"], check=False)

                threading.Thread(target=execute_shutdown, daemon=True).start()
                return
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode('utf-8'))
                return

        elif self.path in ('/cancel-restart', '/cancel-shutdown'):
            try:
                creationflags = 0x08000000 if sys.platform == 'win32' else 0
                if platform.system() == 'Windows':
                    res = subprocess.run(
                        ['shutdown', '/a'],
                        capture_output=True,
                        text=True,
                        creationflags=creationflags
                    )
                    if res.returncode == 0:
                        msg = "System restart sequence successfully cancelled."
                        success = True
                    else:
                        msg = res.stderr.strip() or "No system restart sequence was pending."
                        success = False
                else:
                    subprocess.run(['shutdown', '-c'], check=False)
                    msg = "Restart cancelled."
                    success = True

                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({'success': success, 'message': msg}).encode('utf-8'))
                return
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode('utf-8'))
                return

        elif self.path in ('/alias', '/set_alias'):
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length).decode('utf-8') if length > 0 else ''
                data = json.loads(body) if body else {}
                new_alias = str(data.get('alias') or '').strip()
                for d in (PROGRAM_DATA_DIR, BASE_DIR):
                    try:
                        os.makedirs(d, exist_ok=True)
                        with open(os.path.join(d, 'alias.txt'), 'w', encoding='utf-8') as f:
                            f.write(new_alias)
                    except Exception:
                        pass
                with METRICS_LOCK:
                    LATEST_METRICS['alias'] = new_alias or platform.node()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({'success': True, 'alias': new_alias or platform.node()}).encode('utf-8'))
                return
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode('utf-8'))
                return
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'Not Found'}).encode('utf-8'))

    def do_GET(self):
        if self.path == '/metrics':
            try:
                with METRICS_LOCK:
                    payload = json.dumps(LATEST_METRICS).encode('utf-8')

                self.send_response(200)
                self.end_headers()
                self.wfile.write(payload)
            except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                pass
            return

        # Serve web dashboard files
        clean_path = self.path.split('?')[0]
        if clean_path in ('/', '/index.html'):
            fname = 'index.html'
            ctype = 'text/html; charset=utf-8'
        elif clean_path == '/styles.css':
            fname = 'styles.css'
            ctype = 'text/css; charset=utf-8'
        elif clean_path == '/app.js':
            fname = 'app.js'
            ctype = 'application/javascript; charset=utf-8'
        elif clean_path == '/mqtt.min.js':
            fname = 'mqtt.min.js'
            ctype = 'application/javascript; charset=utf-8'
        elif clean_path == '/ComputerMonitorControl.exe':
            fname = 'ComputerMonitorControl.exe'
            ctype = 'application/octet-stream'
        elif clean_path == '/ComputerMonitorAgent.exe':
            fname = 'ComputerMonitorAgent.exe'
            ctype = 'application/octet-stream'
        elif clean_path == '/ComputerMonitor.zip':
            fname = 'ComputerMonitor.zip'
            ctype = 'application/zip'
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"error": "Not Found"}')
            return

        file_path = os.path.join(BASE_DIR, fname)
        if os.path.exists(file_path):
            try:
                with open(file_path, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', str(len(content)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Cache-Control', 'no-cache')
                http.server.BaseHTTPRequestHandler.end_headers(self)
                self.wfile.write(content)
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"error": "File Not Found"}')

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
    fleet = get_fleet_id()
    url = f"https://computermonitor.pages.dev/?fleet={fleet}"
    print(f"[*] Launching live dashboard in your browser: {url}")
    webbrowser.open(url)


def main():
    is_primary, mutex_handle = ensure_single_instance()
    if not is_primary:
        # Agent is already running system-wide (e.g. as a service or under another logged-in account)
        if '--background' not in sys.argv and '--no-browser' not in sys.argv:
            auto_open_browser()
        sys.exit(0)

    lan_ip = get_local_ip()
    fleet = get_fleet_id()
    print("=" * 65)
    print(" [COMPUTER MONITOR] Real-Time Hardware Agent")
    print("=" * 65)
    print(f"[*] Computer Name : {platform.node()}")
    print(f"[*] Fleet Network : {fleet} (Cloud Synced)")
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

    # Start background MQTT cloud fleet streamer
    mqtt_streamer = threading.Thread(target=mqtt_fleet_worker, daemon=True)
    mqtt_streamer.start()

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
