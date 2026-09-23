// ComputerMonitor Tab Tracker - Background Service Worker
const AGENT_API = 'http://127.0.0.1:5500/api/browser_tabs';
let syncTimeout = null;

function getDomain(urlStr) {
  if (!urlStr) return '';
  try {
    if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
      return new URL(urlStr).hostname;
    }
    if (urlStr.startsWith('chrome://')) return 'Chrome Internal';
    if (urlStr.startsWith('edge://')) return 'Edge Internal';
    return urlStr.split('/')[0] || '';
  } catch (e) {
    return '';
  }
}

async function syncTabs() {
  try {
    const allTabs = await chrome.tabs.query({});
    const mapped = allTabs.map(t => ({
      id: t.id,
      window_id: t.windowId,
      title: t.title || 'Untitled Tab',
      url: t.url || '',
      domain: getDomain(t.url),
      active: Boolean(t.active),
      pinned: Boolean(t.pinned),
      favIconUrl: t.favIconUrl || ''
    }));

    const browserName = navigator.userAgent.includes('Edg/') ? 'Edge' : 'Chrome';

    const resp = await fetch(AGENT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        browser: browserName,
        tabs: mapped,
        timestamp: Date.now()
      })
    });

    if (resp.ok) {
      const result = await resp.json();
      if (result.close_tabs && Array.isArray(result.close_tabs) && result.close_tabs.length > 0) {
        let closedAny = false;
        for (const tid of result.close_tabs) {
          try {
            await chrome.tabs.remove(Number(tid));
            closedAny = true;
          } catch (err) {
            console.log('Tab already closed or invalid:', tid);
          }
        }
        if (closedAny) {
          setTimeout(syncTabs, 300);
        }
      }
    }
  } catch (err) {
    // Agent may be stopped or restarting; silently ignore connection errors
  }
}

function scheduleSync(delayMs = 300) {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(syncTabs, delayMs);
}

// Tab lifecycle events
chrome.tabs.onActivated.addListener(() => scheduleSync(100));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || changeInfo.url || changeInfo.title) {
    scheduleSync(300);
  }
});
chrome.tabs.onRemoved.addListener(() => scheduleSync(150));
chrome.tabs.onCreated.addListener(() => scheduleSync(300));

// Regular heartbeat poll every 3 seconds to check for remote close commands
setInterval(syncTabs, 3000);

// Initial sync on startup
syncTabs();
