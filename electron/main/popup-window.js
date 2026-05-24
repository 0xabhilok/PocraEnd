// Popup lifecycle is a state machine. Two simultaneous show() calls cannot
// create two windows.
//
//                ┌─────────┐  show()       ┌──────────┐
//                │  NONE   │ ────────────▶ │ CREATING │
//                └────┬────┘               └────┬─────┘
//                     ▲                         │ did-finish-load
//                     │                         ▼
//                     │ close()           ┌──────────┐
//                     └────────────────── │   OPEN   │
//                                         └──────────┘
//                                              │ show() → update content in place
//                                              ▼ (no new window)
//
// Changes vs the original:
//  - closeInterventionPopup() clears pendingShowData before closing so a
//    close-during-CREATING does not replay a stale popup on 'closed'.
//  - userActionTaken + markUserActionTaken() distinguish user-driven close
//    from the auto-close timeout. The auto-close path calls onIgnoredCallback,
//    user-driven closes do not.

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const AUTO_CLOSE_MS = 5000;

let popup = null;
let popupState = 'NONE'; // NONE | CREATING | OPEN | CLOSING
let autoCloseTimer = null;
let pendingShowData = null;

// True when the IPC popup:action handler has run for the current popup
// instance — gates onIgnoredCallback so a click doesn't also count as ignore.
let userActionTaken = false;

// Set by intervention.js. Fired only when a popup auto-closes (timeout)
// without any user action.
let onIgnoredCallback = null;

function log(event, details = {}) {
  const ts = new Date().toISOString().slice(11, 23);
  const detailStr = Object.entries(details)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : v}`)
    .join(' ');
  console.log(`[popup] ${ts} state=${popupState} ${event}${detailStr ? ' ' + detailStr : ''}`);
}

function setOnIgnoredCallback(cb) { onIgnoredCallback = cb; }

// Called from ipc-handlers before handlePopupAction runs — guarantees that
// even if the auto-close timer fires in the same tick, we don't classify the
// click as "ignored".
function markUserActionTaken() { userActionTaken = true; }

function clearAutoCloseTimer() {
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }
}

function startAutoCloseTimer() {
  clearAutoCloseTimer();
  autoCloseTimer = setTimeout(() => {
    log('auto-close-fired');
    const wasUserAction = userActionTaken;
    closeInterventionPopup();
    if (!wasUserAction && typeof onIgnoredCallback === 'function') {
      try { onIgnoredCallback(); } catch { /* swallow */ }
    }
  }, AUTO_CLOSE_MS);
}

function sendInitPayload(data) {
  if (!popup || popup.isDestroyed()) return;
  popup.webContents.send('popup:init', { ...data, autoCloseMs: AUTO_CLOSE_MS });
}

function showInterventionPopup(data) {
  log('show-requested', { distraction: data.distraction });
  userActionTaken = false; // fresh show — until proven otherwise

  if (popupState === 'CREATING') {
    pendingShowData = data;
    return log('queued-during-create');
  }

  if (popupState === 'OPEN' && popup && !popup.isDestroyed()) {
    sendInitPayload(data);
    popup.showInactive();
    popup.moveTop();
    startAutoCloseTimer();
    return log('updated-existing-popup');
  }

  if (popupState === 'CLOSING') {
    pendingShowData = data;
    return log('queued-during-close');
  }

  // popupState === 'NONE' → create a new window.
  popupState = 'CREATING';
  pendingShowData = data;

  popup = new BrowserWindow({
    width: 480,
    height: 420,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    center: true,
    resizable: false,
    skipTaskbar: true,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/popup-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  popup.setAlwaysOnTop(true, 'screen-saver');
  popup.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const { workArea } = screen.getPrimaryDisplay();
  const winBounds = popup.getBounds();
  popup.setBounds({
    x: Math.round(workArea.x + (workArea.width - winBounds.width) / 2),
    y: workArea.y + 24,
    width: winBounds.width,
    height: winBounds.height
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) popup.loadURL('http://localhost:5173/popup.html');
  else popup.loadFile(path.join(__dirname, '../../renderer/dist/popup.html'));

  popup.webContents.once('did-finish-load', () => {
    if (!popup || popup.isDestroyed()) return;
    popupState = 'OPEN';
    log('popup-loaded');
    if (pendingShowData) {
      sendInitPayload(pendingShowData);
      pendingShowData = null;
    }
    startAutoCloseTimer();
  });

  popup.on('closed', () => {
    log('popup-closed');
    clearAutoCloseTimer();
    popup = null;
    const wasPending = pendingShowData;
    pendingShowData = null;
    popupState = 'NONE';

    // Only replay if a fresh show was explicitly queued (caller intent).
    // Stale pendingShowData from before a context-driven close was already
    // cleared by closeInterventionPopup, so we won't replay zombie popups.
    if (wasPending) {
      log('replaying-queued-show');
      showInterventionPopup(wasPending);
    }
  });
}

function closeInterventionPopup() {
  log('close-requested');
  clearAutoCloseTimer();

  // FIX H3: drop any pendingShowData that belongs to a popup the caller has
  // already decided to abandon. Without this, 'closed' would resurrect the
  // popup with stale data after a context-change-driven close.
  pendingShowData = null;

  if (popupState === 'NONE') return;
  if (popupState === 'CLOSING') return;

  popupState = 'CLOSING';

  if (popup && !popup.isDestroyed()) {
    popup.close();
  } else {
    popup = null;
    popupState = 'NONE';
  }
}

module.exports = {
  showInterventionPopup,
  closeInterventionPopup,
  setOnIgnoredCallback,
  markUserActionTaken
};
