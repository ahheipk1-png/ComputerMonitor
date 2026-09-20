#!/usr/bin/env python3
"""
ComputerMonitor Control Center GUI
Manage background agent process and Windows Task Scheduler with 1 click.
"""

import tkinter as tk
from tkinter import ttk, messagebox
import subprocess
import webbrowser
import threading
import urllib.request
import platform
import json
import os
import sys
import time

try:
    import psutil
except ImportError:
    psutil = None

EXE_NAME = "ComputerMonitorAgent.exe"
TASK_NAME = "ComputerMonitorAgent"
DASHBOARD_URL = "https://computermonitor.pages.dev"
METRICS_URL = "http://127.0.0.1:5500/metrics"
APP_VERSION = "4.6.0"
VERSION_CHECK_URL = "https://computermonitor.pages.dev/version.json"

# Base directory where files live (handle PyInstaller frozen mode)
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

AGENT_EXE_PATH = os.path.join(BASE_DIR, EXE_NAME)
PROGRAM_DATA_DIR = os.path.join(os.environ.get('ProgramData', 'C:\\ProgramData'), 'ComputerMonitor')


def is_admin():
    """Check if current process has Windows Administrator privileges."""
    try:
        import ctypes
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False


def get_config_dirs():
    """Return directories to check for config files (ProgramData first for system-wide configs)."""
    dirs = []
    if os.path.isdir(PROGRAM_DATA_DIR):
        dirs.append(PROGRAM_DATA_DIR)
    if os.path.isdir(BASE_DIR) and BASE_DIR not in dirs:
        dirs.append(BASE_DIR)
    return dirs


def get_local_ip():
    """Discover primary LAN Wi-Fi or Ethernet IP, filtering out VPN/virtual adapters."""
    vpn_keywords = ['surfshark', 'wireguard', 'openvpn', 'vethernet', 'tap', 'tun', 'docker', 'vmware', 'virtual', 'loopback', 'hyper-v']
    lan_keywords = ['wi-fi', 'wifi', 'wlan', 'ethernet', 'local area connection', 'en0', 'eth0', 'wlan0']

    try:
        if psutil:
            candidates = []
            for iface, addr_list in psutil.net_if_addrs().items():
                iface_lower = iface.lower()
                if any(vk in iface_lower for vk in vpn_keywords):
                    continue
                for a in addr_list:
                    import socket
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

    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


def ensure_agent_exe():
    """Ensure ComputerMonitorAgent.exe is available in BASE_DIR or ProgramData."""
    if os.path.exists(AGENT_EXE_PATH) and os.path.getsize(AGENT_EXE_PATH) > 1000000:
        return True

    # 1. Try extracting from PyInstaller bundle
    if hasattr(sys, '_MEIPASS'):
        bundled = os.path.join(sys._MEIPASS, EXE_NAME)
        if os.path.exists(bundled):
            try:
                import shutil
                shutil.copy2(bundled, AGENT_EXE_PATH)
                if os.path.exists(AGENT_EXE_PATH):
                    return True
            except Exception:
                pass

    # 2. Check if installed in ProgramData
    prog_agent = os.path.join(PROGRAM_DATA_DIR, EXE_NAME)
    if os.path.exists(prog_agent) and os.path.getsize(prog_agent) > 1000000:
        try:
            import shutil
            shutil.copy2(prog_agent, AGENT_EXE_PATH)
            return True
        except Exception:
            return True

    # 3. Try downloading from website with browser User-Agent header (avoids Cloudflare 403)
    try:
        url = f"{DASHBOARD_URL}/{EXE_NAME}"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        with urllib.request.urlopen(req, timeout=12) as resp, open(AGENT_EXE_PATH, 'wb') as out:
            out.write(resp.read())
        if os.path.exists(AGENT_EXE_PATH) and os.path.getsize(AGENT_EXE_PATH) > 1000000:
            return True
    except Exception:
        pass

    # 4. Fallback via PowerShell
    try:
        url = f"{DASHBOARD_URL}/{EXE_NAME}"
        ps_cmd = f"Invoke-WebRequest -Uri '{url}' -OutFile '{AGENT_EXE_PATH}'"
        run_cmd_hidden(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_cmd])
        if os.path.exists(AGENT_EXE_PATH) and os.path.getsize(AGENT_EXE_PATH) > 1000000:
            return True
    except Exception:
        pass

    return False


