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
  sortCol: 'cpu',
  sortDir: 'desc',
  expandedGroups: new Set(),
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

      <div style="display: flex; gap: 8px; margin-top: 14px;">
        <button class="btn-comp-drill" data-id="${node.id}" style="flex: 1;">Drilldown Detailed Telemetry &rarr;</button>
        <button class="btn-comp-restart" data-id="${node.id}" title="Restart ${node.name}">
          <span>🔄 Restart</span>
        </button>
      </div>
    `;

    card.querySelector('.btn-comp-drill').addEventListener('click', () => {
      selectNode(node.id);
      switchViewMode('detailed');
    });

    const btnRestart = card.querySelector('.btn-comp-restart');
    if (btnRestart) {
      btnRestart.addEventListener('click', (e) => {
        e.stopPropagation();
        openRestartModal(node.id);
      });
    }

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

  // Task Scheduler Status & Alert Banner Logic
  const alertBanner = document.getElementById('agent-alert-banner');
  const alertTitle = document.getElementById('alert-title');
  const alertDesc = document.getElementById('alert-desc');
  const alertLastSeen = document.getElementById('alert-last-seen');
  const metaScheduler = document.getElementById('meta-scheduler');

  if (!isOnline) {
    if (alertBanner) alertBanner.style.display = 'flex';
    if (alertTitle) alertTitle.textContent = 'AGENT UNREACHABLE / TASK STOPPED';
    if (alertDesc) alertDesc.textContent = `Host [${node.name}] is offline. Telemetry stopped or the Windows Task Scheduler task was terminated/deleted.`;
    if (alertLastSeen) alertLastSeen.textContent = node.lastSeen ? `Last Active: ${node.lastSeen.toLocaleTimeString()}` : 'Last Active: Never';
    if (metaScheduler) {
      metaScheduler.textContent = 'STOPPED / UNREACHABLE';
      metaScheduler.className = 'meta-val text-rose';
    }
  } else {
    const sched = node.taskScheduler;
    if (sched && !sched.installed) {
      if (alertBanner) alertBanner.style.display = 'flex';
      if (alertTitle) alertTitle.textContent = 'TASK SCHEDULER TASK DELETED';
      if (alertDesc) alertDesc.textContent = `Warning: The Windows Scheduled Task 'ComputerMonitorAgent' was deleted on ${node.name}. Run install-startup-task.bat to restore it.`;
      if (alertLastSeen) alertLastSeen.textContent = 'Warning Alert';
      if (metaScheduler) {
        metaScheduler.textContent = 'TASK DELETED';
        metaScheduler.className = 'meta-val text-rose';
      }
    } else {
      if (alertBanner) alertBanner.style.display = 'none';
      if (metaScheduler) {
        metaScheduler.textContent = sched ? `ACTIVE (${sched.status})` : 'ACTIVE (Running)';
        metaScheduler.className = 'meta-val text-emerald';
      }
    }
  }
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

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function(m) {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#039;';
    }
  });
}

function showToast(message, isError = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'toast-error' : 'toast-success'}`;
  toast.innerHTML = `<span>${isError ? '❌' : '✅'}</span> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

async function requestStopProcess(identifier, isPid = true) {
  const node = getActiveNode();
  if (node.status !== 'online') {
    showToast(`Cannot stop process: Computer [${node.name}] is offline.`, true);
    return;
  }

  const baseUrl = node.endpoint.replace(/\/metrics\/?$/, '');
  const killUrl = `${baseUrl}/kill`;
  const payload = isPid ? { pid: parseInt(identifier, 10) } : { name: identifier.trim() };

  try {
    const res = await fetch(killUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4500)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'Process stopped successfully!');
      // Trigger instant poll to update process list immediately
      pollRealFleet();
    } else {
      showToast(data.error || 'Failed to stop process.', true);
    }
  } catch (err) {
    showToast(`Error communicating with agent: ${err.message}`, true);
  }
}

let pendingRestartNodeId = null;

function openRestartModal(nodeId) {
  const node = (nodeId ? state.nodes.find(n => n.id === nodeId) : null) || getActiveNode();
  if (node.status !== 'online') {
    showToast(`Cannot restart: Computer [${node.name}] is currently offline.`, true);
    return;
  }
  pendingRestartNodeId = node.id;
  const modal = document.getElementById('restart-computer-modal');
  const targetLabel = document.getElementById('restart-target-node');
  if (targetLabel) {
    targetLabel.textContent = `${node.name} (${node.ip || node.endpoint})`;
  }
  if (modal) modal.classList.add('active');
}

function closeRestartModal() {
  const modal = document.getElementById('restart-computer-modal');
  if (modal) modal.classList.remove('active');
  pendingRestartNodeId = null;
}

async function executeRestartComputer() {
  if (!pendingRestartNodeId) return;
  const node = state.nodes.find(n => n.id === pendingRestartNodeId) || getActiveNode();
  closeRestartModal();

  const baseUrl = node.endpoint.replace(/\/metrics\/?$/, '');
  const restartUrl = `${baseUrl}/restart`;

  try {
    const res = await fetch(restartUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ delay: 5 }),
      signal: AbortSignal.timeout(6000)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`🔄 ${data.message || `Restart initiated! ${node.name} is rebooting...`}`);
      const alertBanner = document.getElementById('agent-alert-banner');
      const alertTitle = document.getElementById('alert-title');
      const alertDesc = document.getElementById('alert-desc');
      if (alertBanner) alertBanner.style.display = 'flex';
      if (alertTitle) alertTitle.textContent = 'SYSTEM REBOOT IN PROGRESS';
      if (alertDesc) alertDesc.textContent = `Restart sequence initiated for ${node.name}. Machine will reboot and automatically reconnect once startup completes.`;
    } else {
      showToast(data.error || 'Failed to initiate system restart.', true);
    }
  } catch (err) {
    showToast(`Error sending restart command: ${err.message}`, true);
  }
}

function updateSortIndicators() {
  document.querySelectorAll('.sortable-th').forEach(th => {
    const col = th.dataset.sort;
    const arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    if (col === state.sortCol) {
      th.classList.add('sorted');
      arrow.textContent = state.sortDir === 'asc' ? '▲' : '▼';
    } else {
      th.classList.remove('sorted');
      arrow.textContent = '↕';
    }
  });
}

// Render Real Processes (Task Manager Grouped & Expandable)
function renderProcesses() {
  const node = getActiveNode();
  const tbody = document.getElementById('proc-table-body');
  const countSpan = document.getElementById('proc-display-count');
  const query = state.searchQuery.toLowerCase();

  // Get groups (or fallback to creating groups from flat list if older agent)
  let groups = node.processGroups ? node.processGroups.slice() : [];
  if (!groups.length && node.processes && node.processes.length) {
    const gmap = {};
    node.processes.forEach(p => {
      const gkey = p.name.toLowerCase();
      if (!gmap[gkey]) {
        gmap[gkey] = {
          name: p.name,
          count: 0,
          cpu: 0,
          mem: 0,
          io: p.io || 'Active',
          status: p.status || 'running',
          instances: []
        };
      }
      gmap[gkey].count += 1;
      gmap[gkey].cpu = Math.round((gmap[gkey].cpu + p.cpu) * 10) / 10;
      gmap[gkey].mem = Math.round((gmap[gkey].mem + p.mem) * 10) / 10;
      gmap[gkey].instances.push(p);
    });
    groups = Object.values(gmap);
  }

  // Filter groups by search query (match group name or any child PID)
  const filtered = groups.filter(g => {
    if (!query) return true;
    if (g.name.toLowerCase().includes(query)) return true;
    return (g.instances || []).some(inst => 
      inst.pid.toString().includes(query) || inst.name.toLowerCase().includes(query)
    );
  });

  // Multi-column sorting
  filtered.sort((a, b) => {
    let valA, valB;

    if (state.sortCol === 'pid') {
      valA = a.instances && a.instances[0] ? a.instances[0].pid : 0;
      valB = b.instances && b.instances[0] ? b.instances[0].pid : 0;
      return state.sortDir === 'asc' ? (valA - valB) : (valB - valA);
    }

    valA = a[state.sortCol];
    valB = b[state.sortCol];

    if (typeof valA === 'string' || typeof valB === 'string') {
      valA = String(valA || '').toLowerCase();
      valB = String(valB || '').toLowerCase();
      return state.sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    } else {
      valA = valA !== undefined ? Number(valA) : 0;
      valB = valB !== undefined ? Number(valB) : 0;
      return state.sortDir === 'asc' ? (valA - valB) : (valB - valA);
    }
  });

  updateSortIndicators();

  const totalProcsCount = filtered.reduce((acc, g) => acc + (g.count || 1), 0);
  countSpan.textContent = `Showing ${filtered.length} applications (${totalProcsCount} processes)`;
  tbody.innerHTML = '';

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 24px; color: var(--text-dim);">
          ${node.status === 'online' ? 'No processes found matching filter.' : '⚠️ Agent is not connected. Run start-agent.bat on your computer to stream live metrics.'}
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach(g => {
    const gkey = g.name.toLowerCase();
    const hasMultiple = (g.count || 1) > 1;
    const isExpanded = state.expandedGroups.has(gkey);

    const memFormatted = g.mem >= 1024 
      ? `${(g.mem / 1024).toFixed(1)} GB` 
      : `${g.mem.toFixed(1)} MB`;

    // Task Manager style heatmap tinting
    const cpuClass = g.cpu > 15 ? 'heat-cpu-high' : (g.cpu > 0 ? 'heat-cpu-active' : '');
    const memClass = g.mem >= 2048 ? 'heat-mem-high' : (g.mem >= 500 ? 'heat-mem-med' : (g.mem >= 100 ? 'heat-mem-low' : ''));

    // Parent group row
    const tr = document.createElement('tr');
    tr.className = `proc-group-row ${isExpanded ? 'expanded' : ''}`;
    tr.dataset.group = gkey;

    const pidDisplay = hasMultiple 
      ? `<span style="color: var(--text-dim); font-size: 0.75rem;">${g.count} procs</span>` 
      : (g.instances && g.instances[0] ? g.instances[0].pid : '--');

    tr.innerHTML = `
      <td class="proc-name-cell">
        <div class="proc-name-flex">
          <span class="proc-chevron ${hasMultiple ? 'expandable' : 'empty'}" data-group="${gkey}">${hasMultiple ? (isExpanded ? '▼' : '▶') : ''}</span>
          <span class="proc-icon"></span>
          <span class="proc-title" title="${escapeHtml(g.name)}">${escapeHtml(g.name)}</span>
          ${hasMultiple ? `<span class="proc-count-badge">${g.count}</span>` : ''}
        </div>
      </td>
      <td class="font-mono">${pidDisplay}</td>
      <td class="font-mono heat-cell ${cpuClass}">${g.cpu.toFixed(1)}%</td>
      <td class="font-mono heat-cell ${memClass}">${memFormatted}</td>
      <td class="font-mono">${escapeHtml(g.io || 'Active')}</td>
      <td><span class="status-badge ${g.status === 'running' ? 'running' : 'sleeping'}">${escapeHtml(g.status || 'running')}</span></td>
      <td style="text-align: right;">
        ${hasMultiple 
          ? `<button class="btn-kill-row btn-kill-group" data-name="${escapeHtml(g.name)}" title="Stop all ${g.count} instances of ${escapeHtml(g.name)}"><span>⏹ End Task</span></button>`
          : `<button class="btn-kill-row" data-pid="${g.instances && g.instances[0] ? g.instances[0].pid : ''}" data-name="${escapeHtml(g.name)}" title="Stop process ${escapeHtml(g.name)}"><span>⏹ Stop</span></button>`
        }
      </td>
    `;
    tbody.appendChild(tr);

    // Expandable child rows
    if (hasMultiple && isExpanded && g.instances) {
      g.instances.forEach((inst, idx) => {
        const childTr = document.createElement('tr');
        childTr.className = 'proc-child-row';

        const instMem = inst.mem >= 1024 
          ? `${(inst.mem / 1024).toFixed(1)} GB` 
          : `${inst.mem.toFixed(1)} MB`;

        const instCpuClass = inst.cpu > 15 ? 'heat-cpu-high' : (inst.cpu > 0 ? 'heat-cpu-active' : '');

        childTr.innerHTML = `
          <td class="proc-name-cell">
            <div class="proc-name-flex proc-child-indent">
              <span class="proc-child-branch">└─</span>
              <span class="proc-child-icon"></span>
              <span class="proc-child-name" title="${escapeHtml(inst.name)}">${escapeHtml(inst.name)}</span>
              <span class="proc-child-idx">(#${idx + 1})</span>
            </div>
          </td>
          <td class="font-mono font-bold" style="color: var(--cyan);">${inst.pid}</td>
          <td class="font-mono heat-cell ${instCpuClass}">${inst.cpu.toFixed(1)}%</td>
          <td class="font-mono">${instMem}</td>
          <td class="font-mono" style="color: var(--text-dim);">${escapeHtml(inst.io || 'Active')}</td>
          <td><span class="status-badge running" style="font-size: 0.68rem; padding: 2px 6px;">running</span></td>
          <td style="text-align: right;">
            <button class="btn-kill-row" data-pid="${inst.pid}" data-name="${escapeHtml(inst.name)}" title="Stop process (PID: ${inst.pid})">
              <span>⏹ Stop</span>
            </button>
          </td>
        `;
        tbody.appendChild(childTr);
      });
    }
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
      node.lastSeen = new Date();
      node.ping = pingMs;
      if (data.task_scheduler) node.taskScheduler = data.task_scheduler;

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
      if (data.process_groups) {
        node.processGroups = data.process_groups;
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

  // Download Agent Modal Listeners
  const downloadModal = document.getElementById('download-agent-modal');
  const btnOpenDownloadModal = document.getElementById('btn-open-download-modal');
  const btnCloseDownloadModal = document.getElementById('download-modal-close');
  const btnFooterDownload = document.getElementById('btn-footer-download');
  const linkModalOpenDownload = document.getElementById('link-modal-open-download');
  const btnCopyPsCmd = document.getElementById('btn-copy-ps-cmd');
  const psCmdText = document.getElementById('ps-cmd-text');

  const openDownloadModal = (e) => {
    if (e) e.preventDefault();
    if (addModal) addModal.classList.remove('active');
    if (downloadModal) downloadModal.classList.add('active');
  };

  const closeDownloadModal = () => {
    if (downloadModal) downloadModal.classList.remove('active');
  };

  if (btnOpenDownloadModal) btnOpenDownloadModal.addEventListener('click', openDownloadModal);
  if (btnFooterDownload) btnFooterDownload.addEventListener('click', openDownloadModal);
  if (linkModalOpenDownload) linkModalOpenDownload.addEventListener('click', openDownloadModal);
  if (btnCloseDownloadModal) btnCloseDownloadModal.addEventListener('click', closeDownloadModal);
  if (downloadModal) {
    downloadModal.addEventListener('click', (e) => {
      if (e.target === downloadModal) closeDownloadModal();
    });
  }

  if (btnCopyPsCmd && psCmdText) {
    btnCopyPsCmd.addEventListener('click', () => {
      navigator.clipboard.writeText(psCmdText.textContent.trim()).then(() => {
        btnCopyPsCmd.textContent = 'Copied! ✅';
        setTimeout(() => {
          btnCopyPsCmd.textContent = '📋 Copy Command';
        }, 2500);
      }).catch(() => {
        showToast('Command copied to clipboard!');
      });
    });
  }

  // Process Table Interaction Event Delegation (Expand/Collapse & Stop/End Task)
  const procTbody = document.getElementById('proc-table-body');
  if (procTbody) {
    procTbody.addEventListener('click', (e) => {
      // 1. Check if user clicked a kill button
      const killBtn = e.target.closest('.btn-kill-row');
      if (killBtn) {
        e.stopPropagation();
        const isGroup = killBtn.classList.contains('btn-kill-group');
        const name = killBtn.dataset.name;
        const pid = killBtn.dataset.pid;
        if (isGroup) {
          if (confirm(`Are you sure you want to STOP ALL running instances of [${name}]?`)) {
            requestStopProcess(name, false);
          }
        } else {
          if (confirm(`Are you sure you want to STOP process [${name}] (PID: ${pid})?`)) {
            requestStopProcess(pid, true);
          }
        }
        return;
      }

      // 2. Check if user clicked a group row or chevron to expand/collapse
      const groupRow = e.target.closest('.proc-group-row');
      if (groupRow) {
        const groupKey = groupRow.dataset.group;
        const chevron = groupRow.querySelector('.proc-chevron.expandable');
        if (groupKey && chevron) {
          if (state.expandedGroups.has(groupKey)) {
            state.expandedGroups.delete(groupKey);
          } else {
            state.expandedGroups.add(groupKey);
          }
          renderProcesses();
        }
      }
    });
  }

  // Stop Process Modal
  const killModal = document.getElementById('kill-proc-modal');
  const btnOpenKillModal = document.getElementById('btn-open-kill-modal');
  const btnCloseKillModal = document.getElementById('kill-modal-close');
  const btnCancelKill = document.getElementById('btn-cancel-kill');
  const killForm = document.getElementById('kill-proc-form');
  const killInput = document.getElementById('kill-input-val');
  const killHint = document.getElementById('kill-input-hint');
  const killTargetNode = document.getElementById('kill-target-node');
  const killRadios = document.querySelectorAll('input[name="kill-mode"]');

  if (btnOpenKillModal) {
    btnOpenKillModal.addEventListener('click', () => {
      const node = getActiveNode();
      if (killTargetNode) killTargetNode.textContent = node.name;
      if (killInput) killInput.value = '';
      killModal.classList.add('active');
      if (killInput) killInput.focus();
    });
  }

  if (btnCloseKillModal) {
    btnCloseKillModal.addEventListener('click', () => killModal.classList.remove('active'));
  }
  if (btnCancelKill) {
    btnCancelKill.addEventListener('click', () => killModal.classList.remove('active'));
  }

  killRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'pid') {
        killInput.placeholder = 'e.g. 1234';
        killHint.textContent = 'Enter the numeric PID of the process to stop.';
      } else {
        killInput.placeholder = 'e.g. notepad.exe or chrome.exe';
        killHint.textContent = 'Enter the executable name of the process to stop.';
      }
    });
  });

  if (killForm) {
    killForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = killInput.value.trim();
      if (!val) return;
      const isPid = document.querySelector('input[name="kill-mode"]:checked')?.value === 'pid';
      killModal.classList.remove('active');
      requestStopProcess(val, isPid);
    });
  }

  // Process Table Column Sorting Click Listeners
  document.querySelectorAll('.sortable-th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.sortCol === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortCol = col;
        state.sortDir = (col === 'name' || col === 'status' || col === 'io') ? 'asc' : 'desc';
      }
      renderProcesses();
    });
  });

  // Restart Computer Modal Listeners
  const btnRestartComp = document.getElementById('btn-restart-computer');
  const btnCloseRestartModal = document.getElementById('restart-modal-close');
  const btnCancelRestart = document.getElementById('btn-cancel-restart');
  const btnConfirmRestart = document.getElementById('btn-confirm-restart');
  const restartModal = document.getElementById('restart-computer-modal');

  if (btnRestartComp) {
    btnRestartComp.addEventListener('click', () => {
      openRestartModal(state.selectedNodeId);
    });
  }

  if (btnCloseRestartModal) {
    btnCloseRestartModal.addEventListener('click', closeRestartModal);
  }
  if (btnCancelRestart) {
    btnCancelRestart.addEventListener('click', closeRestartModal);
  }
  if (restartModal) {
    restartModal.addEventListener('click', (e) => {
      if (e.target === restartModal) closeRestartModal();
    });
  }
  if (btnConfirmRestart) {
    btnConfirmRestart.addEventListener('click', executeRestartComputer);
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
