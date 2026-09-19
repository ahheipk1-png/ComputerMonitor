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

# Base directory where files live
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AGENT_EXE_PATH = os.path.join(BASE_DIR, EXE_NAME)


def run_cmd_hidden(cmd_list):
    """Run command without popping up any command prompt window."""
    flags = 0x08000000 if sys.platform == 'win32' else 0
    return subprocess.run(cmd_list, capture_output=True, text=True, creationflags=flags)


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("ComputerMonitor Control Center")
        self.geometry("480x560")
        self.resizable(False, False)
        self.configure(bg="#0f172a")

        # Custom styling
        self.style = ttk.Style()
        self.style.theme_use("clam")

        self.proc_running = False
        self.task_installed = False

        self.build_ui()
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

        # Open Dashboard Button
        btn_dash = tk.Button(actions_box, text="🌐 Open Website Dashboard", font=("Segoe UI", 9, "bold"), bg="#7c3aed", fg="#ffffff", activebackground="#6d28d9", activeforeground="#ffffff", relief="flat", pady=8, cursor="hand2", command=lambda: webbrowser.open(DASHBOARD_URL))
        btn_dash.pack(fill="x", pady=(8, 0))

        # Activity Log / Output Console
        log_box = tk.LabelFrame(body_frame, text=" Activity Log ", font=("Segoe UI", 9, "bold"), fg="#38bdf8", bg="#1e293b", padx=10, pady=8, bd=1, relief="solid")
        log_box.pack(fill="both", expand=True)

        self.txt_log = tk.Text(log_box, height=5, font=("Consolas", 8), bg="#090d16", fg="#a78bfa", bd=0, padx=8, pady=6, wrap="word")
        self.txt_log.pack(fill="both", expand=True)

        self.log("Control Center initialized. Checking status...")

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
        out = run_cmd_hidden(["schtasks", "/query", "/tn", TASK_NAME, "/fo", "list"])
        if out.returncode == 0:
            task_installed = True
            task_state = "Ready"
            for line in out.stdout.splitlines():
                if "Status:" in line:
                    task_state = line.split(":", 1)[1].strip()

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

        return proc_running, pids, task_installed, task_state, port_ok, latency

    def update_ui_status(self):
        proc_running, pids, task_installed, task_state, port_ok, latency = self.check_system_status()
        self.proc_running = proc_running
        self.task_installed = task_installed

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
            self.lbl_task_status.config(text=f"INSTALLED ({task_state})", fg="#10b981")
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

    def start_agent(self):
        target = AGENT_EXE_PATH if os.path.exists(AGENT_EXE_PATH) else os.path.join(BASE_DIR, "agent.py")
        self.log(f"Starting agent from {os.path.basename(target)}...")
        try:
            if target.endswith(".exe"):
                subprocess.Popen([target, "--background"], cwd=BASE_DIR, creationflags=0x08000000)
            else:
                subprocess.Popen([sys.executable, target, "--background"], cwd=BASE_DIR, creationflags=0x08000000)
            self.log("Agent process launched.")
            time.sleep(0.5)
            self.update_ui_status()
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
        self.log("Registering Windows Task Scheduler startup task...")
        exe_to_register = AGENT_EXE_PATH
        ps_cmd = (
            f"$action = New-ScheduledTaskAction -Execute '{exe_to_register}' -Argument '--background'; "
            f"$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME; "
            f"$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited; "
            f"$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; "
            f"Register-ScheduledTask -TaskName '{TASK_NAME}' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force; "
            f"Start-ScheduledTask -TaskName '{TASK_NAME}'"
        )
        res = run_cmd_hidden(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_cmd])
        if res.returncode == 0:
            self.log("Startup task successfully installed and started!")
            messagebox.showinfo("Success", "Windows Startup Task successfully registered!\nThe agent will now boot automatically with Windows.")
        else:
            self.log(f"Installation failed: {res.stderr}")
            messagebox.showerror("Task Scheduler Error", res.stderr or "Failed to install task.")
        self.update_ui_status()

    def uninstall_task(self):
        if not messagebox.askyesno("Confirm Removal", "Do you want to remove the startup task from Windows Task Scheduler?"):
            return
        self.log("Removing startup task from Windows Task Scheduler...")
        ps_cmd = f"Unregister-ScheduledTask -TaskName '{TASK_NAME}' -Confirm:$false -ErrorAction SilentlyContinue"
        res = run_cmd_hidden(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_cmd])
        self.log("Task removed.")
        self.update_ui_status()


def main():
    app = App()
    app.mainloop()


if __name__ == '__main__':
    main()
