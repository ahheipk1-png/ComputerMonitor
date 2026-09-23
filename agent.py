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

AGENT_VERSION = "4.7.9"

# Lock Timer State for Delayed Workstation Locking
CURRENT_LOCK_EVENT = None
LOCK_DEADLINE = 0
LOCK_LOCK = threading.Lock()

# Browser Tabs Tracking & Remote Tab Closing
BROWSER_TABS_LOCK = threading.Lock()
LATEST_BROWSER_TABS = []
LATEST_BROWSER_NAME = ""
BROWSER_TABS_UPDATED_AT = 0
PENDING_CLOSE_TABS = []

# Critical Windows Kernel processes protected from accidental termination (BSOD prevention)
PROTECTED_PROCESSES = {
    'system', 'system idle process', 'registry', 'smss.exe', 'csrss.exe',
    'wininit.exe', 'services.exe', 'lsass.exe', 'svchost.exe', 'fontdrvhost.exe',
    'winlogon.exe', 'dwm.exe'
}

# Global thread-safe metrics cache
LATEST_METRICS = {
    'agent_version': AGENT_VERSION,
    'hostname': platform.node(),
    'os': f"{platform.system()} {platform.release()}",
    'arch': platform.machine(),
    'is_locked': False,
    'browser_tabs': [],
    'browser_name': '',
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


def get_machine_id():
    """Retrieve persistent unique machine hardware GUID (100% collision-free)."""
    for d in get_config_dirs():
        id_file = os.path.join(d, 'machine_id.txt')
        if os.path.exists(id_file):
            try:
                with open(id_file, 'r', encoding='utf-8') as f:
                    val = f.read().strip()
                    if val and len(val) >= 6:
                        return val
            except Exception:
                pass

    guid = ''
    if platform.system() == 'Windows':
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography", 0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as key:
                val, _ = winreg.QueryValueEx(key, "MachineGuid")
                if val:
                    guid = str(val).strip().lower()
        except Exception:
            pass

    if not guid:
        try:
            import uuid
            node_hex = hex(uuid.getnode())[2:]
            guid = f"hw-{node_hex.lower()}"
        except Exception:
            guid = f"pc-{platform.node().lower()}"

    for d in get_config_dirs():
        try:
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, 'machine_id.txt'), 'w', encoding='utf-8') as f:
                f.write(guid)
        except Exception:
            pass

    return guid


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
if sys.platform == 'win32':
    try:
        import ctypes
        from ctypes import wintypes

        class WTSINFOEX_LEVEL1_W(ctypes.Structure):
            _fields_ = [
                ('SessionId', wintypes.ULONG),
                ('SessionState', wintypes.DWORD),
                ('SessionFlags', wintypes.DWORD),
                ('WinStationName', wintypes.WCHAR * 33),
                ('UserName', wintypes.WCHAR * 21),
                ('DomainName', wintypes.WCHAR * 18),
                ('LogonTime', wintypes.LARGE_INTEGER),
                ('ConnectTime', wintypes.LARGE_INTEGER),
                ('DisconnectTime', wintypes.LARGE_INTEGER),
                ('LastInputTime', wintypes.LARGE_INTEGER),
                ('CurrentTime', wintypes.LARGE_INTEGER),
                ('IncomingBytes', wintypes.DWORD),
                ('OutgoingBytes', wintypes.DWORD),
                ('IncomingFrames', wintypes.DWORD),
                ('OutgoingFrames', wintypes.DWORD),
                ('IncomingCompressionRatio', wintypes.DWORD),
                ('OutgoingCompressionRatio', wintypes.DWORD),
            ]

        class WTSINFOEXW(ctypes.Structure):
            _fields_ = [
                ('Level', wintypes.DWORD),
                ('Data', WTSINFOEX_LEVEL1_W)
            ]
    except Exception:
        pass


