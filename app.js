/**
 * ComputerMonitor Fleet Telemetry Engine
 * Multi-Machine Cluster & Real-Time Observer
 */

// Default fleet configurations
const DEFAULT_NODES = [
  {
    id: 'node-win-01',
    name: 'Primary Workstation',
    os: 'Windows 11 Pro',
    osIcon: '🪟',
    cpuModel: 'Intel Core i9-13900K (16C/24T)',
    ramTotal: 32.0,
    endpoint: 'http://localhost:5500/metrics',
    status: 'online',
    ip: '192.168.1.100',
    uptime: 15502,
    cpu: 28,
    ram: 48,
    disk: 58,
    temp: 46,
    ping: 12,
    netDl: 84.2,
    netUl: 16.8,
    history: {
      cpu: new Array(30).fill(28),
      ram: new Array(30).fill(48),
      disk: new Array(30).fill(12),
      net: new Array(30).fill(40),
    },
    processes: [
      { pid: 4812, name: 'chrome.exe', cpu: 6.4, mem: 1420, io: '1.2 MB/s', status: 'running' },
      { pid: 1092, name: 'Code.exe (VSCode)', cpu: 4.8, mem: 980, io: '0.4 MB/s', status: 'running' },
      { pid: 8224, name: 'python.exe', cpu: 3.2, mem: 612, io: '8.4 MB/s', status: 'running' },
      { pid: 2190, name: 'Discord.exe', cpu: 1.5, mem: 430, io: '0.1 MB/s', status: 'running' },
      { pid: 904,  name: 'System Idle Process', cpu: 72.0, mem: 8, io: '0.0 MB/s', status: 'running' },
      { pid: 3340, name: 'Spotify.exe', cpu: 0.9, mem: 310, io: '0.2 MB/s', status: 'running' },
      { pid: 5612, name: 'explorer.exe', cpu: 0.7, mem: 240, io: '0.1 MB/s', status: 'sleeping' },
      { pid: 7780, name: 'docker-desktop.exe', cpu: 2.1, mem: 1840, io: '4.1 MB/s', status: 'running' },
    ]
  },
  {
    id: 'node-linux-02',
    name: 'Linux Compute Server',
    os: 'Ubuntu 22.04 LTS',
    osIcon: '🐧',
    cpuModel: 'AMD EPYC 7763 32-Core',
    ramTotal: 64.0,
    endpoint: 'http://192.168.1.150:5500/metrics',
    status: 'online',
    ip: '192.168.1.150',
    uptime: 849204,
    cpu: 64,
    ram: 72,
    disk: 44,
    temp: 58,
    ping: 18,
    netDl: 340.5,
    netUl: 180.2,
    history: {
      cpu: new Array(30).fill(64),
      ram: new Array(30).fill(72),
      disk: new Array(30).fill(45),
      net: new Array(30).fill(80),
    },
    processes: [
      { pid: 1402, name: 'dockerd', cpu: 24.1, mem: 4800, io: '42.0 MB/s', status: 'running' },
      { pid: 2198, name: 'postgres', cpu: 14.8, mem: 3200, io: '18.5 MB/s', status: 'running' },
      { pid: 3892, name: 'nginx worker', cpu: 3.4, mem: 380, io: '5.2 MB/s', status: 'running' },
      { pid: 4001, name: 'redis-server', cpu: 2.1, mem: 840, io: '1.8 MB/s', status: 'running' },
      { pid: 1,    name: 'systemd', cpu: 0.1, mem: 48, io: '0.0 MB/s', status: 'sleeping' },
    ]
  },
  {
    id: 'node-mac-03',
    name: 'MacBook Pro M3',
    os: 'macOS Sonoma',
    osIcon: '🍎',
    cpuModel: 'Apple M3 Max (14-core)',
    ramTotal: 36.0,
    endpoint: 'http://192.168.1.210:5500/metrics',
    status: 'online',
    ip: '192.168.1.210',
    uptime: 48200,
    cpu: 18,
    ram: 39,
    disk: 32,
    temp: 39,
    ping: 9,
    netDl: 52.4,
    netUl: 8.2,
    history: {
      cpu: new Array(30).fill(18),
      ram: new Array(30).fill(39),
      disk: new Array(30).fill(8),
      net: new Array(30).fill(25),
    },
    processes: [
      { pid: 812,  name: 'WindowServer', cpu: 4.2, mem: 850, io: '0.8 MB/s', status: 'running' },
      { pid: 1540, name: 'Xcode', cpu: 8.1, mem: 3400, io: '12.0 MB/s', status: 'running' },
      { pid: 3110, name: 'Safari', cpu: 2.4, mem: 1100, io: '0.3 MB/s', status: 'running' },
      { pid: 908,  name: 'Terminal', cpu: 0.2, mem: 120, io: '0.0 MB/s', status: 'sleeping' },
    ]
  },
  {
    id: 'node-office-04',
    name: 'Office AI / Gaming Rig',
    os: 'Windows 11 Home',
    osIcon: '⚡',
    cpuModel: 'AMD Ryzen 7 7800X3D',
    ramTotal: 32.0,
    endpoint: 'http://192.168.1.120:5500/metrics',
    status: 'online',
    ip: '192.168.1.120',
    uptime: 9400,
    cpu: 42,
    ram: 54,
    disk: 78,
    temp: 52,
    ping: 15,
    netDl: 112.0,
    netUl: 34.5,
    history: {
      cpu: new Array(30).fill(42),
      ram: new Array(30).fill(54),
      disk: new Array(30).fill(25),
      net: new Array(30).fill(50),
    },
    processes: [
      { pid: 6104, name: 'Ollama-daemon.exe', cpu: 28.5, mem: 8200, io: '14.0 MB/s', status: 'running' },
      { pid: 4120, name: 'Steam.exe', cpu: 1.2, mem: 490, io: '0.1 MB/s', status: 'running' },
      { pid: 8810, name: 'discord.exe', cpu: 1.8, mem: 380, io: '0.1 MB/s', status: 'running' },
    ]
  }
];

