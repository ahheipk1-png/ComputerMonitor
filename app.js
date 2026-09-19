/**
 * ComputerMonitor Telemetry Engine
 * Supports Simulated Mode & Live Local Agent Telemetry
 */

// State Management
const state = {
  mode: 'sim', // 'sim' | 'agent'
  agentConnected: false,
  agentUrl: 'http://localhost:5500/metrics',
  historyLength: 30,
  history: {
    cpu: new Array(30).fill(25),
    ram: new Array(30).fill(48),
    disk: new Array(30).fill(10),
    net: new Array(30).fill(40),
  },
  uptimeSeconds: 15502,
  coreCount: 16,
  cores: new Array(16).fill(25),
  processes: [
    { pid: 4812, name: 'chrome.exe', cpu: 6.4, mem: 1420, io: '1.2 MB/s', status: 'running' },
    { pid: 1092, name: 'Code.exe (VSCode)', cpu: 4.8, mem: 980, io: '0.4 MB/s', status: 'running' },
    { pid: 8224, name: 'python.exe', cpu: 3.2, mem: 612, io: '8.4 MB/s', status: 'running' },
    { pid: 2190, name: 'Discord.exe', cpu: 1.5, mem: 430, io: '0.1 MB/s', status: 'running' },
    { pid: 904,  name: 'System Idle Process', cpu: 72.0, mem: 8, io: '0.0 MB/s', status: 'running' },
    { pid: 3340, name: 'Spotify.exe', cpu: 0.9, mem: 310, io: '0.2 MB/s', status: 'running' },
    { pid: 5612, name: 'explorer.exe', cpu: 0.7, mem: 240, io: '0.1 MB/s', status: 'sleeping' },
    { pid: 7780, name: 'docker-desktop.exe', cpu: 2.1, mem: 1840, io: '4.1 MB/s', status: 'running' },
    { pid: 1456, name: 'Terminal.exe', cpu: 0.3, mem: 95, io: '0.0 MB/s', status: 'sleeping' },
    { pid: 6632, name: 'dwm.exe (Desktop Window)', cpu: 1.8, mem: 180, io: '0.0 MB/s', status: 'running' },
  ],
  searchQuery: '',
};

// Canvas references
const canvases = {
  cpu: document.getElementById('cpu-chart'),
  ram: document.getElementById('ram-chart'),
  disk: document.getElementById('disk-chart'),
  net: document.getElementById('net-chart'),
};

// Initialize Cores Grid
function initCores() {
  const grid = document.getElementById('cores-grid');
  grid.innerHTML = '';
  for (let i = 0; i < state.coreCount; i++) {
    const wrapper = document.createElement('div');
    wrapper.className = 'core-bar-wrapper';
    wrapper.innerHTML = `
      <div class="core-track">
        <div class="core-fill" id="core-fill-${i}" style="height: 20%;"></div>
      </div>
      <span class="core-lbl">C${i + 1}</span>
    `;
    grid.appendChild(wrapper);
  }
}

