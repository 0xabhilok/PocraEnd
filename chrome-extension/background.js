// Chrome extension service worker.
// Reports tab changes to PocraEnd via WebSocket on localhost:7842.

const WS_URL = 'ws://127.0.0.1:7842';
let ws = null;
let reconnectTimer = null;

function connect() {
  // Avoid stacking duplicate sockets when connect() is triggered repeatedly.
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }
  try {
    ws = new WebSocket(WS_URL);
  } catch (err) {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[PocraEnd ext] Connected');
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.command === 'close_tab') {
      if (typeof msg.tabId === 'number') {
        // Precise: close exactly the tab that was flagged.
        chrome.tabs.remove(msg.tabId, () => void chrome.runtime.lastError);
      } else if (msg.url) {
        // Fallback: exact URL match only — never a fuzzy prefix.
        chrome.tabs.query({}, (tabs) => {
          for (const t of tabs) {
            if (t.url === msg.url) {
              chrome.tabs.remove(t.id, () => void chrome.runtime.lastError);
            }
          }
        });
      }
    }
  };

  ws.onclose = () => {
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    if (ws) ws.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000);
}

function send(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

connect();

// Reconnect when service worker wakes up
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);

// Tab events
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
    send({ event: 'tab_switch', url: tab.url, title: tab.title, tabId: tab.id });
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (!(changeInfo.url || changeInfo.title)) return;
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
  send({ event: 'tab_update', url: tab.url, title: tab.title, tabId: tab.id });
});

// Re-report the active tab when the user switches back into the browser.
// onActivated/onUpdated don't fire if they return to an already-open tab.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return; // focus left the browser
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    const tab = tabs && tabs[0];
    if (chrome.runtime.lastError || !tab || !tab.url) return;
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
    send({ event: 'tab_switch', url: tab.url, title: tab.title, tabId: tab.id });
  });
});

// Use chrome.alarms instead of setInterval — alarms wake suspended MV3 service workers,
// whereas setInterval stops firing once Chrome suspends the SW.
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 }); // fires every ~24 seconds

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'keepalive') return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    send({ event: 'ping' });
  } else {
    connect();
  }
});