// App State
const state = {
  nodes: JSON.parse(localStorage.getItem('cm_fleet_nodes')) || DEFAULT_NODES,
  selectedNodeId: 'node-win-01',
  viewMode: 'detailed', // 'detailed' | 'fleet'
  mode: 'sim',          // 'sim' | 'agent'
  searchQuery: '',
  coreCount: 16,
};

// Canvas references
const canvases = {
  cpu: document.getElementById('cpu-chart'),
  ram: document.getElementById('ram-chart'),
  disk: document.getElementById('disk-chart'),
  net: document.getElementById('net-chart'),
};

// Get active node object
function getActiveNode() {
  return state.nodes.find(n => n.id === state.selectedNodeId) || state.nodes[0];
}

// Save nodes to localStorage
function saveNodes() {
  localStorage.setItem('cm_fleet_nodes', JSON.stringify(state.nodes));
}

// Render Fleet Bar
function renderFleetBar() {
  const container = document.getElementById('fleet-nodes-container');
  const countEl = document.getElementById('fleet-count');
  countEl.textContent = state.nodes.length;
  container.innerHTML = '';

  state.nodes.forEach(node => {
    const isSelected = node.id === state.selectedNodeId;
    const card = document.createElement('div');
    card.className = `fleet-node-card ${isSelected ? 'selected' : ''}`;
    card.dataset.id = node.id;
    card.innerHTML = `
      <div class="node-card-top">
        <div class="node-card-brand">
          <span class="node-os-icon">${node.osIcon || '🖥️'}</span>
          <span class="node-card-name" title="${node.name}">${node.name}</span>
        </div>
        <span class="node-status-pill ${node.status}">${node.status.toUpperCase()}</span>
      </div>
      <div class="node-card-stats">
        <div class="node-mini-stat">
          <span class="node-mini-lbl">CPU</span>
          <span class="node-mini-val ${node.cpu > 75 ? 'text-rose' : 'text-cyan'}">${node.cpu}%</span>
        </div>
        <div class="node-mini-stat">
          <span class="node-mini-lbl">RAM</span>
          <span class="node-mini-val text-purple">${node.ram}%</span>
        </div>
        <div class="node-mini-stat">
          <span class="node-mini-lbl">TEMP</span>
          <span class="node-mini-val text-emerald">${node.temp}°C</span>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      selectNode(node.id);
    });

    container.appendChild(card);
  });
}

// Render Comparison Fleet Grid View
function renderFleetComparisonGrid() {
  const grid = document.getElementById('comparison-grid');
  if (!grid) return;
  grid.innerHTML = '';

  state.nodes.forEach(node => {
    const card = document.createElement('div');
    card.className = 'comp-node-card';
    card.innerHTML = `
      <div class="comp-header">
        <div class="comp-title-block">
          <h3>${node.osIcon || '🖥️'} ${node.name}</h3>
          <p>${node.os} &bull; ${node.ip}</p>
        </div>
        <span class="node-status-pill ${node.status}">${node.status.toUpperCase()}</span>
      </div>

      <div class="comp-metrics-list">
        <div class="comp-metric-row">
          <div class="comp-metric-info">
            <span>CPU Usage (${node.cpuModel})</span>
            <span class="font-mono text-cyan">${node.cpu}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill fill-cyan" style="width: ${node.cpu}%;"></div>
          </div>
        </div>

        <div class="comp-metric-row">
          <div class="comp-metric-info">
            <span>Memory (${((node.ram / 100) * node.ramTotal).toFixed(1)} / ${node.ramTotal} GB)</span>
            <span class="font-mono text-purple">${node.ram}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill fill-purple" style="width: ${node.ram}%;"></div>
          </div>
        </div>

        <div class="comp-metric-row">
          <div class="comp-metric-info">
            <span>Disk Space Used</span>
            <span class="font-mono text-amber">${node.disk}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill fill-amber" style="width: ${node.disk}%;"></div>
          </div>
        </div>

        <div class="stat-row">
          <span class="stat-label">Core Thermals:</span>
          <span class="stat-value font-mono text-emerald">${node.temp} °C</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Network:</span>
          <span class="stat-value font-mono">↓ ${node.netDl} Mbps &bull; ↑ ${node.netUl} Mbps</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Ping Latency:</span>
          <span class="stat-value font-mono text-cyan">${node.ping} ms</span>
        </div>
      </div>

      <button class="btn-comp-drill" data-id="${node.id}">Drilldown Detailed Telemetry &rarr;</button>
    `;

    card.querySelector('.btn-comp-drill').addEventListener('click', () => {
      selectNode(node.id);
      switchViewMode('detailed');
    });

    grid.appendChild(card);
  });
}

// Select a specific computer node
function selectNode(nodeId) {
  state.selectedNodeId = nodeId;
  renderFleetBar();
  updateActiveNodeBanner();
  renderProcesses();
}

// Update Active Node Banner
function updateActiveNodeBanner() {
  const node = getActiveNode();
  document.getElementById('active-node-name').textContent = `${node.name}`;
  document.getElementById('active-node-desc').textContent = `${node.os} • ${node.cpuModel} • IP: ${node.ip}`;
  document.getElementById('meta-status').textContent = node.status.toUpperCase();
  document.getElementById('meta-uptime').textContent = formatUptime(node.uptime);
  document.getElementById('meta-ping').textContent = `${node.ping} ms`;
  document.getElementById('cpu-name').textContent = node.cpuModel;
  document.getElementById('proc-node-tag').textContent = node.name;
}

// Switch between Detailed and Fleet Grid view
function switchViewMode(mode) {
  state.viewMode = mode;
  const btnDetailed = document.getElementById('btn-view-detailed');
  const btnFleet = document.getElementById('btn-view-fleet');
  const detailedContainer = document.getElementById('detailed-telemetry-container');
  const fleetContainer = document.getElementById('fleet-comparison-view');

  if (mode === 'detailed') {
    btnDetailed.classList.add('active');
    btnFleet.classList.remove('active');
    detailedContainer.style.display = 'block';
    fleetContainer.style.display = 'none';
  } else {
    btnFleet.classList.add('active');
    btnDetailed.classList.remove('active');
    detailedContainer.style.display = 'none';
    fleetContainer.style.display = 'block';
    renderFleetComparisonGrid();
  }
}

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

// Sparkline Drawer
function drawSparkline(canvas, data, colorHex, glowHex) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const width = (canvas.width = canvas.parentElement.clientWidth);
  const height = (canvas.height = canvas.parentElement.clientHeight);

  ctx.clearRect(0, 0, width, height);
  if (data.length < 2) return;

  const step = width / (data.length - 1);
  const maxVal = 100;

  ctx.beginPath();
  data.forEach((val, i) => {
    const x = i * step;
    const y = height - (Math.min(Math.max(val, 0), maxVal) / maxVal) * (height - 8) - 4;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = colorHex;
  ctx.lineWidth = 2;
  ctx.shadowColor = glowHex;
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;

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
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  circle.style.strokeDashoffset = offset;
}

// Dynamic Process Rendering & Filtering
function renderProcesses() {
  const node = getActiveNode();
  const tbody = document.getElementById('proc-table-body');
  const countSpan = document.getElementById('proc-display-count');
  const query = state.searchQuery.toLowerCase();

  const procs = node.processes || [];
  const filtered = procs.filter(p => 
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

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

// Simulation Tick for all Fleet computers
function simulateFleet() {
  state.nodes.forEach(node => {
    node.uptime++;

    // Simulated variation based on node profile
    const jitter = randRange(-4, 4);
    node.cpu = Math.min(Math.max(Math.round(node.cpu + jitter), 8), 98);
    node.ram = Math.min(Math.max(Math.round(node.ram + randRange(-1, 1)), 20), 92);
    node.temp = Math.round(36 + (node.cpu / 100) * 34);
    node.ping = Math.max(5, Math.round(node.ping + randRange(-1, 1)));
    node.netDl = +(node.netDl + randRange(-3, 4)).toFixed(1);
    node.netUl = +(node.netUl + randRange(-1, 2)).toFixed(1);

    if (!node.history) {
      node.history = {
        cpu: new Array(30).fill(node.cpu),
        ram: new Array(30).fill(node.ram),
        disk: new Array(30).fill(15),
        net: new Array(30).fill(40),
      };
    }

    node.history.cpu.shift();
    node.history.cpu.push(node.cpu);
    node.history.ram.shift();
    node.history.ram.push(node.ram);
    node.history.disk.shift();
    node.history.disk.push(Math.min(node.disk, 100));
    node.history.net.shift();
    node.history.net.push(Math.min(node.netDl / 4, 100));

    // Process jitter
    if (node.processes) {
      node.processes.forEach(p => {
        if (p.name !== 'System Idle Process') {
          p.cpu = Math.max(0.1, +(p.cpu + randRange(-0.3, 0.3)).toFixed(1));
        }
      });
    }
  });

  renderFleetBar();

  if (state.viewMode === 'fleet') {
    renderFleetComparisonGrid();
    return;
  }

  // Update currently selected node details
  const active = getActiveNode();
  document.getElementById('cpu-percentage').textContent = `${active.cpu}%`;
  document.getElementById('cpu-avg').textContent = `Avg: ${active.cpu}%`;
  setRadialGauge('cpu-circle', active.cpu);

  const ghz = (3.2 + (active.cpu / 100) * 1.8).toFixed(2);
  document.getElementById('cpu-freq').textContent = `${ghz} GHz`;
  document.getElementById('cpu-temp').textContent = `${active.temp} °C`;
  document.getElementById('meta-uptime').textContent = formatUptime(active.uptime);
  document.getElementById('meta-ping').textContent = `${active.ping} ms`;

  // Cores
  for (let i = 0; i < state.coreCount; i++) {
    const coreVal = Math.min(Math.max(Math.round(active.cpu + randRange(-16, 18)), 2), 100);
    const el = document.getElementById(`core-fill-${i}`);
    if (el) el.style.height = `${coreVal}%`;
  }

  // RAM
  const ramTotal = active.ramTotal || 32.0;
  const ramUsed = ((active.ram / 100) * ramTotal).toFixed(1);
  const ramFree = (ramTotal - ramUsed).toFixed(1);

  document.getElementById('ram-percentage').textContent = `${active.ram}%`;
  setRadialGauge('ram-circle', active.ram);
  document.getElementById('ram-used').textContent = `${ramUsed} GB`;
  document.getElementById('ram-free').textContent = `${ramFree} GB`;
  document.getElementById('ram-summary-txt').textContent = `${ramUsed} GB / ${ramTotal} GB`;
  document.getElementById('ram-seg-used').style.width = `${active.ram}%`;

  // Disk & Network
  const readRate = (randRange(20, 240)).toFixed(1);
  const writeRate = (randRange(5, 75)).toFixed(1);
  document.getElementById('disk-read-rate').textContent = `${readRate} MB/s`;
  document.getElementById('disk-write-rate').textContent = `${writeRate} MB/s`;
  document.getElementById('net-dl-speed').textContent = active.netDl;
  document.getElementById('net-ul-speed').textContent = active.netUl;

  renderProcesses();

  // Draw Charts for active node (theme-aware colors)
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const cyan = isDark ? '#38bdf8' : '#0284c7';
  const cyanGlow = isDark ? 'rgba(56, 189, 248, 0.25)' : 'rgba(2, 132, 199, 0.18)';
  const purple = isDark ? '#a78bfa' : '#7c3aed';
  const purpleGlow = isDark ? 'rgba(167, 139, 250, 0.25)' : 'rgba(124, 58, 237, 0.18)';
  const amber = isDark ? '#fbbf24' : '#d97706';
  const amberGlow = isDark ? 'rgba(251, 191, 36, 0.25)' : 'rgba(217, 119, 6, 0.18)';
  const emerald = isDark ? '#34d399' : '#059669';
  const emeraldGlow = isDark ? 'rgba(52, 211, 153, 0.25)' : 'rgba(5, 150, 105, 0.18)';

  drawSparkline(canvases.cpu, active.history.cpu, cyan, cyanGlow);
  drawSparkline(canvases.ram, active.history.ram, purple, purpleGlow);
  drawSparkline(canvases.disk, active.history.disk, amber, amberGlow);
  drawSparkline(canvases.net, active.history.net, emerald, emeraldGlow);
}

// Live Local Agent Fetcher
async function fetchLocalAgentMetrics() {
  const active = getActiveNode();
  try {
    const res = await fetch(active.endpoint || 'http://localhost:5500/metrics', {
      method: 'GET',
      signal: AbortSignal.timeout(1200)
    });
    if (!res.ok) throw new Error('Agent HTTP error');
    const data = await res.json();

    active.status = 'online';
    document.getElementById('connection-status').className = 'connection-status online';
    document.getElementById('status-text').textContent = `${active.name} (Live)`;

    if (data.hostname) active.name = data.hostname;
    if (data.cpu !== undefined) active.cpu = Math.round(data.cpu);
    if (data.ram) {
      active.ram = Math.round(data.ram.percent);
      active.ramTotal = data.ram.total_gb;
    }
    if (data.processes && data.processes.length) active.processes = data.processes;

    simulateFleet();
  } catch (err) {
    document.getElementById('connection-status').className = 'connection-status';
    document.getElementById('status-text').textContent = `${active.name} (Offline - Simulating)`;
    simulateFleet();
  }
}

// Master Loop
function loop() {
  if (state.mode === 'sim') {
    simulateFleet();
  } else {
    fetchLocalAgentMetrics();
  }
}

// Theme Manager
function initTheme() {
  const savedTheme = localStorage.getItem('cm_theme') || 'light';
  applyTheme(savedTheme);
}

function applyTheme(theme) {
  const btnIcon = document.getElementById('theme-toggle-icon');
  const btnText = document.getElementById('theme-toggle-text');
  
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    if (btnIcon) btnIcon.textContent = '☀️';
    if (btnText) btnText.textContent = 'Light Mode';
  } else {
    document.documentElement.removeAttribute('data-theme');
    if (btnIcon) btnIcon.textContent = '🌙';
    if (btnText) btnText.textContent = 'Dark Mode';
  }
  localStorage.setItem('cm_theme', theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
}

// UI Event Listeners & Modals
function setupEvents() {
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', toggleTheme);
  }

  const btnDetailed = document.getElementById('btn-view-detailed');
  const btnFleet = document.getElementById('btn-view-fleet');
  const btnSim = document.getElementById('btn-mode-sim');
  const btnAgent = document.getElementById('btn-mode-agent');
  const searchInput = document.getElementById('proc-search');

  btnDetailed.addEventListener('click', () => switchViewMode('detailed'));
  btnFleet.addEventListener('click', () => switchViewMode('fleet'));

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

  // Add Node Modal
  const addModal = document.getElementById('add-node-modal');
  const btnAddNode = document.getElementById('btn-add-node');
  const btnCloseAddModal = document.getElementById('add-node-modal-close');
  const btnCancelNode = document.getElementById('btn-cancel-node');
  const addForm = document.getElementById('add-node-form');

  btnAddNode.addEventListener('click', () => addModal.classList.add('active'));
  btnCloseAddModal.addEventListener('click', () => addModal.classList.remove('active'));
  btnCancelNode.addEventListener('click', () => addModal.classList.remove('active'));

  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('node-input-name').value.trim();
    const os = document.getElementById('node-input-os').value;
    const url = document.getElementById('node-input-url').value.trim();

    let icon = '🖥️';
    if (os.includes('Windows')) icon = '🪟';
    else if (os.includes('macOS')) icon = '🍎';
    else if (os.includes('Linux') || os.includes('Ubuntu')) icon = '🐧';

    const newNode = {
      id: `node-custom-${Date.now()}`,
      name: name,
      os: os,
      osIcon: icon,
      cpuModel: `${os} CPU`,
      ramTotal: 16.0,
      endpoint: url,
      status: 'online',
      ip: url.replace('http://', '').split(':')[0] || '192.168.1.X',
      uptime: 100,
      cpu: 25,
      ram: 45,
      disk: 50,
      temp: 42,
      ping: 15,
      netDl: 50.0,
      netUl: 10.0,
      history: {
        cpu: new Array(30).fill(25),
        ram: new Array(30).fill(45),
        disk: new Array(30).fill(15),
        net: new Array(30).fill(30),
      },
      processes: [
        { pid: 1001, name: 'system_daemon', cpu: 1.2, mem: 140, io: '0.1 MB/s', status: 'running' }
      ]
    };

    state.nodes.push(newNode);
    saveNodes();
    selectNode(newNode.id);
    addModal.classList.remove('active');
    addForm.reset();
  });

  // Agent Modal
  const agentModal = document.getElementById('agent-modal');
  const btnHelp = document.getElementById('btn-agent-help');
  const btnCloseAgent = document.getElementById('modal-close');

  if (btnHelp) {
    btnHelp.addEventListener('click', (e) => {
      e.preventDefault();
      agentModal.classList.add('active');
    });
  }

  if (btnCloseAgent) {
    btnCloseAgent.addEventListener('click', () => {
      agentModal.classList.remove('active');
    });
  }

  window.addEventListener('resize', () => {
    const active = getActiveNode();
    drawSparkline(canvases.cpu, active.history.cpu, '#38bdf8', 'rgba(56, 189, 248, 0.3)');
    drawSparkline(canvases.ram, active.history.ram, '#a78bfa', 'rgba(167, 139, 250, 0.3)');
    drawSparkline(canvases.disk, active.history.disk, '#fbbf24', 'rgba(251, 191, 36, 0.3)');
    drawSparkline(canvases.net, active.history.net, '#34d399', 'rgba(52, 211, 153, 0.3)');
  });
}

// App Entry Point
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initCores();
  setupEvents();
  renderFleetBar();
  updateActiveNodeBanner();
  renderProcesses();
  loop();

  setInterval(loop, 1200);
});
