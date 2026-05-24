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
    // Report whatever tab is currently active right now. Without this, a user
    // who started a PocraEnd session (or restarted the app) while sitting on a
    // tab they hadn't switched to recently would be invisible to the detector
    // until they happened to change tabs.
    reportCurrentActiveTab('connect');
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
    } else if (msg.command === 'report_current_tab') {
      // PocraEnd asked for the current tab — usually because a focus session
      // just started, snooze just ended, or an ignored popup needs re-check.
      // Force-send (bypass extension dedup) so PocraEnd always sees it.
      reportCurrentActiveTab('requested');
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

// --- URL filter ---
// Skip browser-internal pages across Chromium variants and local files.
// Earlier code only filtered chrome:// and chrome-extension:// — edge://,
// brave://, about:, and file:// would leak through and trigger classification.
function isInternalUrl(url) {
  return /^(chrome|chrome-extension|edge|brave|about|file):/i.test(url || '');
}

// --- Event coalescer ---
// Chrome fires onActivated + onUpdated + onFocusChanged in quick succession
// for a single user-perceived tab switch. Coalesce them so PocraEnd sees one
// event per real switch instead of three.
//
// Also dedupes by normalized URL key (host + pathname). For media/SPA hosts
// (YouTube, Netflix, Spotify, etc.) we include the title in the key so that
// autoplay / playlist navigation — which keeps the URL pathname identical
// while the actual content changes — still triggers re-classification.
const COALESCE_MS = 250;
let coalesceTimer = null;
let coalescePending = null;
let lastSentKey = null;

const MEDIA_HOST_RE = /(youtube\.com|netflix\.com|primevideo\.com|spotify\.com|hotstar\.com|disneyplus\.com)/i;

function normalizeKey(url, title) {
  try {
    const u = new URL(url);
    if (MEDIA_HOST_RE.test(u.hostname)) {
      return `${u.hostname}${u.pathname}::${(title || '').slice(0, 80).toLowerCase()}`;
    }
    return `${u.hostname}${u.pathname}`;
  } catch {
    return url;
  }
}

function queueSend(payload, debugSource) {
  if (!payload || !payload.url) return;
  if (isInternalUrl(payload.url)) return;

  coalescePending = { payload, debugSource };
  if (coalesceTimer) clearTimeout(coalesceTimer);
  coalesceTimer = setTimeout(flushCoalesced, COALESCE_MS);
}

function flushCoalesced() {
  coalesceTimer = null;
  if (!coalescePending) return;
  const { payload, debugSource } = coalescePending;
  coalescePending = null;

  const key = normalizeKey(payload.url, payload.title);
  if (key === lastSentKey) {
    // Same logical page — don't re-send. PocraEnd's own dedup would catch
    // it but suppressing at the source keeps logs clean.
    return;
  }
  lastSentKey = key;
  console.log(`[PocraEnd ext] → tab event (${debugSource}):`, payload.url);
  send(payload);
}

function forceFlushAndSend(payload, debugSource) {
  // Used for keepalive / connect / explicit requests — same coalescing but
  // bypasses the "same key" suppression so PocraEnd always re-sees the
  // current tab on session start / snooze end / ignore re-check.
  if (coalesceTimer) clearTimeout(coalesceTimer);
  coalesceTimer = null;
  coalescePending = null;
  if (!payload || !payload.url) return;
  if (isInternalUrl(payload.url)) return;
  lastSentKey = normalizeKey(payload.url, payload.title);
  console.log(`[PocraEnd ext] → tab event (${debugSource}, forced):`, payload.url);
  send(payload);
}

// Query the currently-focused tab across all windows and report it as a
// tab_switch so PocraEnd can classify it. Used on connect and on the
// periodic heartbeat to recover from "user just sat there" gaps.
function reportCurrentActiveTab(source) {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (chrome.runtime.lastError || !tab || !tab.url) return;
    if (isInternalUrl(tab.url)) return;
    // Connect / explicit-request events bypass dedup so PocraEnd can pick
    // up the user's current page even if it hasn't changed.
    const force = source === 'connect' || source === 'requested';
    const payload = { event: 'tab_switch', url: tab.url, title: tab.title, tabId: tab.id };
    if (force) {
      forceFlushAndSend(payload, source);
    } else {
      queueSend(payload, source);
    }
  });
}

connect();

// Reconnect when service worker wakes up
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);

// Tab events — all routed through queueSend() which coalesces bursts of
// onActivated + onUpdated + onFocusChanged that fire for one user switch.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    queueSend({ event: 'tab_switch', url: tab.url, title: tab.title, tabId: tab.id }, 'onActivated');
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (!(changeInfo.url || changeInfo.title)) return;
  queueSend({ event: 'tab_update', url: tab.url, title: tab.title, tabId: tab.id }, 'onUpdated');
});

// Re-report the active tab when the user switches back into the browser.
// onActivated/onUpdated don't fire if they return to an already-open tab.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return; // focus left the browser
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    const tab = tabs && tabs[0];
    if (chrome.runtime.lastError || !tab) return;
    queueSend({ event: 'tab_switch', url: tab.url, title: tab.title, tabId: tab.id }, 'onFocusChanged');
  });
});

// Use chrome.alarms instead of setInterval — alarms wake suspended MV3 service workers,
// whereas setInterval stops firing once Chrome suspends the SW.
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 }); // fires every ~24 seconds

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'keepalive') return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    send({ event: 'ping' });
    // Also re-report the current tab on each tick. This recovers detection
    // when the user has been sitting on the same tab the whole time and no
    // onActivated / onUpdated / onFocusChanged event has fired since the
    // last classification. PocraEnd's own dedup (lastClassifiedKey) prevents
    // duplicate popups when nothing has actually changed.
    reportCurrentActiveTab('keepalive');
  } else {
    connect();
  }
});
