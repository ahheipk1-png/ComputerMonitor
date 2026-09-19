/**
 * ComputerMonitor Telemetry Engine
 * 100% Real Hardware Data - Zero Simulated / Dummy Data
 */

// Default clean node setup (Only real machines)
const DEFAULT_NODES = [
  {
    id: 'node-local',
    name: 'This Computer (Local)',
    os: 'Detecting...',
    osIcon: '💻',
    cpuModel: 'Hardware Telemetry',
    ramTotal: 0,
    endpoint: 'http://localhost:5500/metrics',
    status: 'offline',
    ip: 'localhost',
    uptime: 0,
    cpu: 0,
    ram: 0,
    disk: 0,
    temp: '--',
    ping: 0,
    netDl: 0,
    netUl: 0,
    cores: [],
    history: {
      cpu: new Array(30).fill(0),
      ram: new Array(30).fill(0),
      disk: new Array(30).fill(0),
      net: new Array(30).fill(0),
    },
    processes: []
  }
];

// App State
const state = {
  nodes: JSON.parse(localStorage.getItem('cm_real_nodes_v1')) || DEFAULT_NODES,
  selectedNodeId: 'node-local',
  viewMode: 'detailed',
  searchQuery: '',
};

// Canvas references
const canvases = {
  cpu: document.getElementById('cpu-chart'),
  ram: document.getElementById('ram-chart'),
  disk: document.getElementById('disk-chart'),
  net: document.getElementById('net-chart'),
};

function getActiveNode() {
  return state.nodes.find(n => n.id === state.selectedNodeId) || state.nodes[0];
}

function saveNodes() {
  localStorage.setItem('cm_real_nodes_v1', JSON.stringify(state.nodes));
}

// Render Connected Fleet Bar
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
          <span class="node-os-icon">${node.osIcon || '💻'}</span>
          <span class="node-card-name" title="${node.name}">${node.name}</span>
        </div>
        <span class="node-status-pill ${node.status}">${node.status.toUpperCase()}</span>
      </div>
      <div class="node-card-stats">
        <div class="node-mini-stat">
          <span class="node-mini-lbl">CPU</span>
          <span class="node-mini-val ${node.status === 'online' ? 'text-cyan' : ''}">${node.status === 'online' ? node.cpu + '%' : '--'}</span>
        </div>
        <div class="node-mini-stat">
          <span class="node-mini-lbl">RAM</span>
          <span class="node-mini-val text-purple">${node.status === 'online' ? node.ram + '%' : '--'}</span>
        </div>
        <div class="node-mini-stat">
          <span class="node-mini-lbl">STATUS</span>
          <span class="node-mini-val ${node.status === 'online' ? 'text-emerald' : 'text-rose'}">${node.status === 'online' ? 'LIVE' : 'OFFLINE'}</span>
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
          <h3>${node.osIcon || '💻'} ${node.name}</h3>
          <p>${node.os} &bull; ${node.ip}</p>
        </div>
        <span class="node-status-pill ${node.status}">${node.status.toUpperCase()}</span>
      </div>

      <div class="comp-metrics-list">
        <div class="comp-metric-row">
          <div class="comp-metric-info">
            <span>CPU Usage</span>
            <span class="font-mono text-cyan">${node.status === 'online' ? node.cpu + '%' : '--'}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill fill-cyan" style="width: ${node.status === 'online' ? node.cpu : 0}%;"></div>
          </div>
        </div>

        <div class="comp-metric-row">
          <div class="comp-metric-info">
            <span>Memory (${node.status === 'online' ? ((node.ram / 100) * node.ramTotal).toFixed(1) + ' / ' + node.ramTotal + ' GB' : '--'})</span>
            <span class="font-mono text-purple">${node.status === 'online' ? node.ram + '%' : '--'}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill fill-purple" style="width: ${node.status === 'online' ? node.ram : 0}%;"></div>
          </div>
        </div>

        <div class="comp-metric-row">
          <div class="comp-metric-info">
            <span>Disk Usage</span>
            <span class="font-mono text-amber">${node.status === 'online' ? node.disk + '%' : '--'}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill fill-amber" style="width: ${node.status === 'online' ? node.disk : 0}%;"></div>
          </div>
        </div>

        <div class="stat-row">
          <span class="stat-label">System Uptime:</span>
          <span class="stat-value font-mono">${node.status === 'online' ? formatUptime(node.uptime) : '--'}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Active Processes:</span>
          <span class="stat-value font-mono text-cyan">${node.status === 'online' ? node.processes.length : '--'}</span>
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