def is_workstation_locked():
    """Real-time detection of Windows lock screen / login screen state."""
    if sys.platform != 'win32':
        return False

    # Check 1: LogonUI.exe running (Windows lock screen user interface)
    try:
        if HAS_PSUTIL:
            for p in psutil.process_iter(['name']):
                pname = p.info.get('name')
                if pname and pname.lower() == 'logonui.exe':
                    return True
    except Exception:
        pass

    # Check 2: Terminal Services API SessionFlags
    try:
        kernel32 = ctypes.windll.kernel32
        wtsapi32 = ctypes.windll.wtsapi32
        session_id = kernel32.WTSGetActiveConsoleSessionId()
        if session_id != 0xFFFFFFFF:
            ppBuffer = ctypes.c_void_p()
            pBytesReturned = wintypes.DWORD()
            # 25 = WTSSessionInfoEx
            if wtsapi32.WTSQuerySessionInformationW(0, session_id, 25, ctypes.byref(ppBuffer), ctypes.byref(pBytesReturned)):
                try:
                    info = ctypes.cast(ppBuffer, ctypes.POINTER(WTSINFOEXW)).contents
                    if info.Level == 1:
                        # 0 = WTS_SESSIONSTATE_LOCK, 1 = WTS_SESSIONSTATE_UNLOCK
                        return info.Data.SessionFlags == 0
                finally:
                    wtsapi32.WTSFreeMemory(ppBuffer)
    except Exception:
        pass

    return False


def get_recent_browser_history_fallback():
    """Fallback reader for Chrome/Edge recent history SQLite database if extension is not connected."""
    if sys.platform != 'win32':
        return []
    try:
        import sqlite3
        import tempfile
        import shutil
        import urllib.parse

        user_dirs = []
        user_profile = os.environ.get('USERPROFILE')
        if user_profile:
            user_dirs.append(user_profile)

        # When running as SYSTEM service, inspect user profiles on C:\Users
        if os.path.isdir(r'C:\Users'):
            for entry in os.listdir(r'C:\Users'):
                p = os.path.join(r'C:\Users', entry)
                if os.path.isdir(p) and entry.lower() not in ('default', 'default user', 'public', 'all users'):
                    if p not in user_dirs:
                        user_dirs.append(p)

        candidates = []
        for u in user_dirs:
            ch = os.path.join(u, r'AppData\Local\Google\Chrome\User Data\Default\History')
            if os.path.isfile(ch):
                candidates.append((ch, 'Chrome'))
            ed = os.path.join(u, r'AppData\Local\Microsoft\Edge\User Data\Default\History')
            if os.path.isfile(ed):
                candidates.append((ed, 'Edge'))

        if not candidates:
            return []

        # Most recently updated history file
        candidates.sort(key=lambda x: os.path.getmtime(x[0]), reverse=True)
        hist_path, bname = candidates[0]

        # Only use if modified in the last 12 hours
        if time.time() - os.path.getmtime(hist_path) > 43200:
            return []

        tmp_db = os.path.join(tempfile.gettempdir(), f"cm_hist_{os.getpid()}_{int(time.time())}.db")
        shutil.copy2(hist_path, tmp_db)

        results = []
        conn = sqlite3.connect(tmp_db, timeout=2.0)
        cur = conn.cursor()
        cur.execute("SELECT title, url FROM urls ORDER BY last_visit_time DESC LIMIT 8")
        seen_domains = set()
        for row in cur.fetchall():
            title = (row[0] or 'Untitled').strip()
            url = (row[1] or '').strip()
            if not url or url.startswith('chrome://') or url.startswith('edge://'):
                continue
            domain = ''
            try:
                domain = urllib.parse.urlparse(url).netloc
            except Exception:
                pass
            if not domain:
                continue
            # Deduplicate multiple hits to same domain in fallback summary
            if domain in seen_domains:
                continue
            seen_domains.add(domain)

            results.append({
                'id': 0,
                'title': title,
                'url': url,
                'domain': domain,
                'active': False,
                'is_history': True,
                'browser': bname
            })
            if len(results) >= 5:
                break

        conn.close()
        try:
            os.remove(tmp_db)
        except Exception:
            pass
        return results
    except Exception:
        return []