// Uptime Ticker
function formatUptime(secs) {
  const hrs = Math.floor(secs / 3600).toString().padStart(2, '0');
  const mins = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${hrs}:${mins}:${s}`;
}

function updateUptime() {
  state.uptimeSeconds++;
  document.getElementById('meta-uptime').textContent = formatUptime(state.uptimeSeconds);
}

// Sparkline Drawer with Glow Gradient
function drawSparkline(canvas, data, colorHex, glowHex) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const width = (canvas.width = canvas.parentElement.clientWidth);
  const height = (canvas.height = canvas.parentElement.clientHeight);

  ctx.clearRect(0, 0, width, height);

  if (data.length < 2) return;

  const step = width / (data.length - 1);
  const maxVal = 100;

  // Path
  ctx.beginPath();
  data.forEach((val, i) => {
    const x = i * step;
    const y = height - (Math.min(Math.max(val, 0), maxVal) / maxVal) * (height - 8) - 4;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  // Stroke Line
  ctx.strokeStyle = colorHex;
  ctx.lineWidth = 2;
  ctx.shadowColor = glowHex;
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Fill gradient underneath
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, glowHex);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fill();
}

// Render Radial Gauges
function setRadialGauge(elementId, percent) {
  const circle = document.getElementById(elementId);
  if (!circle) return;
  const radius = 50;
  const circumference = 2 * Math.PI * radius; // ~314.159
  const offset = circumference - (percent / 100) * circumference;
  circle.style.strokeDashoffset = offset;
}

// Dynamic Process Rendering & Filtering
function renderProcesses() {
  const tbody = document.getElementById('proc-table-body');
  const countSpan = document.getElementById('proc-display-count');
  const query = state.searchQuery.toLowerCase();

  const filtered = state.processes.filter(p => 
    p.name.toLowerCase().includes(query) || p.pid.toString().includes(query)
  );

  countSpan.textContent = `Showing ${filtered.length} processes`;
  tbody.innerHTML = '';

  filtered.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.pid}</td>
      <td class="proc-name-cell">
        <span class="proc-icon"></span>
        <span>${p.name}</span>
      </td>
      <td class="font-mono ${p.cpu > 15 ? 'text-amber' : ''}">${p.cpu.toFixed(1)}%</td>
      <td class="font-mono">${p.mem > 1024 ? (p.mem / 1024).toFixed(2) + ' GB' : p.mem + ' MB'}</td>
      <td class="font-mono">${p.io}</td>
      <td><span class="status-badge ${p.status}">${p.status}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// Random float generator within range
function randRange(min, max) {
  return min + Math.random() * (max - min);
}

// Simulation Tick
function simulateTelemetry() {
  // 1. CPU Simulation
  const baseCpu = 22 + Math.sin(Date.now() / 3000) * 12 + randRange(-5, 8);
  const cpuPercent = Math.min(Math.max(Math.round(baseCpu), 4), 98);
  
  document.getElementById('cpu-percentage').textContent = `${cpuPercent}%`;
  document.getElementById('cpu-avg').textContent = `Avg: ${cpuPercent}%`;
  setRadialGauge('cpu-circle', cpuPercent);

  // Dynamic Frequency & Temp
  const ghz = (3.4 + (cpuPercent / 100) * 1.6).toFixed(2);
  document.getElementById('cpu-freq').textContent = `${ghz} GHz`;
  const temp = Math.round(38 + (cpuPercent / 100) * 32);
  document.getElementById('cpu-temp').textContent = `${temp} °C`;

  // Cores
  for (let i = 0; i < state.coreCount; i++) {
    const coreVal = Math.min(Math.max(Math.round(cpuPercent + randRange(-18, 22)), 2), 100);
    const el = document.getElementById(`core-fill-${i}`);
    if (el) el.style.height = `${coreVal}%`;
  }

  // 2. RAM Simulation
  const ramPercent = Math.min(Math.max(Math.round(48 + Math.sin(Date.now() / 15000) * 4), 30), 85);
  const ramTotal = 32.0;
  const ramUsed = ((ramPercent / 100) * ramTotal).toFixed(1);
  const ramFree = (ramTotal - ramUsed).toFixed(1);

  document.getElementById('ram-percentage').textContent = `${ramPercent}%`;
  setRadialGauge('ram-circle', ramPercent);
  document.getElementById('ram-used').textContent = `${ramUsed} GB`;
  document.getElementById('ram-free').textContent = `${ramFree} GB`;
  document.getElementById('ram-summary-txt').textContent = `${ramUsed} GB / ${ramTotal} GB`;
  document.getElementById('ram-seg-used').style.width = `${ramPercent}%`;

  // 3. Disk Rates
  const readRate = (randRange(20, 240)).toFixed(1);
  const writeRate = (randRange(5, 75)).toFixed(1);
  document.getElementById('disk-read-rate').textContent = `${readRate} MB/s`;
  document.getElementById('disk-write-rate').textContent = `${writeRate} MB/s`;

  // 4. Network
  const dl = (randRange(35, 120)).toFixed(1);
  const ul = (randRange(8, 28)).toFixed(1);
  document.getElementById('net-dl-speed').textContent = dl;
  document.getElementById('net-ul-speed').textContent = ul;
  const ping = Math.round(randRange(11, 24));
  document.getElementById('net-ping').textContent = `Latency: ${ping} ms`;

  // 5. GPU
  const gpuL = Math.min(Math.max(Math.round(30 + Math.cos(Date.now() / 4000) * 20), 5), 98);
  document.getElementById('gpu-load').textContent = `${gpuL}%`;
  document.getElementById('gpu-load-bar').style.width = `${gpuL}%`;
  document.getElementById('gpu-temp-badge').textContent = `${Math.round(52 + (gpuL / 100) * 20)} °C`;

  // Push to history charts
  state.history.cpu.shift();
  state.history.cpu.push(cpuPercent);

  state.history.ram.shift();
  state.history.ram.push(ramPercent);

  state.history.disk.shift();
  state.history.disk.push(Math.min((parseFloat(readRate) + parseFloat(writeRate)) / 3, 100));

  state.history.net.shift();
  state.history.net.push(Math.min(parseFloat(dl), 100));

  // Slight process jitter
  state.processes.forEach(p => {
    if (p.name !== 'System Idle Process') {
      p.cpu = Math.max(0.1, +(p.cpu + randRange(-0.4, 0.4)).toFixed(1));
    }
  });
  renderProcesses();

  // Draw Charts
  drawSparkline(canvases.cpu, state.history.cpu, '#38bdf8', 'rgba(56, 189, 248, 0.3)');
  drawSparkline(canvases.ram, state.history.ram, '#a78bfa', 'rgba(167, 139, 250, 0.3)');
  drawSparkline(canvases.disk, state.history.disk, '#fbbf24', 'rgba(251, 191, 36, 0.3)');
  drawSparkline(canvases.net, state.history.net, '#34d399', 'rgba(52, 211, 153, 0.3)');
}

// Live Agent Fetcher
async function fetchLocalAgentMetrics() {
  try {
    const res = await fetch(state.agentUrl, { method: 'GET', signal: AbortSignal.timeout(1200) });
    if (!res.ok) throw new Error('Agent HTTP error');
    const data = await res.json();

    state.agentConnected = true;
    document.getElementById('connection-status').className = 'connection-status online';
    document.getElementById('status-text').textContent = 'Agent Syncing (Live)';

    // Update real metrics
    if (data.hostname) document.getElementById('meta-host').textContent = data.hostname;
    if (data.os) document.getElementById('meta-os').textContent = data.os;

    if (data.cpu !== undefined) {
      const cpuVal = Math.round(data.cpu);
      document.getElementById('cpu-percentage').textContent = `${cpuVal}%`;
      setRadialGauge('cpu-circle', cpuVal);
      state.history.cpu.shift();
      state.history.cpu.push(cpuVal);
    }

    if (data.ram) {
      const ramVal = Math.round(data.ram.percent);
      document.getElementById('ram-percentage').textContent = `${ramVal}%`;
      setRadialGauge('ram-circle', ramVal);
      document.getElementById('ram-used').textContent = `${data.ram.used_gb} GB`;
      document.getElementById('ram-free').textContent = `${data.ram.free_gb} GB`;
      document.getElementById('ram-summary-txt').textContent = `${data.ram.used_gb} GB / ${data.ram.total_gb} GB`;
      document.getElementById('ram-seg-used').style.width = `${ramVal}%`;
      state.history.ram.shift();
      state.history.ram.push(ramVal);
    }

    if (data.processes && data.processes.length) {
      state.processes = data.processes;
      renderProcesses();
    }

    // Redraw charts
    drawSparkline(canvases.cpu, state.history.cpu, '#38bdf8', 'rgba(56, 189, 248, 0.3)');
    drawSparkline(canvases.ram, state.history.ram, '#a78bfa', 'rgba(167, 139, 250, 0.3)');
  } catch (err) {
    state.agentConnected = false;
    document.getElementById('connection-status').className = 'connection-status';
    document.getElementById('status-text').textContent = 'Agent Offline (Falling back)';
    // Fall back to simulation
    simulateTelemetry();
  }
}

// Master Loop
function loop() {
  if (state.mode === 'sim') {
    simulateTelemetry();
  } else {
    fetchLocalAgentMetrics();
  }
}

// UI Event Listeners
function setupEvents() {
  const btnSim = document.getElementById('btn-mode-sim');
  const btnAgent = document.getElementById('btn-mode-agent');
  const searchInput = document.getElementById('proc-search');

  btnSim.addEventListener('click', () => {
    state.mode = 'sim';
    btnSim.classList.add('active');
    btnAgent.classList.remove('active');
    document.getElementById('connection-status').className = 'connection-status online';
    document.getElementById('status-text').textContent = 'Active (1000ms)';
  });

  btnAgent.addEventListener('click', () => {
    state.mode = 'agent';
    btnAgent.classList.add('active');
    btnSim.classList.remove('active');
    document.getElementById('status-text').textContent = 'Connecting agent...';
    fetchLocalAgentMetrics();
  });

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderProcesses();
  });

  // Modal
  const modal = document.getElementById('agent-modal');
  const btnHelp = document.getElementById('btn-agent-help');
  const btnClose = document.getElementById('modal-close');

  if (btnHelp) {
    btnHelp.addEventListener('click', (e) => {
      e.preventDefault();
      modal.classList.add('active');
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      modal.classList.remove('active');
    });
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('active');
  });

  window.addEventListener('resize', () => {
    drawSparkline(canvases.cpu, state.history.cpu, '#38bdf8', 'rgba(56, 189, 248, 0.3)');
    drawSparkline(canvases.ram, state.history.ram, '#a78bfa', 'rgba(167, 139, 250, 0.3)');
    drawSparkline(canvases.disk, state.history.disk, '#fbbf24', 'rgba(251, 191, 36, 0.3)');
    drawSparkline(canvases.net, state.history.net, '#34d399', 'rgba(52, 211, 153, 0.3)');
  });
}

// App Entry Point
window.addEventListener('DOMContentLoaded', () => {
  initCores();
  renderProcesses();
  setupEvents();
  loop();

  setInterval(updateUptime, 1000);
  setInterval(loop, 1200);
});