function selectNode(nodeId) {
  state.selectedNodeId = nodeId;
  renderFleetBar();
  updateActiveNodeBanner();
  updateDetailedView();
}

function updateActiveNodeBanner() {
  const node = getActiveNode();
  document.getElementById('active-node-name').textContent = node.name;
  document.getElementById('active-node-desc').textContent = `${node.os} • ${node.cpuModel} • Endpoint: ${node.endpoint}`;
  
  const isOnline = node.status === 'online';
  document.getElementById('meta-status').textContent = isOnline ? 'ONLINE (LIVE)' : 'OFFLINE';
  document.getElementById('meta-status').className = `meta-val ${isOnline ? 'text-emerald' : 'text-rose'}`;
  document.getElementById('meta-uptime').textContent = isOnline ? formatUptime(node.uptime) : '--:--:--';
  document.getElementById('meta-ping').textContent = isOnline ? `${node.ping} ms` : '--';
  document.getElementById('cpu-name').textContent = node.cpuModel;
  document.getElementById('proc-node-tag').textContent = node.name;
}

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

function formatUptime(secs) {
  if (!secs) return '00:00:00';
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
  ctx.stroke();

  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, glowHex);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fill();
}

function setRadialGauge(elementId, percent) {
  const circle = document.getElementById(elementId);
  if (!circle) return;
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  circle.style.strokeDashoffset = offset;
}