def background_metrics_collector():
    """Runs in background thread with minimal CPU footprint (<0.2%)."""
    global LATEST_METRICS
    cycle = 0
    cached_sched = {"installed": True, "status": "Active"}
    cached_processes = []
    cached_groups = []
    num_cpus = psutil.cpu_count(logical=True) or 1 if HAS_PSUTIL else 1
    my_machine_id = get_machine_id()

    while True:
        try:
            # 1. Update Task Scheduler check only every 20 seconds (saves subprocess overhead)
            if cycle % 20 == 0:
                cached_sched = check_task_scheduler()

            m = {
                'agent_version': AGENT_VERSION,
                'hostname': platform.node(),
                'machine_id': my_machine_id,
                'alias': get_computer_alias(),
                'os': f"{platform.system()} {platform.release()}",
                'arch': platform.machine(),
                'task_scheduler': cached_sched,
                'is_locked': is_workstation_locked(),
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

            with LOCK_LOCK:
                if LOCK_DEADLINE > 0:
                    rem_lock = max(0, int(LOCK_DEADLINE - time.time()))
                    if rem_lock > 0:
                        m['pending_lock_sec'] = rem_lock

            # Browser Tabs & Active Websites
            with BROWSER_TABS_LOCK:
                if LATEST_BROWSER_TABS and (time.time() - BROWSER_TABS_UPDATED_AT < 45):
                    m['browser_tabs'] = list(LATEST_BROWSER_TABS)
                    m['browser_name'] = LATEST_BROWSER_NAME
                else:
                    if cycle % 10 == 0:
                        cached_fallback_tabs = get_recent_browser_history_fallback()
                    if 'cached_fallback_tabs' in locals() and cached_fallback_tabs:
                        m['browser_tabs'] = cached_fallback_tabs
                        m['browser_name'] = 'Recent History'
                    else:
                        m['browser_tabs'] = []
                        m['browser_name'] = ''

            # Browser Monitoring Failure / Health Check
            chrome_running = any(p.get('name', '').lower() == 'chrome.exe' for p in m.get('processes', []))
            edge_running = any(p.get('name', '').lower() in ('msedge.exe', 'edge.exe') for p in m.get('processes', []))
            ext_connected = bool(LATEST_BROWSER_TABS and (time.time() - BROWSER_TABS_UPDATED_AT < 45))

            warning_msg = None
            if (chrome_running or edge_running) and not ext_connected:
                b_names = []
                if chrome_running:
                    b_names.append('Google Chrome')
                if edge_running:
                    b_names.append('Microsoft Edge')
                warning_msg = f"{' & '.join(b_names)} running, but Web Monitoring is disconnected."

            m['browser_monitoring'] = {
                'chrome_running': chrome_running,
                'edge_running': edge_running,
                'extension_connected': ext_connected,
                'warning': warning_msg
            }

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
                self.close()
                return None
            pkt_type = header[0] >> 4
            multiplier = 1
            rem_len = 0
            while True:
                b_arr = self.sock.recv(1)
                if not b_arr:
                    self.close()
                    return None
                b = b_arr[0]
                rem_len += (b & 0x7F) * multiplier
                multiplier *= 128
                if (b & 0x80) == 0:
                    break
            data = self._recv_exact(rem_len)
            if not data and rem_len > 0:
                self.close()
                return None
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
                self.close()
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


def execute_system_lock():
    """Lock the computer session and return to the OS login screen.
    Handles both interactive user sessions (Session 1+) and SYSTEM services (Session 0).
    """
    if platform.system() == 'Windows':
        creationflags = 0x08000000 if sys.platform == 'win32' else 0
        import ctypes
        # 1. Standard Win32 API
        try:
            ctypes.windll.user32.LockWorkStation()
        except Exception:
            pass
        # 2. Terminal Services session disconnect (works from Session 0 / SYSTEM service)
        try:
            session_id = ctypes.windll.kernel32.WTSGetActiveConsoleSessionId()
            if session_id != 0xFFFFFFFF and session_id != 0:
                ctypes.windll.wtsapi32.WTSDisconnectSession(0, session_id, False)
        except Exception:
            pass
        # 3. Native tsdiscon.exe fallback
        try:
            tsdiscon_path = os.path.join(os.environ.get('SystemRoot', r'C:\Windows'), 'System32', 'tsdiscon.exe')
            if os.path.exists(tsdiscon_path):
                subprocess.Popen([tsdiscon_path], creationflags=creationflags)
        except Exception:
            pass
        # 4. Rundll32 fallback
        try:
            subprocess.Popen(['rundll32.exe', 'user32.dll,LockWorkStation'], creationflags=creationflags)
        except Exception:
            pass
    elif platform.system() == 'Darwin':
        subprocess.Popen(['pmset', 'displaysleepnow'])
    else:
        subprocess.Popen(['xdg-screensaver', 'lock'])


def schedule_delayed_lock(delay_sec):
    """Schedule workstation lock after delay_sec seconds with support for cancellation."""
    global CURRENT_LOCK_EVENT, LOCK_DEADLINE
    with LOCK_LOCK:
        if CURRENT_LOCK_EVENT:
            CURRENT_LOCK_EVENT.set()
        if delay_sec <= 0:
            CURRENT_LOCK_EVENT = None
            LOCK_DEADLINE = 0
            execute_system_lock()
            return

        evt = threading.Event()
        CURRENT_LOCK_EVENT = evt
        LOCK_DEADLINE = time.time() + delay_sec

    def delayed_lock_worker(event_obj, sec):
        global CURRENT_LOCK_EVENT, LOCK_DEADLINE
        cancelled = event_obj.wait(timeout=sec)
        if not cancelled:
            execute_system_lock()
        with LOCK_LOCK:
            if CURRENT_LOCK_EVENT == event_obj:
                CURRENT_LOCK_EVENT = None
                LOCK_DEADLINE = 0

    threading.Thread(target=delayed_lock_worker, args=(evt, delay_sec), daemon=True).start()


def cancel_delayed_lock():
    """Cancel any pending delayed workstation lock timer."""
    global CURRENT_LOCK_EVENT, LOCK_DEADLINE
    with LOCK_LOCK:
        if CURRENT_LOCK_EVENT:
            CURRENT_LOCK_EVENT.set()
            CURRENT_LOCK_EVENT = None
            LOCK_DEADLINE = 0
            return True
        return False


def trigger_agent_update():
    """Download the latest ComputerMonitorAgent.exe and restart."""
    try:
        req = urllib.request.Request("https://computermonitor.pages.dev/version.json", headers={'User-Agent': 'Mozilla/5.0 ComputerMonitorAgent'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            cloud_ver = data.get('version', '').strip()
            if cloud_ver and cloud_ver != AGENT_VERSION and getattr(sys, 'frozen', False):
                curr_exe = os.path.abspath(sys.executable)
                exe_dir = os.path.dirname(curr_exe)
                new_exe = os.path.join(exe_dir, "ComputerMonitorAgent.new")
                dl_url = "https://computermonitor.pages.dev/ComputerMonitorAgent.exe"
                req_dl = urllib.request.Request(dl_url, headers={'User-Agent': 'Mozilla/5.0 ComputerMonitorAgent'})
                with urllib.request.urlopen(req_dl, timeout=30) as d_resp, open(new_exe, 'wb') as f:
                    f.write(d_resp.read())
                if os.path.exists(new_exe) and os.path.getsize(new_exe) > 1000000:
                    bat_path = os.path.join(exe_dir, "update_agent.bat")
                    with open(bat_path, 'w') as f:
                        f.write(f"""@echo off\ntimeout /t 2 /nobreak >nul\nmove /y "{new_exe}" "{curr_exe}" >nul\nstart "" "{curr_exe}" --background\ndel "%~f0"\n""")
                    creationflags = 0x08000000 if sys.platform == 'win32' else 0
                    subprocess.Popen(['cmd.exe', '/c', bat_path], creationflags=creationflags)
                    os._exit(0)
    except Exception:
        pass


def install_extension_system_wide():
    """Install and register Tab Tracker extension for Chrome and Edge across Current User & All Users."""
    if platform.system() != 'Windows':
        return False, "Only supported on Windows"
    try:
        pdata = os.environ.get('ProgramData', r'C:\ProgramData')
        target_dir = os.path.join(pdata, 'ComputerMonitor', 'extension')
        os.makedirs(target_dir, exist_ok=True)

        base_dir = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, 'frozen', False) else __file__))
        src_ext_dir = os.path.join(base_dir, 'extension')
        src_crx = os.path.join(base_dir, 'extension.crx')
        target_crx = os.path.join(target_dir, 'extension.crx')

        import shutil
        if os.path.exists(src_ext_dir) and os.path.isdir(src_ext_dir):
            for item in os.listdir(src_ext_dir):
                s = os.path.join(src_ext_dir, item)
                d = os.path.join(target_dir, item)
                if os.path.isfile(s):
                    try:
                        shutil.copy2(s, d)
                    except Exception:
                        pass

        if os.path.exists(src_crx):
            try:
                shutil.copy2(src_crx, target_crx)
            except Exception:
                pass
        elif not os.path.exists(target_crx):
            try:
                dl_url = "https://computermonitor.pages.dev/extension.crx"
                req = urllib.request.Request(dl_url, headers={'User-Agent': 'ComputerMonitorAgent'})
                with urllib.request.urlopen(req, timeout=15) as resp, open(target_crx, 'wb') as f:
                    f.write(resp.read())
            except Exception:
                pass

        ext_id = "ijfbfnckpabilcbgenhjddgchockeobe"
        update_url = "http://127.0.0.1:5500/extension/updates.xml"
        creationflags = 0x08000000 if sys.platform == 'win32' else 0

        def reg_add(hive, subkey, val_name, val_data, val_type="REG_SZ"):
            cmd = ['reg.exe', 'add', f"{hive}\\{subkey}", '/v', str(val_name), '/t', val_type, '/d', str(val_data), '/f']
            try:
                subprocess.run(cmd, capture_output=True, creationflags=creationflags)
            except Exception:
                pass

        # 1. Current User (Chrome + Edge)
        reg_add("HKCU", f"Software\\Google\\Chrome\\Extensions\\{ext_id}", "path", target_crx)
        reg_add("HKCU", f"Software\\Google\\Chrome\\Extensions\\{ext_id}", "version", "1.0.0")
        reg_add("HKCU", f"Software\\Microsoft\\Edge\\Extensions\\{ext_id}", "path", target_crx)
        reg_add("HKCU", f"Software\\Microsoft\\Edge\\Extensions\\{ext_id}", "version", "1.0.0")

        # 2. System-Wide Policies (All Users) - Sequential index starting at 1 is required by Chromium
        reg_add("HKLM", r"Software\Policies\Google\Chrome\ExtensionInstallForcelist", "1", f"{ext_id};{update_url}")
        reg_add("HKLM", r"Software\Policies\Google\Chrome\ExtensionInstallForcelist", "101", f"{ext_id};{update_url}")
        reg_add("HKLM", r"Software\Policies\Google\Chrome\ExtensionInstallSources", "1", "http://127.0.0.1:5500/*")
        reg_add("HKLM", r"Software\Policies\Google\Chrome\ExtensionInstallSources", "2", "https://computermonitor.pages.dev/*")
        reg_add("HKLM", r"Software\Policies\Google\Chrome\ExtensionInstallSources", "101", "http://127.0.0.1:5500/*")
        reg_add("HKLM", r"Software\Policies\Google\Chrome\ExtensionInstallSources", "102", "https://computermonitor.pages.dev/*")

        reg_add("HKLM", f"Software\\Google\\Chrome\\Extensions\\{ext_id}", "path", target_crx)
        reg_add("HKLM", f"Software\\Google\\Chrome\\Extensions\\{ext_id}", "version", "1.0.0")
        reg_add("HKLM", f"Software\\WOW6432Node\\Google\\Chrome\\Extensions\\{ext_id}", "path", target_crx)
        reg_add("HKLM", f"Software\\WOW6432Node\\Google\\Chrome\\Extensions\\{ext_id}", "version", "1.0.0")

        reg_add("HKLM", r"Software\Policies\Microsoft\Edge\ExtensionInstallForcelist", "1", f"{ext_id};{update_url}")
        reg_add("HKLM", r"Software\Policies\Microsoft\Edge\ExtensionInstallForcelist", "101", f"{ext_id};{update_url}")
        reg_add("HKLM", r"Software\Policies\Microsoft\Edge\ExtensionInstallSources", "1", "http://127.0.0.1:5500/*")
        reg_add("HKLM", r"Software\Policies\Microsoft\Edge\ExtensionInstallSources", "2", "https://computermonitor.pages.dev/*")
        reg_add("HKLM", r"Software\Policies\Microsoft\Edge\ExtensionInstallSources", "101", "http://127.0.0.1:5500/*")
        reg_add("HKLM", r"Software\Policies\Microsoft\Edge\ExtensionInstallSources", "102", "https://computermonitor.pages.dev/*")

        reg_add("HKLM", f"Software\\Microsoft\\Edge\\Extensions\\{ext_id}", "path", target_crx)
        reg_add("HKLM", f"Software\\Microsoft\\Edge\\Extensions\\{ext_id}", "version", "1.0.0")
        reg_add("HKLM", f"Software\\WOW6432Node\\Microsoft\\Edge\\Extensions\\{ext_id}", "path", target_crx)
        reg_add("HKLM", f"Software\\WOW6432Node\\Microsoft\\Edge\\Extensions\\{ext_id}", "version", "1.0.0")

        return True, "Tab Tracker extension installed successfully for Chrome & Edge"
    except Exception as e:
        return False, str(e)


