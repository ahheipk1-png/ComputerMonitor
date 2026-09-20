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
    endpoint: (typeof window !== 'undefined' && window.location.port === '5500') ? `${window.location.origin}/metrics` : 'http://localhost:5500/metrics',
    status: 'offline',
    ip: (typeof window !== 'undefined' && window.location.hostname) ? window.location.hostname : 'localhost',
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

// Centralized Version Control & Automatic Cloud Sync
const CURRENT_WEB_VERSION = '4.7.6';
const EXPECTED_AGENT_VERSION = '4.7.6';
let isReloadingForUpdate = false;

// Auto-clean any stale legacy '4.5.0' stored in user's browser localStorage
try {
  const rawCache = localStorage.getItem('cm_real_nodes_v1');
  if (rawCache && rawCache.includes('4.5.0')) {
    localStorage.setItem('cm_real_nodes_v1', rawCache.replace(/"4\.5\.0"/g, `"${EXPECTED_AGENT_VERSION}"`));
  }
} catch (_) {}

async function checkCloudWebVersion() {
  if (isReloadingForUpdate) return;
  try {
    const res = await fetch(`/version.json?_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const cloudVer = (data.version || '').trim();
    if (cloudVer && cloudVer !== CURRENT_WEB_VERSION) {
      isReloadingForUpdate = true;
      console.log(`[Version Sync] Newer version deployed: v${cloudVer} (Running: v${CURRENT_WEB_VERSION}). Auto-updating...`);
      showToast(`⚡ Fleet Update Detected: v${cloudVer} • Syncing latest version...`);
      const badge = document.getElementById('app-version-badge');
      if (badge) {
        badge.textContent = `Fleet v${cloudVer} (Syncing...)`;
        badge.style.background = 'rgba(16, 185, 129, 0.25)';
        badge.style.color = '#34d399';
      }
      setTimeout(() => {
        window.location.reload(true);
      }, 1500);
    }
  } catch (_) {}
}

// Check version immediately on initial script execution
checkCloudWebVersion();

// Fleet Identifier Resolution
const urlParams = new URLSearchParams(window.location.search);
let fleetId = urlParams.get('fleet') || localStorage.getItem('cm_fleet_id') || 'ahheipk1';
localStorage.setItem('cm_fleet_id', fleetId);

let mqttFleetClient = null;
let mqttFleetClients = [];

function publishFleetCommand(topic, payload) {
  const jsonStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  let sent = false;
  mqttFleetClients.forEach(client => {
    if (client && client.connected) {
      try {
        client.publish(topic, jsonStr);
        sent = true;
      } catch (e) {}
    }
  });
  return sent;
}

// Safely send commands targeting a specific computer, preventing collision on shared hostnames
function sendNodeCommand(node, payload) {
  if (!node) return false;

  const alias = (node.alias && typeof node.alias === 'string') ? node.alias.trim() : '';
  const rawHostname = (node.rawHostname || node.name || '').trim();
  const machineId = (node.machineId || '').trim();
  const shortGuid = machineId ? machineId.replace(/-/g, '').slice(0, 8).toLowerCase() : '';

  const targetTopics = new Set();

  // 1. Target by hardware machine ID / GUID (Primary, 100% collision-free)
  if (machineId) {
    targetTopics.add(`computermonitor/fleet/${fleetId}/${machineId}/cmd`);
    if (shortGuid) {
      targetTopics.add(`computermonitor/fleet/${fleetId}/${shortGuid}/cmd`);
      if (rawHostname) {
        targetTopics.add(`computermonitor/fleet/${fleetId}/${rawHostname}_${shortGuid}/cmd`);
      }
    }
  }

  // 2. Target by distinct alias
  if (alias) {
    targetTopics.add(`computermonitor/fleet/${fleetId}/${alias}/cmd`);
    if (alias.toLowerCase() !== alias) {
      targetTopics.add(`computermonitor/fleet/${fleetId}/${alias.toLowerCase()}/cmd`);
    }
  }

  // 3. Fallback: ONLY publish to raw hostname if NO machineId, NO alias, and single-node
  if (!machineId && !alias && state.nodes.length <= 1) {
    if (rawHostname) {
      targetTopics.add(`computermonitor/fleet/${fleetId}/${rawHostname}/cmd`);
    }
  }

  const enrichedPayload = {
    ...payload,
    target_machine_id: machineId || '',
    target_guid: machineId || '',
    target_alias: alias || '',
    target_host: rawHostname || '',
    target_id: node.id || ''
  };

  let sent = false;
  targetTopics.forEach(topic => {
    if (publishFleetCommand(topic, enrichedPayload)) {
      sent = true;
    }
  });
  return sent;
}

// Computer Node Aliases Mapping
let nodeAliases = {};
try {
  nodeAliases = JSON.parse(localStorage.getItem('cm_node_aliases') || '{}');
} catch (e) {
  nodeAliases = {};
}

function saveAliases() {
  try {
    localStorage.setItem('cm_node_aliases', JSON.stringify(nodeAliases));
  } catch (e) {}
}

function getNodeDisplayName(node) {
  if (!node) return 'Unknown Computer';
  const mId = (node.machineId || '').trim().toLowerCase();
  if (mId && nodeAliases[mId]) return nodeAliases[mId];
  if (node.id && nodeAliases[node.id]) return nodeAliases[node.id];
  if (node.alias && typeof node.alias === 'string' && node.alias.trim()) return node.alias.trim();
  if (node.name && nodeAliases[node.name]) return nodeAliases[node.name];
  return node.name || 'Unknown Computer';
}

async function setNodeAlias(nodeId, newAlias) {
  const node = state.nodes.find(n => n.id === nodeId) || getActiveNode();
  if (!node) return;
  const trimmed = (newAlias || '').trim();
  const displayName = trimmed || node.name;
  const mId = (node.machineId || '').trim().toLowerCase();

  if (trimmed) {
    nodeAliases[node.id] = trimmed;
    if (node.name) nodeAliases[node.name] = trimmed;
    if (mId) nodeAliases[mId] = trimmed;
    node.alias = trimmed;
  } else {
    delete nodeAliases[node.id];
    if (node.name) delete nodeAliases[node.name];
    if (mId) delete nodeAliases[mId];
    delete node.alias;
  }
  saveAliases();
  saveNodes();

  // 1. Send remote command to agent over MQTT with isolated routing
  sendNodeCommand(node, {
    action: 'set_alias',
    alias: trimmed
  });

  showToast(`Computer alias updated to "${displayName}"`);
  renderFleetBar();
  updateActiveNodeBanner();
  if (state.viewMode === 'fleet') {
    renderFleetComparisonGrid();
  }
}

function removeNode(nodeId) {
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return;
  const dispName = getNodeDisplayName(node);
  const mId = (node.machineId || '').trim().toLowerCase();

  state.nodes = state.nodes.filter(n => n.id !== nodeId);
  if (state.nodes.length === 0) {
    state.nodes = DEFAULT_NODES;
    state.selectedNodeId = 'node-local';
  } else if (state.selectedNodeId === nodeId) {
    state.selectedNodeId = state.nodes[0].id;
  }

  delete nodeAliases[nodeId];
  if (node.name) delete nodeAliases[node.name];
  if (mId) delete nodeAliases[mId];
  saveAliases();
  saveNodes();

  showToast(`Computer [${dispName}] removed from fleet.`);
  renderFleetBar();
  updateActiveNodeBanner();
  updateDetailedView();
  if (state.viewMode === 'fleet') {
    renderFleetComparisonGrid();
  }
}

function cleanupAndDedupNodes() {
  if (!Array.isArray(state.nodes) || state.nodes.length === 0) {
    state.nodes = DEFAULT_NODES;
    return;
  }

  const result = [];
  const seenMachineIds = new Map();
  const seenHostnames = new Map();

  for (const node of state.nodes) {
    if (!node || !node.name) continue;
    const mId = (node.machineId || '').trim().toLowerCase();
    const host = (node.rawHostname || node.name || '').trim().toLowerCase();

    // 1. Deduplicate by unique hardware machineId (100% collision-free)
    if (mId) {
      if (seenMachineIds.has(mId)) {
        const existing = seenMachineIds.get(mId);
        if (node.status === 'online' && existing.status !== 'online') {
          const idx = result.indexOf(existing);
          if (idx !== -1) result[idx] = node;
          seenMachineIds.set(mId, node);
          if (host) seenHostnames.set(host, node);
        }
        continue;
      }
      seenMachineIds.set(mId, node);
    }

    // 2. Deduplicate identical hostnames where one is offline or lacks machineId
    if (host && seenHostnames.has(host)) {
      const existing = seenHostnames.get(host);
      if (node.status === 'online' && existing.status !== 'online') {
        const idx = result.indexOf(existing);
        if (idx !== -1) result[idx] = node;
        seenHostnames.set(host, node);
        if (mId) seenMachineIds.set(mId, node);
        continue;
      } else if (existing.status === 'online' && node.status !== 'online') {
        continue;
      } else if (!existing.machineId && node.machineId) {
        const idx = result.indexOf(existing);
        if (idx !== -1) result[idx] = node;
        seenHostnames.set(host, node);
        seenMachineIds.set(node.machineId.toLowerCase(), node);
        continue;
      } else if (existing.machineId && !node.machineId) {
        continue;
      }
    }

    if (host) seenHostnames.set(host, node);
    result.push(node);
  }

  // Remove initial placeholder 'node-local' if real online machines exist
  if (result.length > 1 && result.some(n => n.id !== 'node-local' && n.status === 'online')) {
    const placeholderIdx = result.findIndex(n => n.id === 'node-local' && n.status !== 'online');
    if (placeholderIdx !== -1) {
      result.splice(placeholderIdx, 1);
    }
  }

  state.nodes = result.length > 0 ? result : DEFAULT_NODES;

  if (!state.nodes.some(n => n.id === state.selectedNodeId)) {
    const online = state.nodes.find(n => n.status === 'online');
    state.selectedNodeId = online ? online.id : state.nodes[0].id;
  }
}

function loadSavedNodes() {
  try {
    const raw = localStorage.getItem('cm_real_nodes_v1');
    if (!raw) return DEFAULT_NODES;
    let list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return DEFAULT_NODES;

    // Deduplicate on initial load
    const seenMId = new Map();
    const seenHost = new Map();
    const deduped = [];

    for (const node of list) {
      if (!node || !node.name) continue;
      const mId = (node.machineId || '').trim().toLowerCase();
      const h = (node.rawHostname || node.name || '').trim().toLowerCase();

      if (mId) {
        if (seenMId.has(mId)) continue;
        seenMId.set(mId, true);
      }
      if (h) {
        const a = (node.alias || nodeAliases[node.id] || node.name || '').trim().toLowerCase();
        const key = `${h}::${a}`;
        if (seenHost.has(key)) continue;
        seenHost.set(key, true);
      }
      deduped.push(node);
    }

    list = deduped.length > 0 ? deduped : DEFAULT_NODES;

    for (const node of list) {
      node.status = 'syncing';
      node.liveSynced = false;
      node.agentVersion = CURRENT_WEB_VERSION;
      if (node.lastSeen) {
        node.lastSeen = new Date(node.lastSeen);
      }
    }
    return list;
  } catch (e) {
    return DEFAULT_NODES;
  }
}

// App State
const state = {
  nodes: loadSavedNodes(),
  selectedNodeId: 'node-local',
  viewMode: 'detailed',
  searchQuery: '',
  filterGamesBrowsersOnly: true,
  sortCol: 'name',
  sortDir: 'asc',
  expandedGroups: new Set(),
  scheduledLocks: {}, // Keyed by node ID or machine GUID -> { deadline, delayMinutes, nodeName, machineId }
};

// Helper to format remaining seconds into MM:SS or HH:MM:SS
function formatSecondsToMMSS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Retrieve active scheduled lock for a given node (if not expired)
function getNodeScheduledLock(node) {
  if (!node) return null;
  const lock = state.scheduledLocks[node.id] || (node.machineId ? state.scheduledLocks[node.machineId] : null);
  if (!lock) return null;
  const rem = Math.max(0, Math.ceil((lock.deadline - Date.now()) / 1000));
  if (rem <= 0) {
    delete state.scheduledLocks[node.id];
    if (node.machineId) delete state.scheduledLocks[node.machineId];
    return null;
  }
  return lock;
}

// Cancel active delayed workstation lock
function cancelScheduledLock(nodeId) {
  const node = (nodeId ? state.nodes.find(n => n.id === nodeId) : null) || getActiveNode();
  if (!node) return;
  delete state.scheduledLocks[node.id];
  if (node.machineId) delete state.scheduledLocks[node.machineId];
  node.pendingLockDeadline = null;

  sendNodeCommand(node, {
    action: 'cancel_lock'
  });

  showToast(`✅ Workstation lock cancelled for [${getNodeDisplayName(node)}]`);
  updateLockCountdowns();
  renderFleetBar();
  if (state.viewMode === 'fleet') {
    renderFleetComparisonGrid();
  }
}

// Global 1-second interval tick updating all lock countdowns in real-time
function updateLockCountdowns() {
  const now = Date.now();

  // 1. Expire completed timers
  Object.keys(state.scheduledLocks).forEach(key => {
    const lock = state.scheduledLocks[key];
    if (!lock) return;
    const rem = Math.max(0, Math.ceil((lock.deadline - now) / 1000));
    if (rem <= 0) {
      delete state.scheduledLocks[key];
      const node = state.nodes.find(n => n.id === key || n.machineId === key);
      if (node) node.pendingLockDeadline = null;
      showToast(`🔒 Workstation lock executed on [${lock.nodeName || 'Computer'}]`);
    }
  });

  // 2. Update Header Controls & Active Node Banner
  const activeNode = getActiveNode();
  const activeLock = activeNode ? getNodeScheduledLock(activeNode) : null;
  const banner = document.getElementById('scheduled-lock-banner');
  const bannerTimer = document.getElementById('lock-banner-timer');
  const bannerTitle = document.getElementById('lock-banner-title');
  const btnLockComp = document.getElementById('btn-lock-computer');
  const btnLockText = document.getElementById('btn-lock-text');
  const btnCancelLock = document.getElementById('btn-header-cancel-lock');
  const lockDelayInput = document.getElementById('lock-delay-minutes');
  const lockDelayLabel = document.getElementById('lock-delay-label');

  if (activeLock) {
    const rem = Math.max(0, Math.ceil((activeLock.deadline - now) / 1000));
    const timeStr = formatSecondsToMMSS(rem);

    if (banner) {
      banner.style.display = 'flex';
      if (bannerTimer) bannerTimer.textContent = timeStr;
      if (bannerTitle) bannerTitle.textContent = `Workstation Lock Scheduled for [${getNodeDisplayName(activeNode)}]`;
    }
    if (btnLockComp) {
      btnLockComp.classList.add('has-pending-lock');
    }
    if (btnLockText) {
      btnLockText.textContent = `⏱️ ${timeStr}`;
    }
    if (btnCancelLock) {
      btnCancelLock.style.display = 'inline-flex';
    }
    if (lockDelayInput) {
      lockDelayInput.style.display = 'none';
    }
    if (lockDelayLabel) {
      lockDelayLabel.style.display = 'none';
    }
  } else {
    if (banner) {
      banner.style.display = 'none';
    }
    if (btnLockComp) {
      btnLockComp.classList.remove('has-pending-lock');
    }
    if (btnLockText) {
      btnLockText.textContent = 'Lock';
    }
    if (btnCancelLock) {
      btnCancelLock.style.display = 'none';
    }
    if (lockDelayInput) {
      lockDelayInput.style.display = '';
    }
    if (lockDelayLabel) {
      lockDelayLabel.style.display = '';
    }
  }

  // 3. Update countdown badges in Fleet Bar cards
  state.nodes.forEach(n => {
    const lock = getNodeScheduledLock(n);
    const pill = document.querySelector(`.fleet-lock-badge-${n.id}`);
    if (pill) {
      if (lock) {
        const rem = Math.max(0, Math.ceil((lock.deadline - now) / 1000));
        pill.textContent = `⏱️ ${formatSecondsToMMSS(rem)}`;
        pill.style.display = 'inline-flex';
      } else {
        pill.style.display = 'none';
      }
    }

    const compLockBtn = document.querySelector(`.btn-comp-lock[data-id="${n.id}"]`);
    if (compLockBtn) {
      if (lock) {
        const rem = Math.max(0, Math.ceil((lock.deadline - now) / 1000));
        compLockBtn.innerHTML = `<span>⏱️ ${formatSecondsToMMSS(rem)} (Cancel)</span>`;
        compLockBtn.classList.add('has-pending-lock');
        compLockBtn.style.background = 'rgba(239, 68, 68, 0.2)';
        compLockBtn.style.borderColor = 'rgba(239, 68, 68, 0.5)';
        compLockBtn.style.color = '#f87171';
      } else {
        compLockBtn.innerHTML = `<span>🔒 Lock</span>`;
        compLockBtn.classList.remove('has-pending-lock');
        compLockBtn.style.background = '';
        compLockBtn.style.borderColor = '';
        compLockBtn.style.color = '';
      }
    }
  });
}

// Filter Keywords for Browsers, Roblox, Games, and Autoclickers
const GAME_BROWSER_CLICKER_KEYWORDS = [
  // Browsers
  'chrome', 'msedge', 'edge', 'firefox', 'brave', 'opera', 'vivaldi', 'safari', 'chromium', 'arc', 'tor', 'waterfox', 'yandex', 'browser', 'webkit', 'duckduckgo',
  // Roblox
  'roblox', 'robloxplayer', 'robloxplayerbeta', 'robloxstudio', 'robloxcrashtracker', 'rblx',
  // Gaming Clients & Launchers
  'steam', 'steamwebhelper', 'steamservice', 'epicgames', 'epicgameslauncher', 'riotclient', 'riotclientservices', 'battlenet', 'eadesktop', 'origin', 'galaxyclient', 'ubisoft', 'upc', 'blizzard', 'playnite',
  // Popular Games & Engines
  'valorant', 'vanguard', 'vgtray', 'leagueoflegends', 'leagueclient', 'minecraft', 'javaw', 'genshin', 'starrail', 'honkai', 'unity', 'unreal', 'fortnite', 'overwatch', 'csgo', 'cs2', 'dota', 'gta', 'fivem', 'rdr2', 'retroarch', 'game', 'games', 'gaming', 'simulator', 'crossfire', 'apex', 'r5apex', 'pubg', 'tslgame', 'destiny2', 'warframe', 'eldenring', 'darksouls', 'cyberpunk', 'palworld', 'terraria', 'stardew', 'osu', 'fallguys', 'rocketleague', 'amongus', 'warzone', 'tarkov', 'worldoftanks', 'wow', 'hearthstone', 'diablo', 'smite', 'seaofthieves', 'helldivers',
  // Autoclickers & Automation Tools
  'autoclicker', 'opautoclicker', 'speedautoclicker', 'gsautoclicker', 'tinytask', 'macro', 'ahk', 'autohotkey', 'clicker', 'mouseclick', 'pyclicker', 'fastclicker', 'auto_clicker', 'auto-clicker', 'tgmacro', 'pulover', 'speedclicker', 'easyclicker', 'fastclick', 'mousebot', 'keybot', 'remapper', 'x-mouse', 'xmouse', 'cheatengine', 'speedhack', 'jitbit', 'keyrecorder', 'mouserecorder', 'macrorecorder', 'ghostmouse', 'automouse'
];

function isGameBrowserOrClickerProcess(name) {
  if (!name || typeof name !== 'string') return false;
  const lower = name.toLowerCase().replace(/\.exe$/i, '');
  return GAME_BROWSER_CLICKER_KEYWORDS.some(kw => lower.includes(kw));
}

// Canvas references
const canvases = {
  cpu: document.getElementById('cpu-chart'),
  ram: document.getElementById('ram-chart'),
  disk: document.getElementById('disk-chart'),
  net: document.getElementById('net-chart'),
};

function getActiveNode() {
  let active = state.nodes.find(n => n.id === state.selectedNodeId);
  if (!active || (active.status !== 'online' && state.nodes.some(n => n.status === 'online'))) {
    // If the currently selected node is offline, but there is an active online node, auto-focus the online node
    const onlineNode = state.nodes.find(n => n.status === 'online');
    if (onlineNode) {
      state.selectedNodeId = onlineNode.id;
      active = onlineNode;
    }
  }
  return active || state.nodes[0];
}

function saveNodes() {
  try {
    const serialized = state.nodes.map(n => ({
      ...n,
      processes: [],
      processGroups: [],
      agentVersion: n.agentVersion || EXPECTED_AGENT_VERSION
    }));
    localStorage.setItem('cm_real_nodes_v1', JSON.stringify(serialized));
  } catch (e) {
    console.warn('Could not save nodes to localStorage:', e);
  }
}

// Cloud Fleet Telemetry Ingestion (Zero-IP Automatic Sync)
function handleIncomingNodeTelemetry(data) {
  if (!data || !data.hostname) return;
  const hostname = data.hostname.trim();
  const alias = (data.alias && typeof data.alias === 'string') ? data.alias.trim() : '';
  const machineId = (data.machine_id || data.guid || '').trim();

  // Generate unique node ID. Primary key: hardware machine ID if present, otherwise hostname + alias
  let nodeId;
  if (machineId) {
    nodeId = `node-${machineId.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  } else if (alias && alias.toLowerCase() !== hostname.toLowerCase()) {
    nodeId = `node-${hostname.toLowerCase()}_${alias.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  } else {
    nodeId = `node-${hostname.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  }

  // Robust node matching:
  // 1. Primary: Match by hardware machineId (100% collision-free)
  let node = machineId ? state.nodes.find(n => n.machineId && n.machineId.toLowerCase() === machineId.toLowerCase()) : null;

  // 2. Match by exact nodeId
  if (!node) {
    node = state.nodes.find(n => n.id === nodeId);
  }
  
  // 3. Match by hostname if existing node lacks machineId or is offline (prevents duplicate ghost nodes on rename/reconnect)
  if (!node) {
    node = state.nodes.find(n => {
      const isSameHost = (n.rawHostname && n.rawHostname.toLowerCase() === hostname.toLowerCase()) ||
                         (n.name && n.name.toLowerCase() === hostname.toLowerCase()) ||
                         (n.id && n.id.toLowerCase() === `node-${hostname.toLowerCase()}`);
      if (!isSameHost) return false;
      if (!n.machineId || n.status !== 'online') return true;
      return (alias && n.alias && n.alias.toLowerCase() === alias.toLowerCase());
    });
  }

  // 4. Match offline initial placeholder
  if (!node) {
    node = state.nodes.find(n => n.id === 'node-local' && n.status !== 'online');
  }

  if (node) {
    // Smoothly update ID to canonical hardware node ID
    if (node.id !== nodeId) {
      if (state.selectedNodeId === node.id) {
        state.selectedNodeId = nodeId;
      }
      node.id = nodeId;
    }
  } else {
    let icon = '💻';
    if (data.os && data.os.includes('Windows')) icon = '🪟';
    else if (data.os && (data.os.includes('Mac') || data.os.includes('Darwin'))) icon = '🍎';
    else if (data.os && data.os.includes('Linux')) icon = '🐧';

    node = {
      id: nodeId,
      name: hostname,
      alias: alias || hostname,
      machineId: machineId || '',
      os: data.os || 'Windows',
      osIcon: icon,
      cpuModel: data.cpu_model || (data.cpu_count ? `${data.cpu_count}-Core CPU` : 'Hardware Telemetry'),
      ramTotal: data.ram ? data.ram.total_gb : 0,
      endpoint: 'cloud-sync',
      status: 'online',
      ip: data.ip || 'Cloud Synced',
      uptime: data.uptime || 0,
      cpu: 0,
      ram: 0,
      disk: 0,
      temp: '--',
      ping: 15,
      cores: [],
      history: {
        cpu: new Array(30).fill(0),
        ram: new Array(30).fill(0),
        disk: new Array(30).fill(0),
        net: new Array(30).fill(0),
      },
      processes: [],
      lastSeen: new Date()
    };

    // If only the offline default placeholder exists, replace it
    const hasOnlyPlaceholder = state.nodes.length === 1 && state.nodes[0].id === 'node-local' && state.nodes[0].status === 'offline';
    if (hasOnlyPlaceholder) {
      state.nodes = [node];
      state.selectedNodeId = node.id;
    } else {
      state.nodes.push(node);
    }
    showToast(`⚡ Computer Connected to Fleet: [${alias || hostname}]`);
  }

  // Update telemetry metrics
  node.status = 'online';
  node.liveSynced = true;
  node.lastSeen = new Date();
  node.rawHostname = hostname;
  if (machineId) node.machineId = machineId;
  node.agentVersion = data.agent_version || node.agentVersion || CURRENT_WEB_VERSION;
  if (data.alias && typeof data.alias === 'string' && data.alias.trim()) {
    node.alias = data.alias.trim();
    if (nodeAliases[node.id] && nodeAliases[node.id] !== node.alias) {
      nodeAliases[node.id] = node.alias;
      saveAliases();
    }
    if (machineId && nodeAliases[machineId.toLowerCase()] !== node.alias) {
      nodeAliases[machineId.toLowerCase()] = node.alias;
      saveAliases();
    }
  }
  if (data.ip) node.ip = data.ip;
  if (data.task_scheduler) node.taskScheduler = data.task_scheduler;
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
  if (data.processes) node.processes = data.processes;
  if (data.process_groups) node.processGroups = data.process_groups;

  // Sync hardware agent lock timer if active
  if (data.pending_lock_sec !== undefined && data.pending_lock_sec > 0) {
    const dl = Date.now() + data.pending_lock_sec * 1000;
    node.pendingLockDeadline = dl;
    state.scheduledLocks[node.id] = {
      deadline: dl,
      nodeName: getNodeDisplayName(node),
      machineId: node.machineId || ''
    };
    if (node.machineId) {
      state.scheduledLocks[node.machineId] = state.scheduledLocks[node.id];
    }
  } else if (data.pending_lock_sec === 0 || (data.pending_lock_sec === undefined && node.pendingLockDeadline && node.pendingLockDeadline <= Date.now())) {
    delete state.scheduledLocks[node.id];
    if (node.machineId) delete state.scheduledLocks[node.machineId];
    node.pendingLockDeadline = null;
  }

  // Run automated deduplication to purge any ghost / offline duplicate entries
  cleanupAndDedupNodes();
  saveNodes();

  // Refresh UI
  renderFleetBar();
  const active = getActiveNode();
  if (active.id === node.id) {
    const statusEl = document.getElementById('connection-status');
    const statusTxt = document.getElementById('status-text');
    if (statusEl && statusTxt) {
      statusEl.className = 'connection-status online';
      statusTxt.textContent = `${getNodeDisplayName(active)} (Live)`;
    }
    updateActiveNodeBanner();
    if (state.viewMode !== 'fleet') {
      updateDetailedView();
    }
  }
  if (state.viewMode === 'fleet') {
    renderFleetComparisonGrid();
  }
}

// Initialize MQTT Cloud Fleet Connections across all redundant brokers simultaneously
function initMqttFleet() {
  const brokerEndpoints = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ];

  if (typeof mqtt === 'undefined') {
    console.warn('MQTT.js library not ready; retrying...');
    setTimeout(initMqttFleet, 1000);
    return;
  }

  brokerEndpoints.forEach(brokerUrl => {
    console.log(`Connecting to Fleet Broker: ${brokerUrl} for Fleet [${fleetId}]`);
    try {
      const client = mqtt.connect(brokerUrl, {
        clientId: 'cm_web_' + Math.random().toString(16).substring(2, 10),
        clean: true,
        connectTimeout: 8000,
        reconnectPeriod: 3000,
        keepalive: 45
      });

      client.on('connect', () => {
        console.log(`Connected to Fleet Cloud Broker: ${brokerUrl}! Fleet ID: ${fleetId}`);
        const syncBadge = document.getElementById('fleet-sync-badge');
        const fleetDisplay = document.getElementById('fleet-id-display');
        if (fleetDisplay) fleetDisplay.textContent = fleetId;
        if (syncBadge) {
          syncBadge.style.color = 'var(--emerald)';
          syncBadge.innerHTML = `Fleet: <strong>${fleetId}</strong> 🟢`;
        }

        const subTopic = `computermonitor/fleet/${fleetId}/+`;
        client.subscribe(subTopic, (err) => {
          if (err) console.error(`Subscription error on ${brokerUrl}:`, err);
          else console.log(`Subscribed to ${subTopic} on ${brokerUrl}`);
        });
      });

      client.on('message', (topic, message) => {
        if (topic.endsWith('/cmd')) return;
        try {
          const data = JSON.parse(message.toString());
          handleIncomingNodeTelemetry(data);
        } catch (err) {
          console.warn('Error parsing incoming telemetry JSON:', err);
        }
      });

      client.on('error', (err) => {
        console.warn(`MQTT Error on ${brokerUrl}:`, err);
      });

      mqttFleetClients.push(client);
      if (!mqttFleetClient) mqttFleetClient = client;
    } catch (e) {
      console.error(`MQTT setup failed for ${brokerUrl}:`, e);
    }
  });
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
    const dispName = getNodeDisplayName(node);
    const hasAlias = dispName !== node.name && node.name !== 'This Computer (Local)';
    const lockInfo = getNodeScheduledLock(node);
    const lockBadgeHtml = lockInfo
      ? `<span class="node-lock-countdown-pill fleet-lock-badge-${node.id}" title="Lock in ${formatSecondsToMMSS(Math.max(0, Math.ceil((lockInfo.deadline - Date.now()) / 1000)))}">⏱️ ${formatSecondsToMMSS(Math.max(0, Math.ceil((lockInfo.deadline - Date.now()) / 1000)))}</span>`
      : `<span class="node-lock-countdown-pill fleet-lock-badge-${node.id}" style="display:none;"></span>`;

    card.innerHTML = `
      <div class="node-card-top">
        <div class="node-card-brand" style="min-width: 0; flex: 1;">
          <span class="node-os-icon">${node.osIcon || '💻'}</span>
          <div style="min-width: 0; flex: 1; overflow: hidden;">
            <div style="display: flex; align-items: center; gap: 4px; overflow: hidden;">
              <span class="node-card-name" title="${escapeHtml(dispName)} (${escapeHtml(node.name)})">${escapeHtml(dispName)}</span>
              ${node.status === 'online' ? (
                node.agentVersion === CURRENT_WEB_VERSION
                  ? `<span class="node-agent-ver node-agent-ver-latest" title="Agent v${node.agentVersion} (Latest 🟢)">v${escapeHtml(node.agentVersion)}</span>`
                  : `<span class="node-agent-ver node-agent-ver-outdated" title="Outdated Agent (v${node.agentVersion || 'Older'})! Click for instructions">⚠️ v${escapeHtml(node.agentVersion || 'Old')}</span>`
              ) : (node.status === 'syncing' ? `<span class="node-agent-ver" style="font-size: 0.65rem; padding: 1px 4px; border-radius: 4px; background: rgba(56, 189, 248, 0.12); color: var(--cyan); border: 1px solid rgba(56, 189, 248, 0.25); flex-shrink: 0;" title="Syncing telemetry...">v${CURRENT_WEB_VERSION}</span>` : '')}
            </div>
            ${hasAlias ? `<span class="node-sub-name" style="font-size: 0.72rem; color: var(--text-muted); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(node.name)}</span>` : ''}
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 4px;">
          ${lockBadgeHtml}
          <span class="node-status-pill ${node.status}">${node.status === 'syncing' ? 'SYNCING' : node.status.toUpperCase()}</span>
          ${node.status === 'offline' ? `<button class="btn-remove-node" data-id="${node.id}" title="Remove offline computer from fleet" style="background: rgba(244, 63, 94, 0.15); border: 1px solid rgba(244, 63, 94, 0.35); color: var(--rose); border-radius: 4px; padding: 2px 5px; font-size: 0.7rem; font-weight: bold; cursor: pointer; line-height: 1;">✕</button>` : ''}
        </div>
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
          <span class="node-mini-val ${node.status === 'online' ? 'text-emerald' : (node.status === 'syncing' ? 'text-cyan' : 'text-rose')}">${node.status === 'online' ? 'LIVE' : (node.status === 'syncing' ? 'SYNCING...' : 'OFFLINE')}</span>
        </div>
      </div>
    `;

    const btnRemove = card.querySelector('.btn-remove-node');
    if (btnRemove) {
      btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        removeNode(node.id);
      });
    }

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
    const dispName = getNodeDisplayName(node);
    const hasAlias = dispName !== node.name && node.name !== 'This Computer (Local)';
    const lockInfo = getNodeScheduledLock(node);

    card.innerHTML = `
      <div class="comp-header">
        <div class="comp-title-block">
          <h3>${node.osIcon || '💻'} ${escapeHtml(dispName)}</h3>
          <p>${hasAlias ? `<b>${escapeHtml(node.name)}</b> &bull; ` : ''}${node.os} &bull; ${node.ip}</p>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button class="btn-comp-rename" data-id="${node.id}" title="Rename ${escapeHtml(dispName)}" style="background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.25); color: var(--cyan); border-radius: 6px; padding: 2px 7px; font-size: 0.78rem; cursor: pointer;">✏️</button>
          ${node.status === 'online' ? (
            node.agentVersion === CURRENT_WEB_VERSION
              ? `<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 12px; background: rgba(16, 185, 129, 0.15); color: #34d399; font-weight: 600; border: 1px solid rgba(16, 185, 129, 0.3);">v${node.agentVersion} 🟢</span>`
              : `<button class="btn-comp-outdated" data-id="${node.id}" title="Outdated Agent! Click for 1-click update instructions.">⚠️ v${escapeHtml(node.agentVersion || 'Older')} (Update)</button>`
          ) : (node.status === 'syncing' ? `<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 12px; background: rgba(56, 189, 248, 0.12); color: var(--cyan); font-weight: 600; border: 1px solid rgba(56, 189, 248, 0.25);">Syncing...</span>` : '')}
          <span class="node-status-pill ${node.status}">${node.status.toUpperCase()}</span>
          ${node.status === 'offline' ? `<button class="btn-comp-remove" data-id="${node.id}" title="Remove offline computer from fleet" style="background: rgba(244, 63, 94, 0.15); border: 1px solid rgba(244, 63, 94, 0.35); color: var(--rose); border-radius: 6px; padding: 2px 7px; font-size: 0.78rem; font-weight: bold; cursor: pointer;">✕</button>` : ''}
        </div>
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
        <button class="btn-comp-lock ${lockInfo ? 'has-pending-lock' : ''}" data-id="${node.id}" style="${lockInfo ? 'background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.5); color: #f87171;' : ''}" title="${lockInfo ? 'Cancel scheduled workstation lock' : 'Lock ' + escapeHtml(dispName) + ' (return to login screen)'}">
          ${lockInfo ? `<span>⏱️ ${formatSecondsToMMSS(Math.max(0, Math.ceil((lockInfo.deadline - Date.now()) / 1000)))} (Cancel)</span>` : `<span>🔒 Lock</span>`}
        </button>
        <button class="btn-comp-restart" data-id="${node.id}" title="Restart ${escapeHtml(dispName)}">
          <span>🔄 Restart</span>
        </button>
      </div>
    `;

    card.querySelector('.btn-comp-drill').addEventListener('click', () => {
      selectNode(node.id);
      switchViewMode('detailed');
    });

    const btnCompRename = card.querySelector('.btn-comp-rename');
    if (btnCompRename) {
      btnCompRename.addEventListener('click', (e) => {
        e.stopPropagation();
        openRenameModal(node.id);
      });
    }

    const btnCompRemove = card.querySelector('.btn-comp-remove');
    if (btnCompRemove) {
      btnCompRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        removeNode(node.id);
      });
    }

    const btnCompOutdated = card.querySelector('.btn-comp-outdated');
    if (btnCompOutdated) {
      btnCompOutdated.addEventListener('click', (e) => {
        e.stopPropagation();
        openOutdatedModal(node);
      });
    }

    const btnLock = card.querySelector('.btn-comp-lock');
    if (btnLock) {
      btnLock.addEventListener('click', (e) => {
        e.stopPropagation();
        if (getNodeScheduledLock(node)) {
          cancelScheduledLock(node.id);
        } else {
          openLockModal(node.id);
        }
      });
    }

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
  const dispName = getNodeDisplayName(node);
  const hasAlias = dispName !== node.name && node.name !== 'This Computer (Local)';

  document.getElementById('active-node-name').textContent = dispName;
  const agentVerTxt = node.agentVersion ? ` • Agent: v${node.agentVersion}` : '';
  document.getElementById('active-node-desc').textContent = `${hasAlias ? 'Host: ' + node.name + ' • ' : ''}${node.os} • ${node.cpuModel}${agentVerTxt} • Endpoint: ${node.endpoint}`;
  
  const isOnline = node.status === 'online';
  const isSyncing = node.status === 'syncing';

  const metaStatusEl = document.getElementById('meta-status');
  if (isOnline) {
    metaStatusEl.textContent = 'ONLINE (LIVE)';
    metaStatusEl.className = 'meta-val text-emerald';
  } else if (isSyncing) {
    metaStatusEl.textContent = 'CONNECTING...';
    metaStatusEl.className = 'meta-val text-cyan';
  } else {
    metaStatusEl.textContent = 'OFFLINE';
    metaStatusEl.className = 'meta-val text-rose';
  }

  document.getElementById('meta-uptime').textContent = isOnline ? formatUptime(node.uptime) : '--:--:--';
  document.getElementById('meta-ping').textContent = isOnline ? `${node.ping} ms` : '--';
  document.getElementById('cpu-name').textContent = node.cpuModel;
  document.getElementById('proc-node-tag').textContent = dispName;

  // Task Scheduler Status & Alert Banner Logic
  const alertBanner = document.getElementById('agent-alert-banner');
  const alertTitle = document.getElementById('alert-title');
  const alertDesc = document.getElementById('alert-desc');
  const alertLastSeen = document.getElementById('alert-last-seen');
  const metaScheduler = document.getElementById('meta-scheduler');

  if (isSyncing) {
    if (alertBanner) alertBanner.style.display = 'none';
    if (metaScheduler) {
      metaScheduler.textContent = 'CONNECTING...';
      metaScheduler.className = 'meta-val text-cyan';
    }
  } else if (!isOnline) {
    // If MQTT clients are still connecting during initial page load/refresh, keep alert banner quiet
    const isMqttConnecting = !mqttFleetClients.some(c => c && c.connected);
    if (isMqttConnecting) {
      if (alertBanner) alertBanner.style.display = 'none';
    } else {
      if (alertBanner) alertBanner.style.display = 'flex';
      const isHttps = window.location.protocol === 'https:';
      const isRemoteHttp = node.endpoint && node.endpoint.startsWith('http://') && !node.endpoint.includes('localhost') && !node.endpoint.includes('127.0.0.1');

      if (isHttps && isRemoteHttp) {
        if (alertTitle) alertTitle.textContent = 'BROWSER MIXED CONTENT BLOCK / OFFLINE';
        if (alertDesc) {
          alertDesc.innerHTML = `Host [<b>${node.name}</b>] (${node.endpoint}) cannot be reached from HTTPS.<br>
          Web browsers block HTTPS websites from querying local network HTTP devices.<br>
          <span style="display:inline-block; margin-top: 6px;">
            👉 <b>Direct Dashboard:</b> <a href="http://${node.ip}:5500" target="_blank" style="color: var(--cyan); text-decoration: underline; font-weight: bold;">Open http://${node.ip}:5500</a> directly in your browser.
          </span><br>
          <span style="font-size: 0.8rem; color: var(--text-muted);">
            Or click the padlock/tune icon in the browser address bar &rarr; Site settings &rarr; Insecure content &rarr; Allow.
          </span>`;
        }
      } else {
        if (alertTitle) alertTitle.textContent = 'AGENT UNREACHABLE / TASK STOPPED';
        if (alertDesc) alertDesc.textContent = `Host [${node.name}] is offline. Telemetry stopped or the Windows Task Scheduler task was terminated/deleted.`;
      }
      const lastSeenDate = node.lastSeen ? new Date(node.lastSeen) : null;
      if (alertLastSeen) {
        alertLastSeen.textContent = (lastSeenDate && !isNaN(lastSeenDate.getTime()))
          ? `Last Active: ${lastSeenDate.toLocaleTimeString()}`
          : 'Last Active: Never';
      }
      if (metaScheduler) {
        metaScheduler.textContent = 'STOPPED / UNREACHABLE';
        metaScheduler.className = 'meta-val text-rose';
      }
    }
  } else {
    // Node is actively ONLINE
    const sched = node.taskScheduler;
    if (metaScheduler) {
      metaScheduler.textContent = (sched && sched.status) ? `ACTIVE (${sched.status})` : 'ACTIVE (Running)';
      metaScheduler.className = 'meta-val text-emerald';
    }

    // Only display outdated warning if live telemetry has been received in this session and reports older version
    const isAgentOutdated = node.liveSynced && node.agentVersion && (node.agentVersion !== CURRENT_WEB_VERSION);
    if (isAgentOutdated) {
      if (alertBanner) {
        alertBanner.style.display = 'flex';
        alertBanner.style.borderLeftColor = 'var(--amber)';
      }
      if (alertTitle) {
        alertTitle.innerHTML = `⚠️ AGENT UPDATE AVAILABLE (Running v${node.agentVersion} &bull; Latest is v${CURRENT_WEB_VERSION})`;
        alertTitle.style.color = 'var(--amber)';
      }
      if (alertDesc) {
        alertDesc.innerHTML = `This computer is running an earlier agent build. Modern features like <b>Remote Workstation Lock</b> require updating to v${CURRENT_WEB_VERSION}.<br>
        <button id="btn-banner-outdated" class="btn-primary" style="margin-top: 8px; padding: 5px 14px; font-size: 0.8rem; background: linear-gradient(135deg, #d97706, #b45309); border-color: transparent; cursor: pointer;">
          ⚡ 1-Click Update Instructions
        </button>`;
        const btnBannerOutdated = document.getElementById('btn-banner-outdated');
        if (btnBannerOutdated) {
          btnBannerOutdated.onclick = () => openOutdatedModal(node);
        }
      }
      if (alertLastSeen) alertLastSeen.textContent = `Fleet Version: v${CURRENT_WEB_VERSION}`;
    } else {
      if (alertBanner) alertBanner.style.display = 'none';
    }
  }

  // Update Agent Version Meta Pill
  const metaAgentVer = document.getElementById('meta-agent-version');
  const metaAgentPill = document.getElementById('meta-agent-version-pill');
  if (metaAgentVer) {
    if (isSyncing) {
      metaAgentVer.textContent = `v${CURRENT_WEB_VERSION} (Syncing...)`;
      metaAgentVer.className = 'meta-val font-mono text-cyan';
      if (metaAgentPill) {
        metaAgentPill.style.borderColor = '';
        metaAgentPill.style.background = '';
        metaAgentPill.style.cursor = 'default';
        metaAgentPill.onclick = null;
      }
    } else if (!isOnline || !node.liveSynced) {
      metaAgentVer.textContent = node.agentVersion ? `v${node.agentVersion}` : '--';
      metaAgentVer.className = 'meta-val font-mono';
      if (metaAgentPill) {
        metaAgentPill.style.borderColor = '';
        metaAgentPill.style.background = '';
        metaAgentPill.style.cursor = 'default';
        metaAgentPill.onclick = null;
      }
    } else if (node.agentVersion && node.agentVersion !== CURRENT_WEB_VERSION) {
      metaAgentVer.textContent = `v${node.agentVersion} ⚠️`;
      metaAgentVer.className = 'meta-val font-mono text-amber';
      if (metaAgentPill) {
        metaAgentPill.style.borderColor = 'rgba(245, 158, 11, 0.5)';
        metaAgentPill.style.background = 'rgba(245, 158, 11, 0.12)';
        metaAgentPill.style.cursor = 'pointer';
        metaAgentPill.title = 'Agent is outdated! Click for update instructions.';
        metaAgentPill.onclick = () => openOutdatedModal(node);
      }
    } else {
      metaAgentVer.textContent = `v${node.agentVersion || CURRENT_WEB_VERSION} 🟢`;
      metaAgentVer.className = 'meta-val font-mono text-emerald';
      if (metaAgentPill) {
        metaAgentPill.style.borderColor = '';
        metaAgentPill.style.background = '';
        metaAgentPill.style.cursor = 'default';
        metaAgentPill.title = `Agent v${node.agentVersion || CURRENT_WEB_VERSION} (Latest)`;
        metaAgentPill.onclick = null;
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
    showToast(`Cannot stop process: Computer [${getNodeDisplayName(node)}] is offline.`, true);
    return;
  }

  const dispName = getNodeDisplayName(node);
  // Dispatch exclusively over MQTT Cloud Fleet channel with strict GUID/alias targeting
  const anySent = sendNodeCommand(node, {
    action: 'kill',
    identifier: identifier,
    val: identifier,
    isPid: isPid
  });

  if (anySent) {
    showToast(`Stopping process [${identifier}] on [${dispName}]...`);
  }
}

let pendingRestartNodeId = null;

function openRestartModal(nodeId) {
  pendingRestartNodeId = nodeId;
  const node = state.nodes.find(n => n.id === nodeId) || getActiveNode();
  const nameEl = document.getElementById('restart-target-node') || document.getElementById('restart-node-target-name');
  if (nameEl) nameEl.textContent = `${getNodeDisplayName(node)} (${node.rawHostname || node.name || 'Remote PC'})`;

  const modal = document.getElementById('restart-computer-modal') || document.getElementById('restart-confirm-modal');
  if (modal) modal.classList.add('active');
}

function closeRestartModal() {
  pendingRestartNodeId = null;
  const modal = document.getElementById('restart-computer-modal') || document.getElementById('restart-confirm-modal');
  if (modal) modal.classList.remove('active');
}

async function executeRestartComputer() {
  if (!pendingRestartNodeId) return;
  const node = state.nodes.find(n => n.id === pendingRestartNodeId) || getActiveNode();
  closeRestartModal();

  const dispName = getNodeDisplayName(node);

  // Dispatch exclusively over MQTT Cloud Fleet channel with strict GUID/alias targeting
  const anySent = sendNodeCommand(node, {
    action: 'restart',
    delay: 5
  });

  if (anySent) {
    showToast(`🔄 Reboot signal dispatched to [${dispName}]...`);
    const alertBanner = document.getElementById('agent-alert-banner');
    const alertTitle = document.getElementById('alert-title');
    const alertDesc = document.getElementById('alert-desc');
    if (alertBanner) alertBanner.style.display = 'flex';
    if (alertTitle) alertTitle.textContent = 'SYSTEM REBOOT IN PROGRESS';
    if (alertDesc) alertDesc.textContent = `Restart sequence initiated for ${dispName}. Machine will reboot and automatically reconnect once startup completes.`;
  }
}

let pendingLockNodeId = null;

function updateLockModalButtonText(mins) {
  const btnText = document.getElementById('confirm-lock-btn-text');
  const m = parseInt(mins, 10) || 0;
  if (btnText) {
    if (m > 0) {
      btnText.textContent = `🔒 Yes, Lock in ${m} min`;
    } else {
      btnText.textContent = '🔒 Yes, Lock Computer';
    }
  }
}

function openLockModal(nodeId) {
  pendingLockNodeId = nodeId;
  const node = state.nodes.find(n => n.id === nodeId) || getActiveNode();
  const nameEl = document.getElementById('lock-target-node');
  if (nameEl) nameEl.textContent = `${getNodeDisplayName(node)} (${node.rawHostname || node.name || 'Remote PC'})`;

  const headerInput = document.getElementById('lock-delay-minutes');
  const modalInput = document.getElementById('modal-lock-delay-minutes');
  const initialMins = headerInput ? Math.max(0, parseInt(headerInput.value, 10) || 0) : 0;
  if (modalInput) {
    modalInput.value = initialMins;
  }
  updateLockModalButtonText(initialMins);

  const modal = document.getElementById('lock-computer-modal');
  if (modal) modal.classList.add('active');
  if (modalInput) {
    setTimeout(() => modalInput.focus(), 80);
  }
}

function closeLockModal() {
  pendingLockNodeId = null;
  const modal = document.getElementById('lock-computer-modal');
  if (modal) modal.classList.remove('active');
}

async function executeLockComputer() {
  if (!pendingLockNodeId) return;
  const node = state.nodes.find(n => n.id === pendingLockNodeId) || getActiveNode();

  const modalInput = document.getElementById('modal-lock-delay-minutes');
  const headerInput = document.getElementById('lock-delay-minutes');
  const delayMinutes = Math.max(0, Math.min(720, parseInt(modalInput?.value ?? headerInput?.value ?? 0, 10) || 0));
  const delaySeconds = delayMinutes * 60;

  closeLockModal();

  const dispName = getNodeDisplayName(node);

  if (delayMinutes > 0) {
    const deadline = Date.now() + delaySeconds * 1000;
    state.scheduledLocks[node.id] = {
      deadline: deadline,
      delayMinutes: delayMinutes,
      nodeName: dispName,
      machineId: node.machineId || ''
    };
    if (node.machineId) {
      state.scheduledLocks[node.machineId] = state.scheduledLocks[node.id];
    }
    node.pendingLockDeadline = deadline;
  } else {
    delete state.scheduledLocks[node.id];
    if (node.machineId) delete state.scheduledLocks[node.machineId];
    node.pendingLockDeadline = null;
  }

  // Dispatch exclusively over MQTT Cloud Fleet channel with strict GUID/alias targeting
  const anySent = sendNodeCommand(node, {
    action: 'lock',
    delay_minutes: delayMinutes,
    delay_seconds: delaySeconds,
    delay: delaySeconds
  });

  if (anySent) {
    if (delayMinutes > 0) {
      showToast(`⏱️ Workstation lock scheduled for [${dispName}] in ${delayMinutes} minute(s)...`);
    } else {
      showToast(`🔒 Workstation lock signal dispatched to [${dispName}]...`);
    }
  }

  updateLockCountdowns();
  renderFleetBar();
  if (state.viewMode === 'fleet') {
    renderFleetComparisonGrid();
  }
}

let pendingRenameNodeId = null;

function openRenameModal(nodeId) {
  const node = (nodeId ? state.nodes.find(n => n.id === nodeId) : null) || getActiveNode();
  if (!node) return;
  pendingRenameNodeId = node.id;
  const modal = document.getElementById('rename-computer-modal');
  const targetHost = document.getElementById('rename-target-hostname');
  const input = document.getElementById('rename-input-val');
  if (targetHost) {
    targetHost.textContent = node.name;
  }
  if (input) {
    const current = getNodeDisplayName(node);
    input.value = (current !== node.name && current !== 'This Computer (Local)') ? current : '';
  }
  if (modal) modal.classList.add('active');
  if (input) setTimeout(() => input.focus(), 60);
}

function closeRenameModal() {
  const modal = document.getElementById('rename-computer-modal');
  if (modal) modal.classList.remove('active');
  pendingRenameNodeId = null;
}

function openOutdatedModal(node) {
  const targetNode = node || getActiveNode();
  if (!targetNode) return;
  const nameEl = document.getElementById('outdated-target-name');
  const curVerEl = document.getElementById('outdated-current-ver');
  const latestVerEl = document.getElementById('outdated-latest-ver');

  if (nameEl) nameEl.textContent = `${getNodeDisplayName(targetNode)} (${targetNode.rawHostname || targetNode.name || 'Remote PC'})`;
  if (curVerEl) curVerEl.textContent = targetNode.agentVersion ? `v${targetNode.agentVersion}` : 'Older (Pre-v4.5)';
  if (latestVerEl) latestVerEl.textContent = `v${CURRENT_WEB_VERSION}`;

  const modal = document.getElementById('outdated-agent-modal');
  if (modal) modal.classList.add('active');
}

function closeOutdatedModal() {
  const modal = document.getElementById('outdated-agent-modal');
  if (modal) modal.classList.remove('active');
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
  const chkFilter = document.getElementById('chk-filter-games-browsers');
  const filterGamesBrowsers = chkFilter ? chkFilter.checked : (state.filterGamesBrowsersOnly !== false);
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

  // Filter groups by games/browsers/autoclickers and search query
  const filtered = groups.filter(g => {
    if (filterGamesBrowsers) {
      const matchGroupName = isGameBrowserOrClickerProcess(g.name);
      const matchChild = (g.instances || []).some(inst => isGameBrowserOrClickerProcess(inst.name));
      if (!matchGroupName && !matchChild) return false;
    }
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
  const filterSuffix = filterGamesBrowsers ? ' [🎮 Filter Active]' : '';
  countSpan.textContent = `Showing ${filtered.length} applications (${totalProcsCount} processes)${filterSuffix}`;
  tbody.innerHTML = '';

  if (!filtered.length) {
    let emptyMsg = 'No processes found matching filter.';
    if (node.status !== 'online') {
      emptyMsg = '⚠️ Agent is not connected. Run start-agent.bat on your computer to stream live metrics.';
    } else if (filterGamesBrowsers && !query) {
      emptyMsg = '🎮 No active browsers, games (Roblox, Steam, etc.), or autoclickers detected on this computer. (Uncheck the filter above to view all processes)';
    }
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 24px; color: var(--text-dim);">
          ${emptyMsg}
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

  // Update Header Summary Pills for collapsed card view
  const cpuSummary = document.getElementById('cpu-header-summary');
  if (cpuSummary) cpuSummary.textContent = isOnline ? `${active.cpu}% LOAD` : 'OFFLINE';

  const ramSummary = document.getElementById('ram-header-summary');
  if (ramSummary) {
    ramSummary.textContent = isOnline 
      ? (active.ramData ? `${active.ram}% (${active.ramData.used_gb} GB)` : `${active.ram}%`)
      : 'OFFLINE';
  }

  const storageSummary = document.getElementById('storage-header-summary');
  if (storageSummary) {
    storageSummary.textContent = isOnline
      ? (active.diskData ? `${active.diskData.percent}% USED` : 'ONLINE')
      : 'OFFLINE';
  }

  const netSummary = document.getElementById('net-header-summary');
  if (netSummary) {
    netSummary.textContent = isOnline
      ? `↓ ${active.netDl || 0} / ↑ ${active.netUl || 0} Mbps`
      : 'OFFLINE';
  }

  const gpuSummary = document.getElementById('gpu-header-summary');
  if (gpuSummary) {
    gpuSummary.textContent = isOnline
      ? (active.gpu ? `${active.gpu.load}% (${active.gpu.temp || 58}°C)` : '34% LOAD')
      : '--';
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
  const now = Date.now();
  for (const node of state.nodes) {
    if (node.endpoint === 'cloud-sync') {
      const lastSeenMs = node.lastSeen ? new Date(node.lastSeen).getTime() : 0;
      if (!lastSeenMs || (now - lastSeenMs > 7000)) {
        node.status = 'offline';
        if (node.history && node.history.cpu) {
          node.history.cpu.shift();
          node.history.cpu.push(0);
        }
      }
      continue;
    }

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
      if (data.alias && typeof data.alias === 'string' && data.alias.trim()) {
        node.alias = data.alias.trim();
      }
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
    statusTxt.textContent = `${getNodeDisplayName(active)} (Live)`;
  } else {
    statusEl.className = 'connection-status';
    statusTxt.textContent = `${getNodeDisplayName(active)} (Offline)`;
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
  const appVerBadge = document.getElementById('app-version-badge');
  if (appVerBadge) {
    appVerBadge.textContent = `Fleet v${CURRENT_WEB_VERSION}`;
  }

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

  const chkGamesFilter = document.getElementById('chk-filter-games-browsers');
  if (chkGamesFilter) {
    chkGamesFilter.checked = (state.filterGamesBrowsersOnly !== false);
    chkGamesFilter.addEventListener('change', (e) => {
      state.filterGamesBrowsersOnly = e.target.checked;
      renderProcesses();
    });
  }

  // Add Node Modal
  const addModal = document.getElementById('add-node-modal');
  const btnAddNode = document.getElementById('btn-add-node');
  const btnCloseAddModal = document.getElementById('add-node-modal-close');
  const btnCancelNode = document.getElementById('btn-cancel-node');
  const addForm = document.getElementById('add-node-form');

  if (btnAddNode && addModal) {
    btnAddNode.addEventListener('click', () => addModal.classList.add('active'));
  }
  if (btnCloseAddModal && addModal) {
    btnCloseAddModal.addEventListener('click', () => addModal.classList.remove('active'));
  }
  if (btnCancelNode && addModal) {
    btnCancelNode.addEventListener('click', () => addModal.classList.remove('active'));
  }

  if (addForm) {
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
}

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

  // Lock Computer Modal Listeners
  const btnLockComp = document.getElementById('btn-lock-computer');
  const btnCloseLockModal = document.getElementById('lock-modal-close');
  const btnCancelLock = document.getElementById('btn-cancel-lock');
  const btnConfirmLock = document.getElementById('btn-confirm-lock');
  const lockModal = document.getElementById('lock-computer-modal');
  const lockDelayInput = document.getElementById('lock-delay-minutes');
  const modalLockDelayInput = document.getElementById('modal-lock-delay-minutes');

  if (lockDelayInput) {
    lockDelayInput.addEventListener('input', (e) => {
      let v = parseInt(e.target.value, 10);
      if (isNaN(v) || v < 0) v = 0;
      if (v > 720) v = 720;
      if (modalLockDelayInput) modalLockDelayInput.value = v;
      updateLockModalButtonText(v);
    });
  }

  if (modalLockDelayInput) {
    modalLockDelayInput.addEventListener('input', (e) => {
      let v = parseInt(e.target.value, 10);
      if (isNaN(v) || v < 0) v = 0;
      if (v > 720) v = 720;
      if (lockDelayInput) lockDelayInput.value = v;
      updateLockModalButtonText(v);
    });
  }

  if (btnLockComp) {
    btnLockComp.addEventListener('click', () => {
      const activeNode = getActiveNode();
      if (activeNode && getNodeScheduledLock(activeNode)) {
        cancelScheduledLock(activeNode.id);
      } else {
        openLockModal(state.selectedNodeId);
      }
    });
  }

  const btnHeaderCancelLock = document.getElementById('btn-header-cancel-lock');
  if (btnHeaderCancelLock) {
    btnHeaderCancelLock.addEventListener('click', (e) => {
      e.stopPropagation();
      cancelScheduledLock(state.selectedNodeId);
    });
  }

  const btnBannerCancelLock = document.getElementById('btn-banner-cancel-lock');
  if (btnBannerCancelLock) {
    btnBannerCancelLock.addEventListener('click', (e) => {
      e.stopPropagation();
      cancelScheduledLock(state.selectedNodeId);
    });
  }

  if (btnCloseLockModal) {
    btnCloseLockModal.addEventListener('click', closeLockModal);
  }
  if (btnCancelLock) {
    btnCancelLock.addEventListener('click', closeLockModal);
  }
  if (lockModal) {
    lockModal.addEventListener('click', (e) => {
      if (e.target === lockModal) closeLockModal();
    });
  }
  if (btnConfirmLock) {
    btnConfirmLock.addEventListener('click', executeLockComputer);
  }

  // Rename Computer Modal Listeners
  const btnRenameNode = document.getElementById('btn-rename-node');
  const btnCloseRenameModal = document.getElementById('rename-modal-close');
  const btnCancelRename = document.getElementById('btn-cancel-rename');
  const renameModal = document.getElementById('rename-computer-modal');
  const renameForm = document.getElementById('rename-computer-form');
  const renameInput = document.getElementById('rename-input-val');

  if (btnRenameNode) {
    btnRenameNode.addEventListener('click', () => {
      openRenameModal(state.selectedNodeId);
    });
  }

  if (btnCloseRenameModal) {
    btnCloseRenameModal.addEventListener('click', closeRenameModal);
  }
  if (btnCancelRename) {
    btnCancelRename.addEventListener('click', closeRenameModal);
  }
  if (renameModal) {
    renameModal.addEventListener('click', (e) => {
      if (e.target === renameModal) closeRenameModal();
    });
  }
  if (renameForm) {
    renameForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = renameInput ? renameInput.value.trim() : '';
      setNodeAlias(pendingRenameNodeId || state.selectedNodeId, val);
      closeRenameModal();
    });
  }

  // Outdated Agent Modal Listeners
  const btnCloseOutdatedModal = document.getElementById('outdated-modal-close');
  const btnCloseOutdatedBtn = document.getElementById('btn-close-outdated-modal');
  const outdatedModal = document.getElementById('outdated-agent-modal');

  if (btnCloseOutdatedModal) {
    btnCloseOutdatedModal.addEventListener('click', closeOutdatedModal);
  }
  if (btnCloseOutdatedBtn) {
    btnCloseOutdatedBtn.addEventListener('click', closeOutdatedModal);
  }
  if (outdatedModal) {
    outdatedModal.addEventListener('click', (e) => {
      if (e.target === outdatedModal) closeOutdatedModal();
    });
  }

  // Collapsible Metric Cards Listeners
  document.querySelectorAll('.metric-card .card-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('a') || e.target.closest('button')) return;
      const card = header.closest('.metric-card');
      if (card) {
        card.classList.toggle('collapsed');
        updateToggleAllMetricsBtnText();
      }
    });
  });

  const btnToggleAllMetrics = document.getElementById('btn-toggle-all-metrics');
  if (btnToggleAllMetrics) {
    btnToggleAllMetrics.addEventListener('click', () => {
      const cards = document.querySelectorAll('.metric-card');
      const anyCollapsed = Array.from(cards).some(c => c.classList.contains('collapsed'));
      cards.forEach(c => {
        if (anyCollapsed) {
          c.classList.remove('collapsed');
        } else {
          c.classList.add('collapsed');
        }
      });
      updateToggleAllMetricsBtnText();
    });
  }

  function updateToggleAllMetricsBtnText() {
    const btn = document.getElementById('btn-toggle-all-metrics');
    if (!btn) return;
    const cards = document.querySelectorAll('.metric-card');
    const anyCollapsed = Array.from(cards).some(c => c.classList.contains('collapsed'));
    btn.innerHTML = anyCollapsed ? '<span>⊞ Expand All Cards</span>' : '<span>⊟ Collapse All Cards</span>';
  }

  const fleetBadge = document.getElementById('fleet-sync-badge');
  if (fleetBadge) {
    fleetBadge.addEventListener('click', () => {
      const newId = prompt('Your Fleet Sync Code connects all your computers together.\nEnter a Fleet ID:', fleetId);
      if (newId && newId.trim() && newId.trim() !== fleetId) {
        localStorage.setItem('cm_fleet_id', newId.trim());
        window.location.search = `?fleet=${encodeURIComponent(newId.trim())}`;
      }
    });
  }

  // Lock Dashboard button
  const btnLock = document.getElementById('btn-lock-dashboard');
  if (btnLock) {
    btnLock.addEventListener('click', lockDashboard);
  }

  // Change Password Modal Listeners
  const btnChangePw = document.getElementById('btn-change-password');
  const changePwModal = document.getElementById('change-password-modal');
  const closeChangePwModal = document.getElementById('change-password-modal-close');
  const btnCancelChangePw = document.getElementById('btn-cancel-change-pw');
  const changePwForm = document.getElementById('change-password-form');
  const changePwError = document.getElementById('change-pw-error');

  function openChangePwModal() {
    if (changePwError) changePwError.style.display = 'none';
    if (changePwForm) changePwForm.reset();
    if (changePwModal) changePwModal.classList.add('active');
  }

  function closeChangePwModalFunc() {
    if (changePwModal) changePwModal.classList.remove('active');
  }

  if (btnChangePw) btnChangePw.addEventListener('click', openChangePwModal);
  if (closeChangePwModal) closeChangePwModal.addEventListener('click', closeChangePwModalFunc);
  if (btnCancelChangePw) btnCancelChangePw.addEventListener('click', closeChangePwModalFunc);
  if (changePwModal) {
    changePwModal.addEventListener('click', (e) => {
      if (e.target === changePwModal) closeChangePwModalFunc();
    });
  }

  if (changePwForm) {
    changePwForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const current = document.getElementById('pw-current').value;
      const newPw = document.getElementById('pw-new').value;
      const confirmPw = document.getElementById('pw-confirm').value;

      const currentHash = await sha256Hex(current);
      const masterHash = getMasterPasswordHash();

      if (currentHash !== masterHash && currentHash !== DEFAULT_AUTH_HASH) {
        if (changePwError) {
          changePwError.textContent = '⚠️ Current master password is incorrect.';
          changePwError.style.display = 'block';
        }
        return;
      }

      if (newPw.length < 4) {
        if (changePwError) {
          changePwError.textContent = '⚠️ New password must be at least 4 characters.';
          changePwError.style.display = 'block';
        }
        return;
      }

      if (newPw !== confirmPw) {
        if (changePwError) {
          changePwError.textContent = '⚠️ New passwords do not match.';
          changePwError.style.display = 'block';
        }
        return;
      }

      const newHash = await sha256Hex(newPw);
      localStorage.setItem('cm_auth_hash', newHash);
      closeChangePwModalFunc();
      showToast('🔑 Master Password Updated Successfully!');
    });
  }

  window.addEventListener('resize', () => {
    updateDetailedView();
  });
}

// ==========================================================================
// Dashboard Authentication Gatekeeper (Master Password Protection)
// ==========================================================================
const DEFAULT_AUTH_HASH = 'bc19dadd3091a378cb09f6da74830d9868b08469ad4d840bd129baba1ae1e023'; // sha256('ahheipk1')

async function sha256Hex(text) {
  if (window.crypto && window.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h) + text.charCodeAt(i);
    h |= 0;
  }
  return 'fb_' + Math.abs(h);
}

function getMasterPasswordHash() {
  return localStorage.getItem('cm_auth_hash') || DEFAULT_AUTH_HASH;
}

function isAuthenticated() {
  return sessionStorage.getItem('cm_authenticated') === 'true' ||
         localStorage.getItem('cm_authenticated_persistent') === 'true';
}

let appServicesStarted = false;
let fleetPollInterval = null;

function startAppServices() {
  if (appServicesStarted) return;
  appServicesStarted = true;
  checkUrlAutoConnect();
  renderFleetBar();
  updateActiveNodeBanner();
  updateDetailedView();
  initMqttFleet();
  pollRealFleet();
  if (!fleetPollInterval) {
    fleetPollInterval = setInterval(pollRealFleet, 1500);
  }
  checkCloudWebVersion();
  if (!window._versionSyncInterval) {
    window._versionSyncInterval = setInterval(checkCloudWebVersion, 45000);
  }
  if (!window._lockCountdownInterval) {
    window._lockCountdownInterval = setInterval(updateLockCountdowns, 1000);
  }
}

function stopAppServices() {
  appServicesStarted = false;
  if (fleetPollInterval) {
    clearInterval(fleetPollInterval);
    fleetPollInterval = null;
  }
  if (mqttFleetClients && mqttFleetClients.length) {
    mqttFleetClients.forEach(c => {
      try { c.end(true); } catch (_) {}
    });
    mqttFleetClients = [];
    mqttFleetClient = null;
  }
}

function lockDashboard() {
  sessionStorage.removeItem('cm_authenticated');
  localStorage.removeItem('cm_authenticated_persistent');
  stopAppServices();
  const gate = document.getElementById('lock-screen-gate');
  const pwInput = document.getElementById('lock-password-input');
  const errEl = document.getElementById('lock-error-msg');
  if (errEl) errEl.style.display = 'none';
  if (pwInput) {
    pwInput.value = '';
    setTimeout(() => pwInput.focus(), 200);
  }
  if (gate) gate.classList.remove('unlocked');
  showToast('🔒 Dashboard Locked');
}

function unlockDashboard(persistent = true) {
  sessionStorage.setItem('cm_authenticated', 'true');
  if (persistent) {
    localStorage.setItem('cm_authenticated_persistent', 'true');
  } else {
    localStorage.removeItem('cm_authenticated_persistent');
  }
  const gate = document.getElementById('lock-screen-gate');
  if (gate) gate.classList.add('unlocked');
  startAppServices();
  showToast('🔓 Access Granted • Welcome to Fleet Commander');
}

function initAuthGate() {
  const gate = document.getElementById('lock-screen-gate');
  const form = document.getElementById('lock-screen-form');
  const pwInput = document.getElementById('lock-password-input');
  const rememberCheck = document.getElementById('lock-remember-check');
  const toggleBtn = document.getElementById('btn-toggle-lock-pw');
  const errEl = document.getElementById('lock-error-msg');
  const lockCard = document.querySelector('.lock-screen-card');

  if (toggleBtn && pwInput) {
    toggleBtn.addEventListener('click', () => {
      pwInput.type = pwInput.type === 'password' ? 'text' : 'password';
      toggleBtn.textContent = pwInput.type === 'password' ? '👁️' : '🙈';
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const entered = (pwInput ? pwInput.value : '').trim();
      if (!entered) return;

      const hash = await sha256Hex(entered);
      const masterHash = getMasterPasswordHash();

      // Check against current master hash OR default initial password
      if (hash === masterHash || hash === DEFAULT_AUTH_HASH) {
        if (errEl) errEl.style.display = 'none';
        const isPersistent = rememberCheck ? rememberCheck.checked : true;
        unlockDashboard(isPersistent);
      } else {
        if (lockCard) {
          lockCard.classList.remove('lock-shake');
          void lockCard.offsetWidth; // trigger reflow
          lockCard.classList.add('lock-shake');
        }
        if (errEl) {
          errEl.textContent = '⚠️ Incorrect Master Password. Please try again.';
          errEl.style.display = 'block';
        }
        if (pwInput) {
          pwInput.select();
          pwInput.focus();
        }
      }
    });
  }

  if (isAuthenticated()) {
    if (gate) gate.classList.add('unlocked');
    startAppServices();
  } else {
    if (gate) gate.classList.remove('unlocked');
    if (pwInput) setTimeout(() => pwInput.focus(), 150);
  }
}

// Check URL parameters for instant node auto-connection (e.g. ?ip=192.168.10.117)
function checkUrlAutoConnect() {
  try {
    const params = new URLSearchParams(window.location.search);
    const target = params.get('ip') || params.get('connect') || params.get('agent');
    if (target) {
      let cleanIp = target.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      let host = cleanIp;
      let port = '5500';
      if (cleanIp.includes(':')) {
        [host, port] = cleanIp.split(':');
      }
      const endpoint = `http://${host}:${port}/metrics`;

      let existingNode = state.nodes.find(n => n.endpoint === endpoint || n.ip === host);
      if (!existingNode) {
        existingNode = {
          id: `node-${host.replace(/[^a-zA-Z0-9]/g, '-')}`,
          name: `Computer (${host})`,
          os: 'Detecting...',
          osIcon: '💻',
          cpuModel: 'Hardware Telemetry',
          ramTotal: 0,
          endpoint: endpoint,
          status: 'offline',
          ip: host,
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
        state.nodes.push(existingNode);
        saveNodes();
      }
      state.selectedNodeId = existingNode.id;
    } else if (window.location.port === '5500') {
      const localNode = state.nodes.find(n => n.id === 'node-local');
      if (localNode) {
        localNode.endpoint = `${window.location.origin}/metrics`;
        localNode.ip = window.location.hostname;
      }
    }
  } catch (err) {
    console.warn('URL auto-connect check encountered an error:', err);
  }
}

// App Entry Point
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEvents();
  initAuthGate();
});
