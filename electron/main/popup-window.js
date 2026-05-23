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
//                                              │ show() → just update content
//                                              ▼ (no new window)

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const AUTO_CLOSE_MS = 5000;

let popup = null;
let popupState = 'NONE'; // NONE | CREATING | OPEN | CLOSING
let autoCloseTimer = null;
// Queued show payload if a request arrives while we're CREATING.
let pendingShowData = null;

function log(event, details = {}) {
  const ts = new Date().toISOString().slice(11, 23);
  const detailStr = Object.entries(details)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : v}`)
    .join(' ');
  console.log(`[popup] ${ts} state=${popupState} ${event}${detailStr ? ' ' + detailStr : ''}`);
}

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
    closeInterventionPopup();
  }, AUTO_CLOSE_MS);
}

function sendInitPayload(data) {
  if (!popup || popup.isDestroyed()) return;
  popup.webContents.send('popup:init', { ...data, autoCloseMs: AUTO_CLOSE_MS });
}

function showInterventionPopup(data) {
  log('show-requested', { distraction: data.distraction });

  if (popupState === 'CREATING') {
    // A window is being created right now. Queue this payload — it will be
    // applied as soon as did-finish-load fires.
    pendingShowData = data;
    log('queued-during-create');
    return;
  }

  if (popupState === 'OPEN' && popup && !popup.isDestroyed()) {
    sendInitPayload(data);
    popup.showInactive();
    popup.moveTop();
    startAutoCloseTimer();
    log('updated-existing-popup');
    return;
  }

  if (popupState === 'CLOSING') {
    // Defer until close completes.
    pendingShowData = data;
    log('queued-during-close');
    return;
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

  // Anchor top-center of the primary display work area.
  const { workArea } = screen.getPrimaryDisplay();
  const winBounds = popup.getBounds();
  popup.setBounds({
    x: Math.round(workArea.x + (workArea.width - winBounds.width) / 2),
    y: workArea.y + 24,
    width: winBounds.width,
    height: winBounds.height
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    popup.loadURL('http://localhost:5173/popup.html');
  } else {
    popup.loadFile(path.join(__dirname, '../../renderer/dist/popup.html'));
  }

  popup.webContents.once('did-finish-load', () => {
    if (!popup || popup.isDestroyed()) return;
    popupState = 'OPEN';
    log('popup-loaded');
    // Apply whichever payload is latest (handles queued updates).
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

    // If a show was queued during CLOSING, honor it now.
    if (wasPending) {
      log('replaying-queued-show');
      showInterventionPopup(wasPending);
    }
  });
}

function closeInterventionPopup() {
  log('close-requested');
  clearAutoCloseTimer();

  if (popupState === 'NONE') return;
  if (popupState === 'CLOSING') return;

  popupState = 'CLOSING';

  if (popup && !popup.isDestroyed()) {
    popup.close(); // triggers 'closed' which transitions back to NONE
  } else {
    popup = null;
    popupState = 'NONE';
  }
}

module.exports = { showInterventionPopup, closeInterventionPopup };