def handle_remote_command(msg_bytes):
    """Execute remote command received via secure fleet MQTT channel."""
    try:
        data = json.loads(msg_bytes.decode('utf-8'))
        
        # 1. Hardware-level GUID target check (100% collision prevention)
        target_guid = data.get('target_machine_id') or data.get('machine_id') or data.get('guid')
        my_guid = get_machine_id().lower()
        my_short_guid = my_guid.replace('-', '')[:8]
        if target_guid:
            t_guid = str(target_guid).strip().lower().replace('-', '')
            m_guid = my_guid.replace('-', '')
            if (t_guid != m_guid and 
                not m_guid.startswith(t_guid) and 
                not t_guid.startswith(m_guid) and
                not my_short_guid.startswith(t_guid) and
                not t_guid.startswith(my_short_guid)):
                return  # Command is intended for a different physical computer!

        # 2. Alias target check
        target_alias = data.get('target_alias')
        if target_alias:
            current_alias = get_computer_alias()
            if current_alias and target_alias.strip().lower() != current_alias.strip().lower():
                return  # Command is intended for a different computer!

        # 3. Target Node ID check
        target_id = str(data.get('target_id') or '').strip().lower()
        if target_id and not target_guid and not target_alias:
            my_alias = get_computer_alias().strip().lower()
            my_host = platform.node().strip().lower()
            if target_id.startswith('node-'):
                clean_id = target_id[5:]
                if clean_id != my_alias and clean_id != my_host and not clean_id.startswith(my_host):
                    return

        action = data.get('action')
        delay = int(data.get('delay', 5))
        delay = max(1, min(delay, 60))
        creationflags = 0x08000000 if sys.platform == 'win32' else 0

        shutdown_bin = 'shutdown'
        if platform.system() == 'Windows':
            sys32 = os.path.join(os.environ.get('SystemRoot', r'C:\Windows'), 'System32', 'shutdown.exe')
            if os.path.exists(sys32):
                shutdown_bin = sys32

        if action == 'restart':
            if platform.system() == 'Windows':
                subprocess.Popen([shutdown_bin, '/r', '/f', '/t', str(delay), '/c', 'Restart requested from ComputerMonitor Dashboard'], creationflags=creationflags)
            else:
                subprocess.Popen(['shutdown', '-r', f'+{max(1, delay // 60)}'])
        elif action == 'lock':
            lock_delay_sec = 0
            if 'delay_seconds' in data:
                try:
                    lock_delay_sec = max(0, int(data['delay_seconds']))
                except Exception:
                    pass
            elif 'delay_minutes' in data:
                try:
                    lock_delay_sec = max(0, int(float(data['delay_minutes']) * 60))
                except Exception:
                    pass
            elif 'delay' in data:
                try:
                    lock_delay_sec = max(0, int(data['delay']))
                except Exception:
                    pass

            schedule_delayed_lock(lock_delay_sec)
        elif action in ('cancel_lock', 'cancel-lock'):
            cancel_delayed_lock()
        elif action in ('close_tab', 'close-tab'):
            tab_id = data.get('tab_id') or data.get('id')
            if tab_id is not None:
                try:
                    with BROWSER_TABS_LOCK:
                        PENDING_CLOSE_TABS.append(int(tab_id))
                except Exception:
                    pass
        elif action in ('install_extension', 'install-extension'):
            threading.Thread(target=install_extension_system_wide, daemon=True).start()
        elif action == 'update':
            threading.Thread(target=trigger_agent_update, daemon=True).start()
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
            for d in get_config_dirs():
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
    raw_guid = get_machine_id()
    short_guid = raw_guid.replace('-', '')[:8].lower()
    node_unique_key = f"{hostname}_{short_guid}"
    pub_topic = f"computermonitor/fleet/{fleet_id}/{node_unique_key}"
    brokers = ['broker.emqx.io', 'broker.hivemq.com']
    broker_idx = 0

    while True:
        broker = brokers[broker_idx % len(brokers)]
        client_id = f"cm_agent_{node_unique_key}_{int(time.time())}"
        client = PureMqttClient(client_id, host=broker, port=1883)
        if not client.connect(timeout=6):
            broker_idx += 1
            time.sleep(4)
            continue

        # 1. Subscribe to hardware-unique machine GUID command topic (zero collision guarantee)
        client.subscribe(f"computermonitor/fleet/{fleet_id}/{node_unique_key}/cmd", msg_id=1)
        client.subscribe(f"computermonitor/fleet/{fleet_id}/{raw_guid}/cmd", msg_id=2)
        client.subscribe(f"computermonitor/fleet/{fleet_id}/{short_guid}/cmd", msg_id=3)

        # 2. Subscribe to unique alias command topic
        current_alias = get_computer_alias()
        if current_alias and current_alias != hostname:
            client.subscribe(f"computermonitor/fleet/{fleet_id}/{current_alias}/cmd", msg_id=4)
            if current_alias.lower() != current_alias:
                client.subscribe(f"computermonitor/fleet/{fleet_id}/{current_alias.lower()}/cmd", msg_id=5)

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
                        if topic.endswith('/cmd'):
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

        elif self.path == '/cancel-restart':
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

        elif self.path in ('/lock', '/lock-computer'):
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length).decode('utf-8') if length > 0 else ''
                data = json.loads(body) if body else {}
                delay_sec = 0
                if 'delay_seconds' in data:
                    delay_sec = max(0, int(data['delay_seconds']))
                elif 'delay_minutes' in data:
                    delay_sec = max(0, int(float(data['delay_minutes']) * 60))
                elif 'delay' in data:
                    delay_sec = max(0, int(data['delay']))

                schedule_delayed_lock(delay_sec)

                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': True,
                    'delay_seconds': delay_sec,
                    'message': f"Workstation lock scheduled in {delay_sec} seconds." if delay_sec > 0 else "Workstation lock sequence initiated."
                }).encode('utf-8'))
                return
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode('utf-8'))
                return

        elif self.path in ('/cancel-lock', '/cancel_lock'):
            try:
                cancelled = cancel_delayed_lock()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': True,
                    'cancelled': cancelled,
                    'message': 'Scheduled lock cancelled.' if cancelled else 'No scheduled lock was active.'
                }).encode('utf-8'))
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
        elif self.path == '/api/browser_tabs':
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length).decode('utf-8')
                data = json.loads(body) if body else {}
                tabs = data.get('tabs', [])
                bname = data.get('browser', 'Chrome')
                global LATEST_BROWSER_TABS, LATEST_BROWSER_NAME, BROWSER_TABS_UPDATED_AT, PENDING_CLOSE_TABS
                with BROWSER_TABS_LOCK:
                    LATEST_BROWSER_TABS = tabs
                    LATEST_BROWSER_NAME = bname
                    BROWSER_TABS_UPDATED_AT = time.time()
                    to_close = list(PENDING_CLOSE_TABS)
                    PENDING_CLOSE_TABS.clear()

                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'ok', 'close_tabs': to_close}).encode('utf-8'))
                return
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
                return
        elif self.path in ('/api/install_extension', '/install-extension'):
            try:
                success, msg = install_extension_system_wide()
                self.send_response(200 if success else 500)
                self.end_headers()
                self.wfile.write(json.dumps({'success': success, 'message': msg}).encode('utf-8'))
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
        if self.path == '/version':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'version': AGENT_VERSION, 'status': 'ok'}).encode('utf-8'))
            return

        if self.path == '/api/browser_tabs':
            with BROWSER_TABS_LOCK:
                payload = json.dumps({'tabs': LATEST_BROWSER_TABS, 'browser': LATEST_BROWSER_NAME}).encode('utf-8')
            self.send_response(200)
            self.end_headers()
            self.wfile.write(payload)
            return

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
        elif clean_path == '/ComputerMonitor.7z':
            fname = 'ComputerMonitor.7z'
            ctype = 'application/x-7z-compressed'
        elif clean_path == '/ComputerMonitor.zip':
            fname = 'ComputerMonitor.zip'
            ctype = 'application/zip'
        elif clean_path in ('/extension/updates.xml', '/updates.xml'):
            fname = os.path.join('extension', 'updates.xml')
            ctype = 'application/xml; charset=utf-8'
        elif clean_path in ('/extension/extension.crx', '/extension.crx'):
            fname = 'extension.crx'
            ctype = 'application/x-chrome-extension'
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"error": "Not Found"}')
            return

        candidate_paths = [
            os.path.join(PROGRAM_DATA_DIR, 'extension', os.path.basename(fname)),
            os.path.join(BASE_DIR, 'extension', os.path.basename(fname)),
            os.path.join(PROGRAM_DATA_DIR, fname),
            os.path.join(BASE_DIR, fname),
            os.path.join(PROGRAM_DATA_DIR, os.path.basename(fname)),
            os.path.join(BASE_DIR, os.path.basename(fname)),
        ]
        file_path = None
        for cp in candidate_paths:
            if os.path.isfile(cp):
                file_path = cp
                break

        if file_path and os.path.exists(file_path):
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
