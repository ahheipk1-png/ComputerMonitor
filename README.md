# ComputerMonitor 🖥️

A modern, high-tech, real-time computer hardware and system telemetry web dashboard.

Live automatic deployment via **Cloudflare Pages** and synchronized with GitHub.

---

## ⚡ Features
- **Processor (CPU) Telemetry:** Live utilization gauge, multi-core activity distribution (16 cores/threads), dynamic frequency scaling, and thermals.
- **Memory (RAM) Observer:** In-use vs. cached vs. free memory bars with memory pressure warnings.
- **Storage & Disk I/O:** Real-time read/write throughput meters and storage pool capacities.
- **Network Telemetry:** Active upload and download speedometers, latency ping monitor, and session throughput counters.
- **GPU & Graphics Metrics:** Core load, VRAM allocation, fan speed, and power draw.
- **Active Process Manager:** Real-time process listing with search filter and CPU/Memory sorting.
- **Dual Telemetry Mode:**
  - **Simulation Mode:** Runs standalone anywhere in the world on Cloudflare Pages edge CDN.
  - **Live Agent Mode:** Connects to a lightweight local Python agent (`agent.py`) to stream real hardware performance metrics from your machine.

---

## 🚀 Automatic Deployment on Cloudflare Pages

This website is designed for zero-configuration deployment to Cloudflare Pages:

1. Open your [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **Workers & Pages** &rarr; **Create application** &rarr; **Pages** &rarr; **Connect to Git**.
3. Select the repository **`ahheipk1-png/ComputerMonitor`**.
4. Configure Build Settings:
   - **Framework preset:** None / Static
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/` (or leave default root)
5. Click **Save and Deploy**.

> Cloudflare Pages will automatically deploy the site worldwide in seconds and update whenever a new commit is pushed to `main`!

---

## 🖥️ Running the Local Hardware Agent (Optional)

To pipe live stats from your actual computer directly into the web dashboard:

```bash
# 1. Install psutil for hardware telemetry
pip install psutil

# 2. Start the local telemetry server
python agent.py
```

Then, open your deployed Cloudflare website (or open `index.html` in your browser) and click the **"Local Agent (Live)"** toggle at the top!