// Render Real Processes
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

  if (!procs.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 24px; color: var(--text-dim);">
          ${node.status === 'online' ? 'No processes to display.' : '⚠️ Agent is not connected. Run start-agent.bat on your computer to stream live metrics.'}
        </td>
      </tr>
    `;
    return;
  }

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
      <td><span class="status-badge ${p.status === 'running' ? 'running' : 'sleeping'}">${p.status}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// Update Detailed View with Real Telemetry
function updateDetailedView() {
  const active = getActiveNode();
  const isOnline = active.status === 'online';

  // CPU
  document.getElementById('cpu-percentage').textContent = isOnline ? `${active.cpu}%` : '0%';
  document.getElementById('cpu-avg').textContent = isOnline ? `Avg: ${active.cpu}%` : 'Offline';
  setRadialGauge('cpu-circle', isOnline ? active.cpu : 0);
  document.getElementById('cpu-freq').textContent = active.cpuFreq || '-- GHz';
  document.getElementById('cpu-temp').textContent = isOnline ? (active.temp !== '--' ? `${active.temp} °C` : 'Normal') : '--';
  document.getElementById('total-processes').textContent = isOnline ? (active.processes ? active.processes.length : 0) : '--';
  document.getElementById('total-threads').textContent = isOnline ? `${active.cpuCount || 16} Cores` : '--';

  // Real Cores Rendering
  const coresGrid = document.getElementById('cores-grid');
  coresGrid.innerHTML = '';
  const coresList = active.cores && active.cores.length ? active.cores : new Array(active.cpuCount || 8).fill(0);
  coresList.forEach((cVal, i) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'core-bar-wrapper';
    wrapper.innerHTML = `
      <div class="core-track">
        <div class="core-fill" style="height: ${isOnline ? cVal : 0}%;"></div>
      </div>
      <span class="core-lbl">C${i + 1}</span>
    `;
    coresGrid.appendChild(wrapper);
  });

  // RAM
  if (isOnline && active.ramData) {
    document.getElementById('ram-percentage').textContent = `${active.ram}%`;
    setRadialGauge('ram-circle', active.ram);
    document.getElementById('ram-used').textContent = `${active.ramData.used_gb} GB`;
    document.getElementById('ram-free').textContent = `${active.ramData.free_gb} GB`;
    document.getElementById('ram-summary-txt').textContent = `${active.ramData.used_gb} GB / ${active.ramData.total_gb} GB`;
    document.getElementById('ram-seg-used').style.width = `${active.ram}%`;
  } else {
    document.getElementById('ram-percentage').textContent = '0%';
    setRadialGauge('ram-circle', 0);
    document.getElementById('ram-used').textContent = '-- GB';
    document.getElementById('ram-free').textContent = '-- GB';
    document.getElementById('ram-summary-txt').textContent = '-- / -- GB';
    document.getElementById('ram-seg-used').style.width = '0%';
  }

  // Disk
  if (isOnline && active.diskData) {
    document.getElementById('drive-c-cap').textContent = `${active.diskData.free_gb} GB free of ${active.diskData.total_gb} GB`;
    document.getElementById('drive-c-bar').style.width = `${active.diskData.percent}%`;
    document.getElementById('disk-active-time').textContent = `Used: ${active.diskData.percent}%`;
  } else {
    document.getElementById('drive-c-cap').textContent = 'Drive info offline';
    document.getElementById('drive-c-bar').style.width = '0%';
  }

  renderProcesses();

  // Charts
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

// Poll Real Hardware Agent across all nodes
async function pollRealFleet() {
  for (const node of state.nodes) {
    const startTime = performance.now();
    try {
      const res = await fetch(node.endpoint, {
        method: 'GET',
        signal: AbortSignal.timeout(3500)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const pingMs = Math.round(performance.now() - startTime);

      node.status = 'online';
      node.ping = pingMs;

      if (data.hostname) node.name = data.hostname;
      if (data.os) {
        node.os = data.os;
        if (data.os.includes('Windows')) node.osIcon = '🪟';
        else if (data.os.includes('Mac') || data.os.includes('Darwin')) node.osIcon = '🍎';
        else if (data.os.includes('Linux')) node.osIcon = '🐧';
      }

      if (data.cpu !== undefined) {
        node.cpu = Math.round(data.cpu);
        node.history.cpu.shift();
        node.history.cpu.push(node.cpu);
      }

      if (data.cores) node.cores = data.cores;
      if (data.cpu_count) node.cpuCount = data.cpu_count;
      if (data.cpu_freq) node.cpuFreq = data.cpu_freq;
      if (data.uptime !== undefined) node.uptime = data.uptime;

      if (data.ram) {
        node.ram = Math.round(data.ram.percent);
        node.ramTotal = data.ram.total_gb;
        node.ramData = data.ram;
        node.history.ram.shift();
        node.history.ram.push(node.ram);
      }

      if (data.disk) {
        node.disk = Math.round(data.disk.percent);
        node.diskData = data.disk;
        node.history.disk.shift();
        node.history.disk.push(node.disk);
      }

      if (data.processes) {
        node.processes = data.processes;
      }

    } catch (err) {
      node.status = 'offline';
      node.history.cpu.shift();
      node.history.cpu.push(0);
    }
  }

  // Update Status Banner
  const active = getActiveNode();
  const statusEl = document.getElementById('connection-status');
  const statusTxt = document.getElementById('status-text');

  if (active.status === 'online') {
    statusEl.className = 'connection-status online';
    statusTxt.textContent = `${active.name} (Online)`;
  } else {
    statusEl.className = 'connection-status';
    statusTxt.textContent = 'Agent Offline (Run start-agent.bat)';
  }

  renderFleetBar();
  updateActiveNodeBanner();

  if (state.viewMode === 'fleet') {
    renderFleetComparisonGrid();
  } else {
    updateDetailedView();
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
  updateDetailedView();
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
}

// UI Event Listeners
function setupEvents() {
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  if (btnThemeToggle) btnThemeToggle.addEventListener('click', toggleTheme);

  const btnDetailed = document.getElementById('btn-view-detailed');
  const btnFleet = document.getElementById('btn-view-fleet');
  const searchInput = document.getElementById('proc-search');

  btnDetailed.addEventListener('click', () => switchViewMode('detailed'));
  btnFleet.addEventListener('click', () => switchViewMode('fleet'));

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
    let url = document.getElementById('node-input-url').value.trim();
    if (!url.endsWith('/metrics')) {
      url = url.replace(/\/$/, '') + '/metrics';
    }

    let icon = '💻';
    if (os.includes('Windows')) icon = '🪟';
    else if (os.includes('macOS')) icon = '🍎';
    else if (os.includes('Linux')) icon = '🐧';

    const newNode = {
      id: `node-custom-${Date.now()}`,
      name: name,
      os: os,
      osIcon: icon,
      cpuModel: 'Hardware Telemetry',
      ramTotal: 0,
      endpoint: url,
      status: 'offline',
      ip: url.replace('http://', '').replace('https://', '').split(':')[0] || 'Remote',
      uptime: 0,
      cpu: 0,
      ram: 0,
      disk: 0,
      temp: '--',
      ping: 0,
      cores: [],
      history: {
        cpu: new Array(30).fill(0),
        ram: new Array(30).fill(0),
        disk: new Array(30).fill(0),
        net: new Array(30).fill(0),
      },
      processes: []
    };

    state.nodes.push(newNode);
    saveNodes();
    selectNode(newNode.id);
    addModal.classList.remove('active');
    addForm.reset();
    pollRealFleet();
  });

  // Help Modal
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
    updateDetailedView();
  });
}

// App Entry Point
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEvents();
  renderFleetBar();
  updateActiveNodeBanner();
  updateDetailedView();

  // Initial poll and recurring loop
  pollRealFleet();
  setInterval(pollRealFleet, 1500);
});