def run_cmd_hidden(cmd_list):
    """Run command without popping up any command prompt window."""
    flags = 0x08000000 if sys.platform == 'win32' else 0
    return subprocess.run(cmd_list, capture_output=True, text=True, creationflags=flags)


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


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("ComputerMonitor Control Center")
        self.geometry("480x630")
        self.resizable(False, False)
        self.configure(bg="#0f172a")

        # Custom styling
        self.style = ttk.Style()
        self.style.theme_use("clam")

        self.proc_running = False
        self.task_installed = False

        self.build_ui()
        threading.Thread(target=ensure_agent_exe, daemon=True).start()
        self.start_monitoring_thread()

    def build_ui(self):
        # Header
        header_frame = tk.Frame(self, bg="#1e293b", padx=20, pady=14)
        header_frame.pack(fill="x")

        title_lbl = tk.Label(header_frame, text="🖥️ ComputerMonitor", font=("Segoe UI", 15, "bold"), fg="#f8fafc", bg="#1e293b")
        title_lbl.pack(anchor="w")

        sub_lbl = tk.Label(header_frame, text="Service Manager & Windows Startup Controller", font=("Segoe UI", 8), fg="#94a3b8", bg="#1e293b")
        sub_lbl.pack(anchor="w")

        # Main Body Container
        body_frame = tk.Frame(self, bg="#0f172a", padx=20, pady=16)
        body_frame.pack(fill="both", expand=True)

        # Status Cards Container
        status_box = tk.LabelFrame(body_frame, text=" Live System Status ", font=("Segoe UI", 9, "bold"), fg="#38bdf8", bg="#1e293b", padx=14, pady=12, bd=1, relief="solid")
        status_box.pack(fill="x", pady=(0, 14))

        # 1. Process Status
        row1 = tk.Frame(status_box, bg="#1e293b")
        row1.pack(fill="x", pady=4)
        tk.Label(row1, text="Background Agent:", font=("Segoe UI", 9, "bold"), fg="#cbd5e1", bg="#1e293b", width=18, anchor="w").pack(side="left")
        self.lbl_proc_dot = tk.Label(row1, text="●", font=("Segoe UI", 12), fg="#f43f5e", bg="#1e293b")
        self.lbl_proc_dot.pack(side="left", padx=(0, 6))
        self.lbl_proc_status = tk.Label(row1, text="STOPPED", font=("Segoe UI", 9, "bold"), fg="#f43f5e", bg="#1e293b")
        self.lbl_proc_status.pack(side="left")

        # 2. Task Scheduler Status
        row2 = tk.Frame(status_box, bg="#1e293b")
        row2.pack(fill="x", pady=4)
        tk.Label(row2, text="Windows Startup Task:", font=("Segoe UI", 9, "bold"), fg="#cbd5e1", bg="#1e293b", width=18, anchor="w").pack(side="left")
        self.lbl_task_dot = tk.Label(row2, text="●", font=("Segoe UI", 12), fg="#f43f5e", bg="#1e293b")
        self.lbl_task_dot.pack(side="left", padx=(0, 6))
        self.lbl_task_status = tk.Label(row2, text="NOT INSTALLED", font=("Segoe UI", 9, "bold"), fg="#f43f5e", bg="#1e293b")
        self.lbl_task_status.pack(side="left")

        # 3. Telemetry Port Check
        row3 = tk.Frame(status_box, bg="#1e293b")
        row3.pack(fill="x", pady=4)
        tk.Label(row3, text="Port 5500 Endpoint:", font=("Segoe UI", 9, "bold"), fg="#cbd5e1", bg="#1e293b", width=18, anchor="w").pack(side="left")
        self.lbl_port_status = tk.Label(row3, text="Offline", font=("Segoe UI", 9), fg="#94a3b8", bg="#1e293b")
        self.lbl_port_status.pack(side="left", padx=(18, 0))

        # 4. Fleet Network Status
        row4 = tk.Frame(status_box, bg="#1e293b")
        row4.pack(fill="x", pady=4)
        tk.Label(row4, text="Fleet Network:", font=("Segoe UI", 9, "bold"), fg="#cbd5e1", bg="#1e293b", width=18, anchor="w").pack(side="left")
        self.fleet_id = get_fleet_id()
        self.lbl_fleet = tk.Label(row4, text=f"{self.fleet_id} (Cloud Synced)", font=("Segoe UI", 9, "bold"), fg="#10b981", bg="#1e293b", cursor="hand2")
        self.lbl_fleet.pack(side="left", padx=(18, 4))
        self.lbl_fleet.bind("<Button-1>", lambda e: self.open_dashboard())
        tk.Label(row4, text="(auto-linked)", font=("Segoe UI", 8), fg="#64748b", bg="#1e293b").pack(side="left")

        # 5. Computer Alias Name
        row5 = tk.Frame(status_box, bg="#1e293b")
        row5.pack(fill="x", pady=4)
        tk.Label(row5, text="Computer Alias:", font=("Segoe UI", 9, "bold"), fg="#cbd5e1", bg="#1e293b", width=18, anchor="w").pack(side="left")
        self.alias_val = tk.StringVar(value=get_computer_alias())
        self.ent_alias = tk.Entry(row5, textvariable=self.alias_val, font=("Segoe UI", 9), bg="#0f172a", fg="#ffffff", insertbackground="#ffffff", bd=1, relief="solid", width=18)
        self.ent_alias.pack(side="left", padx=(18, 6), ipady=1)
        self.ent_alias.bind("<Return>", lambda e: self.save_alias())
        self.btn_save_alias = tk.Button(row5, text="💾 Save", font=("Segoe UI", 8, "bold"), bg="#3b82f6", fg="#ffffff", activebackground="#2563eb", activeforeground="#ffffff", relief="flat", padx=6, pady=1, cursor="hand2", command=self.save_alias)
        self.btn_save_alias.pack(side="left")

        # 6. Fleet Version Status
        row6 = tk.Frame(status_box, bg="#1e293b")
        row6.pack(fill="x", pady=4)
        tk.Label(row6, text="Fleet Version:", font=("Segoe UI", 9, "bold"), fg="#cbd5e1", bg="#1e293b", width=18, anchor="w").pack(side="left")
        self.lbl_version_status = tk.Label(row6, text=f"v{APP_VERSION} (Checking...)", font=("Segoe UI", 9, "bold"), fg="#38bdf8", bg="#1e293b")
        self.lbl_version_status.pack(side="left", padx=(18, 6))
        self.btn_update_now = tk.Button(row6, text="⬇️ Update Now", font=("Segoe UI", 8, "bold"), bg="#f59e0b", fg="#0f172a", activebackground="#d97706", activeforeground="#000000", relief="flat", padx=6, pady=1, cursor="hand2", command=self.perform_update)

        # Actions Section
        actions_box = tk.LabelFrame(body_frame, text=" Actions & Controls ", font=("Segoe UI", 9, "bold"), fg="#38bdf8", bg="#1e293b", padx=14, pady=12, bd=1, relief="solid")
        actions_box.pack(fill="x", pady=(0, 14))

        btn_grid = tk.Frame(actions_box, bg="#1e293b")
        btn_grid.pack(fill="x")

        # Row A: Process Start / Stop
        self.btn_start = tk.Button(btn_grid, text="▶ Start Agent", font=("Segoe UI", 9, "bold"), bg="#059669", fg="#ffffff", activebackground="#047857", activeforeground="#ffffff", relief="flat", padx=10, pady=8, cursor="hand2", command=self.start_agent)
        self.btn_start.grid(row=0, column=0, sticky="ew", padx=(0, 6), pady=4)

        self.btn_stop = tk.Button(btn_grid, text="⏹ Stop Agent", font=("Segoe UI", 9, "bold"), bg="#e11d48", fg="#ffffff", activebackground="#be123c", activeforeground="#ffffff", relief="flat", padx=10, pady=8, cursor="hand2", command=self.stop_agent)
        self.btn_stop.grid(row=0, column=1, sticky="ew", padx=(6, 0), pady=4)

        # Row B: Task Scheduler Install / Uninstall
        self.btn_install = tk.Button(btn_grid, text="⚙ Install Startup Task", font=("Segoe UI", 9, "bold"), bg="#0284c7", fg="#ffffff", activebackground="#0369a1", activeforeground="#ffffff", relief="flat", padx=10, pady=8, cursor="hand2", command=self.install_task)
        self.btn_install.grid(row=1, column=0, sticky="ew", padx=(0, 6), pady=4)

        self.btn_uninstall = tk.Button(btn_grid, text="🗑 Remove Startup Task", font=("Segoe UI", 9, "bold"), bg="#475569", fg="#ffffff", activebackground="#334155", activeforeground="#ffffff", relief="flat", padx=10, pady=8, cursor="hand2", command=self.uninstall_task)
        self.btn_uninstall.grid(row=1, column=1, sticky="ew", padx=(6, 0), pady=4)

        btn_grid.columnconfigure(0, weight=1)
        btn_grid.columnconfigure(1, weight=1)

        # Lock Workstation & Open Dashboard Buttons
        btn_action_row = tk.Frame(actions_box, bg="#1e293b")
        btn_action_row.pack(fill="x", pady=(8, 0))

        btn_lock = tk.Button(btn_action_row, text="🔒 Lock Workstation", font=("Segoe UI", 9, "bold"), bg="#4f46e5", fg="#ffffff", activebackground="#4338ca", activeforeground="#ffffff", relief="flat", pady=7, cursor="hand2", command=self.lock_workstation)
        btn_lock.pack(side="left", fill="x", expand=True, padx=(0, 4))

        btn_dash = tk.Button(btn_action_row, text="🌐 Open Dashboard", font=("Segoe UI", 9, "bold"), bg="#7c3aed", fg="#ffffff", activebackground="#6d28d9", activeforeground="#ffffff", relief="flat", pady=7, cursor="hand2", command=self.open_dashboard)
        btn_dash.pack(side="left", fill="x", expand=True, padx=(4, 0))

        # Stop Specific Process Section
        kill_box = tk.LabelFrame(body_frame, text=" Stop Specific Process ", font=("Segoe UI", 9, "bold"), fg="#38bdf8", bg="#1e293b", padx=12, pady=10, bd=1, relief="solid")
        kill_box.pack(fill="x", pady=(0, 14))

        kill_frame = tk.Frame(kill_box, bg="#1e293b")
        kill_frame.pack(fill="x")

        tk.Label(kill_frame, text="PID or Name:", font=("Segoe UI", 9), fg="#cbd5e1", bg="#1e293b").pack(side="left", padx=(0, 6))

        self.ent_kill = tk.Entry(kill_frame, font=("Segoe UI", 9), bg="#0f172a", fg="#ffffff", insertbackground="#ffffff", bd=1, relief="solid")
        self.ent_kill.pack(side="left", fill="x", expand=True, padx=(0, 8), ipady=3)
        self.ent_kill.bind("<Return>", lambda e: self.terminate_custom_process())

        btn_kill = tk.Button(kill_frame, text="🛑 Stop", font=("Segoe UI", 9, "bold"), bg="#be123c", fg="#ffffff", activebackground="#9f1239", activeforeground="#ffffff", relief="flat", padx=12, pady=4, cursor="hand2", command=self.terminate_custom_process)
        btn_kill.pack(side="right")

        # Activity Log / Output Console
        log_box = tk.LabelFrame(body_frame, text=" Activity Log ", font=("Segoe UI", 9, "bold"), fg="#38bdf8", bg="#1e293b", padx=10, pady=8, bd=1, relief="solid")
        log_box.pack(fill="both", expand=True)

        self.txt_log = tk.Text(log_box, height=5, font=("Consolas", 8), bg="#090d16", fg="#a78bfa", bd=0, padx=8, pady=6, wrap="word")
        self.txt_log.pack(fill="both", expand=True)

        self.log("Control Center initialized. Checking status...")
        self.start_version_checker()

    def start_version_checker(self):
        def loop():
            while True:
                try:
                    req = urllib.request.Request(
                        f"{VERSION_CHECK_URL}?_t={int(time.time())}",
                        headers={'User-Agent': f'ComputerMonitorControl/{APP_VERSION}'}
                    )
                    with urllib.request.urlopen(req, timeout=4) as resp:
                        data = json.loads(resp.read().decode('utf-8'))
                        cloud_ver = str(data.get('version', '')).strip()
                        if cloud_ver:
                            self.after(0, lambda v=cloud_ver: self.on_version_checked(v))
                except Exception:
                    pass
                time.sleep(120)

        threading.Thread(target=loop, daemon=True).start()

    def on_version_checked(self, cloud_ver):
        if cloud_ver == APP_VERSION:
            self.lbl_version_status.config(text=f"v{APP_VERSION} (Latest 🟢)", fg="#10b981")
            self.btn_update_now.pack_forget()
        else:
            self.lbl_version_status.config(text=f"v{APP_VERSION} (Update: v{cloud_ver} ⚠️)", fg="#f59e0b")
            self.btn_update_now.pack(side="left", padx=(18, 6))

    def perform_update(self):
        if not messagebox.askyesno("Update Agent", f"A new version of ComputerMonitor is available.\n\nWould you like to download and install the update now?"):
            return

        self.log("Starting update download from cloud...")
        self.btn_update_now.config(state="disabled", text="⏳ Updating...")

        def run_update():
            try:
                # 1. Download updated agent binary
                dl_url = f"{DASHBOARD_URL}/{EXE_NAME}"
                temp_exe = os.path.join(BASE_DIR, f"{EXE_NAME}.new")
                self.log(f"Downloading from {dl_url}...")
                urllib.request.urlretrieve(dl_url, temp_exe)

                # 2. Stop existing agent
                self.log("Stopping old agent...")
                self.stop_agent()
                time.sleep(1.0)

                # 3. Replace executable
                target_exe = os.path.join(BASE_DIR, EXE_NAME)
                old_backup = os.path.join(BASE_DIR, f"{EXE_NAME}.bak")
                if os.path.exists(target_exe):
                    try:
                        if os.path.exists(old_backup):
                            os.remove(old_backup)
                        os.rename(target_exe, old_backup)
                    except Exception:
                        pass
                os.rename(temp_exe, target_exe)

                # 4. If system-wide task exists in ProgramData, update that too
                if os.path.exists(PROGRAM_DATA_DIR):
                    pdata_target = os.path.join(PROGRAM_DATA_DIR, EXE_NAME)
                    try:
                        import shutil
                        shutil.copy2(target_exe, pdata_target)
                    except Exception:
                        pass

                self.log("Update installed successfully! Restarting agent...")
                self.start_agent()
                messagebox.showinfo("Update Complete", "ComputerMonitor Agent has been updated to the latest version!")
            except Exception as err:
                self.log(f"Update failed: {err}")
                messagebox.showerror("Update Error", f"Failed to update agent: {err}")
            finally:
                self.btn_update_now.config(state="normal", text="⬇️ Update Now")

        threading.Thread(target=run_update, daemon=True).start()

    def log(self, msg):
        timestamp = time.strftime("%H:%M:%S")
        self.txt_log.insert("end", f"[{timestamp}] {msg}\n")
        self.txt_log.see("end")

    def check_system_status(self):
        """Checks if process is running and if scheduled task is registered."""
        # 1. Process Check
        proc_running = False
        pids = []
        if psutil:
            for p in psutil.process_iter(['pid', 'name']):
                try:
                    if p.info['name'] in (EXE_NAME, "python.exe", "pythonw.exe"):
                        if p.info['name'] == EXE_NAME:
                            proc_running = True
                            pids.append(str(p.info['pid']))
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass

        # 2. Task Scheduler Check
        task_installed = False
        task_state = "Not Found"
        task_scope = "User"
        out = run_cmd_hidden(["schtasks", "/query", "/tn", TASK_NAME, "/fo", "list", "/v"])
        if out.returncode == 0:
            task_installed = True
            task_state = "Ready"
            for line in out.stdout.splitlines():
                if "Status:" in line:
                    task_state = line.split(":", 1)[1].strip()
                elif "Run As User:" in line:
                    u_val = line.split(":", 1)[1].strip()
                    if "SYSTEM" in u_val.upper():
                        task_scope = "All Accounts (SYSTEM)"
                    else:
                        task_scope = f"User ({u_val})"

        # 3. HTTP Port Check
        port_ok = False
        latency = 0
        try:
            t0 = time.perf_counter()
            with urllib.request.urlopen(METRICS_URL, timeout=1.2) as resp:
                if resp.status == 200:
                    port_ok = True
                    latency = round((time.perf_counter() - t0) * 1000)
        except Exception:
            port_ok = False

        return proc_running, pids, task_installed, task_state, task_scope, port_ok, latency

    def update_ui_status(self):
        proc_running, pids, task_installed, task_state, task_scope, port_ok, latency = self.check_system_status()
        self.proc_running = proc_running
        self.task_installed = task_installed
        self.task_scope = task_scope

        # Process UI
        if proc_running:
            self.lbl_proc_dot.config(fg="#10b981")
            self.lbl_proc_status.config(text=f"RUNNING (PID: {', '.join(pids)})", fg="#10b981")
            self.btn_start.config(state="disabled", bg="#334155")
            self.btn_stop.config(state="normal", bg="#e11d48")
        else:
            self.lbl_proc_dot.config(fg="#f43f5e")
            self.lbl_proc_status.config(text="STOPPED", fg="#f43f5e")
            self.btn_start.config(state="normal", bg="#059669")
            self.btn_stop.config(state="disabled", bg="#334155")

        # Task UI
        if task_installed:
            self.lbl_task_dot.config(fg="#10b981")
            task_text = f"ACTIVE ({task_state})"
            if "SYSTEM" in task_scope or "ALL ACCOUNTS" in task_scope.upper():
                task_text = f"{task_state.upper()} - ALL ACCOUNTS"
            self.lbl_task_status.config(text=task_text, fg="#10b981")
            self.btn_install.config(state="disabled", bg="#334155")
            self.btn_uninstall.config(state="normal", bg="#475569")
        else:
            self.lbl_task_dot.config(fg="#fbbf24")
            self.lbl_task_status.config(text="NOT INSTALLED", fg="#fbbf24")
            self.btn_install.config(state="normal", bg="#0284c7")
            self.btn_uninstall.config(state="disabled", bg="#334155")

        # Port UI
        if port_ok:
            self.lbl_port_status.config(text=f"Responding ({latency} ms) - Active", fg="#10b981")
        else:
            self.lbl_port_status.config(text="No listener (Agent stopped)", fg="#f43f5e")

    def start_monitoring_thread(self):
        def loop():
            while True:
                try:
                    self.after(0, self.update_ui_status)
                except Exception:
                    pass
                time.sleep(1.8)

        t = threading.Thread(target=loop, daemon=True)
        t.start()

    def copy_url_to_clipboard(self):
        try:
            ip = get_local_ip()
            url = f"http://{ip}:5500"
            self.my_url = url
            self.lbl_endpoint.config(text=url)
            self.clipboard_clear()
            self.clipboard_append(url)
            self.log(f"Copied {url} to clipboard!")
            messagebox.showinfo("Copied to Clipboard", f"Copied:\n{url}\n\n• On any other computer on your Wi-Fi:\n  Open this link directly in Chrome or Edge.\n\n• On the Cloudflare website:\n  Paste into 'Add Computer' or open:\n  {DASHBOARD_URL}/?ip={ip}")
        except Exception:
            pass

    def open_dashboard(self):
        fleet = get_fleet_id()
        url = f"{DASHBOARD_URL}/?fleet={fleet}"
        self.log(f"Opening fleet dashboard: {url}")
        webbrowser.open(url)

    def lock_workstation(self):
        try:
            if platform.system() == 'Windows':
                import ctypes
                ctypes.windll.user32.LockWorkStation()
                self.log("🔒 Workstation locked (returned to Windows login screen).")
            else:
                self.log("Lock is only supported natively on Windows.")
        except Exception as e:
            self.log(f"Lock error: {e}")

    def start_agent(self):
        if not ensure_agent_exe():
            self.log(f"Error: {EXE_NAME} not found and could not be retrieved.")
            messagebox.showerror("Agent Missing", f"Cannot find or download {EXE_NAME}.")
            return

        target = AGENT_EXE_PATH
        self.log(f"Starting agent: {os.path.basename(target)}...")
        try:
            subprocess.Popen([target, "--background"], cwd=BASE_DIR, creationflags=0x08000000)
            self.log("Agent process launched silently.")
            time.sleep(0.5)
            self.update_ui_status()
            threading.Thread(target=lambda: (time.sleep(1.0), self.open_dashboard()), daemon=True).start()
        except Exception as e:
            self.log(f"Error starting agent: {e}")
            messagebox.showerror("Start Error", str(e))

    def stop_agent(self):
        self.log("Stopping agent process and task...")
        try:
            # Stop scheduled task
            run_cmd_hidden(["powershell", "-Command", f"Stop-ScheduledTask -TaskName '{TASK_NAME}' -ErrorAction SilentlyContinue"])
            # Kill process
            run_cmd_hidden(["powershell", "-Command", f"Stop-Process -Name '{EXE_NAME.replace('.exe', '')}' -Force -ErrorAction SilentlyContinue"])
            self.log("Agent stopped.")
            time.sleep(0.5)
            self.update_ui_status()
        except Exception as e:
            self.log(f"Error stopping agent: {e}")

    def install_task(self):
        if not ensure_agent_exe():
            self.log(f"Error: {EXE_NAME} not found and could not be retrieved.")
            messagebox.showerror("Agent Missing", f"Cannot find or download {EXE_NAME}.")
            return

        self.log("Installing system-wide startup task for all accounts...")

        dest_dir = PROGRAM_DATA_DIR
        dest_agent = os.path.join(dest_dir, EXE_NAME)
        src_agent = AGENT_EXE_PATH
        src_fleet = os.path.join(BASE_DIR, 'fleet_id.txt')
        src_alias = os.path.join(BASE_DIR, 'alias.txt')

        # Elevated PowerShell installer script
        ps_script = f"""
$ErrorActionPreference = 'Stop'
$destDir = '{dest_dir}'
if (!(Test-Path $destDir)) {{
    New-Item -Path $destDir -ItemType Directory -Force | Out-Null
}}
Copy-Item '{src_agent}' -Destination '{dest_agent}' -Force
if (Test-Path '{src_fleet}') {{ Copy-Item '{src_fleet}' -Destination "$destDir\\fleet_id.txt" -Force }}
if (Test-Path '{src_alias}') {{ Copy-Item '{src_alias}' -Destination "$destDir\\alias.txt" -Force }}

Unregister-ScheduledTask -TaskName '{TASK_NAME}' -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute '{dest_agent}' -Argument '--background' -WorkingDirectory $destDir
$trigBoot = New-ScheduledTaskTrigger -AtStartup
$trigLogon = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 0) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName '{TASK_NAME}' -Action $action -Trigger @($trigBoot, $trigLogon) -Principal $principal -Settings $settings -Force
Start-ScheduledTask -TaskName '{TASK_NAME}'
"""
        if is_admin():
            res = run_cmd_hidden(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script])
        else:
            temp_ps1 = os.path.join(os.environ.get('TEMP', 'C:\\Temp'), 'cm_install_system_task.ps1')
            try:
                with open(temp_ps1, 'w', encoding='utf-8') as f:
                    f.write(ps_script)
                self.log("Requesting Administrator permission via UAC to register for all accounts...")
                elevated_cmd = f"Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"{temp_ps1}\"' -Verb RunAs -Wait"
                run_cmd_hidden(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", elevated_cmd])
                try:
                    os.remove(temp_ps1)
                except Exception:
                    pass
            except Exception as e:
                self.log(f"Elevation error: {e}")

        # Check result
        verify = run_cmd_hidden(["schtasks", "/query", "/tn", TASK_NAME, "/fo", "list", "/v"])
        if verify.returncode == 0:
            is_sys = "SYSTEM" in verify.stdout.upper()
            scope_str = "All Accounts (SYSTEM)" if is_sys else "Current User Account"
            self.log(f"Startup task installed successfully! Scope: {scope_str}")
            threading.Thread(target=lambda: (time.sleep(1.0), self.open_dashboard()), daemon=True).start()
            messagebox.showinfo(
                "Task Installed",
                f"✅ Windows Startup Task Successfully Registered!\n\n"
                f"• Scope: {scope_str}\n"
                f"• Boot: Runs automatically at system startup and for ANY account\n"
                f"• Resilient: 24/7 continuous background telemetry\n\n"
                f"Your computer is now synced with the web dashboard."
            )
        else:
            # Fallback if admin UAC was denied
            if messagebox.askyesno("Administrator Permission Required", "Administrator elevation was not granted for an all-accounts system task.\n\nWould you like to install the task for your current user account instead?"):
                user_ps = (
                    f"$action = New-ScheduledTaskAction -Execute '{src_agent}' -Argument '--background'; "
                    f"$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME; "
                    f"$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited; "
                    f"$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; "
                    f"Register-ScheduledTask -TaskName '{TASK_NAME}' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force; "
                    f"Start-ScheduledTask -TaskName '{TASK_NAME}'"
                )
                res = run_cmd_hidden(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", user_ps])
                if res.returncode == 0:
                    self.log("Task installed for current user account.")
                    messagebox.showinfo("Installed", "Installed for current user account.\n(To enable all accounts, right-click ComputerMonitorControl.exe and select 'Run as administrator').")
                else:
                    self.log(f"Installation failed: {res.stderr}")
                    messagebox.showerror("Error", res.stderr or "Failed to install task.")

        self.update_ui_status()

    def uninstall_task(self):
        if not messagebox.askyesno("Confirm Removal", "Do you want to remove the startup task from Windows Task Scheduler?"):
            return
        self.log("Removing startup task from Windows Task Scheduler...")
        ps_cmd = f"Unregister-ScheduledTask -TaskName '{TASK_NAME}' -Confirm:$false -ErrorAction SilentlyContinue; Stop-Process -Name '{EXE_NAME.replace('.exe', '')}' -Force -ErrorAction SilentlyContinue"
        if is_admin():
            res = run_cmd_hidden(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_cmd])
        else:
            elevated_cmd = f"Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command \"{ps_cmd}\"' -Verb RunAs -Wait"
            run_cmd_hidden(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", elevated_cmd])
        self.log("Task removed.")
        self.update_ui_status()

    def terminate_custom_process(self):
        val = self.ent_kill.get().strip()
        if not val:
            messagebox.showwarning("Input Required", "Please enter a Process Name (e.g. notepad.exe) or a numeric PID.")
            return

        PROTECTED = {
            'system', 'system idle process', 'registry', 'smss.exe', 'csrss.exe',
            'wininit.exe', 'services.exe', 'lsass.exe', 'svchost.exe', 'fontdrvhost.exe',
            'winlogon.exe', 'dwm.exe'
        }

        if val.lower() in PROTECTED:
            messagebox.showerror("Protected Process", f"Cannot terminate critical Windows system process '{val}'.")
            return

        if not messagebox.askyesno("Confirm Termination", f"Are you sure you want to stop process '{val}'?"):
            return

        self.log(f"Stopping process '{val}'...")
        try:
            # If numeric PID
            if val.isdigit():
                pid = int(val)
                p = psutil.Process(pid)
                pname = p.name()
                if pname.lower() in PROTECTED:
                    messagebox.showerror("Protected", f"Process {pname} (PID {pid}) is a protected system process.")
                    return
                p.terminate()
                try:
                    p.wait(timeout=1.0)
                except psutil.TimeoutExpired:
                    p.kill()
                self.log(f"Successfully stopped '{pname}' (PID {pid}).")
                messagebox.showinfo("Stopped", f"Successfully stopped '{pname}' (PID {pid}).")
            else:
                target = val.lower()
                killed = []
                for p in psutil.process_iter(['pid', 'name']):
                    try:
                        pname = (p.info['name'] or '').lower()
                        if pname == target or pname == f"{target}.exe":
                            if p.info['pid'] not in (0, 4) and p.info['pid'] != os.getpid():
                                proc_obj = psutil.Process(p.info['pid'])
                                proc_obj.terminate()
                                try:
                                    proc_obj.wait(timeout=0.8)
                                except psutil.TimeoutExpired:
                                    proc_obj.kill()
                                killed.append(p.info['pid'])
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass

                if killed:
                    self.log(f"Stopped {len(killed)} process(es) matching '{val}' (PIDs: {', '.join(map(str, killed))}).")
                    messagebox.showinfo("Stopped", f"Successfully stopped {len(killed)} process(es) matching '{val}'.")
                else:
                    self.log(f"No running process found matching '{val}'.")
                    messagebox.showwarning("Not Found", f"No running process found matching '{val}'.")

            self.ent_kill.delete(0, "end")
            self.update_ui_status()
        except Exception as e:
            self.log(f"Error terminating process: {e}")
            messagebox.showerror("Termination Error", str(e))

    def save_alias(self):
        new_alias = self.alias_val.get().strip()
        if not new_alias:
            new_alias = platform.node()
            self.alias_val.set(new_alias)
        saved = False
        for d in (PROGRAM_DATA_DIR, BASE_DIR):
            try:
                os.makedirs(d, exist_ok=True)
                with open(os.path.join(d, 'alias.txt'), 'w', encoding='utf-8') as f:
                    f.write(new_alias)
                saved = True
            except Exception:
                pass

        if saved:
            self.log(f"Computer alias saved as: '{new_alias}'")
            # Push immediately to local agent if listening
            try:
                req = urllib.request.Request(
                    "http://127.0.0.1:5500/alias",
                    data=json.dumps({"alias": new_alias}).encode('utf-8'),
                    headers={"Content-Type": "application/json"}
                )
                urllib.request.urlopen(req, timeout=1.0)
            except Exception:
                pass
            messagebox.showinfo("Alias Saved", f"Computer alias set to '{new_alias}'.\nTelemetry updates will now broadcast this name.")
        else:
            self.log(f"Failed to save alias to disk.")
            messagebox.showerror("Save Error", "Could not write alias to disk.")


def main():
    app = App()
    app.mainloop()


if __name__ == '__main__':
    main()
