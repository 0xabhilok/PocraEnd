const { BrowserWindow, screen } = require('electron');
const path = require('path');

const AUTO_CLOSE_MS = 5000; // popup auto-dismisses after 5 seconds

let popup = null;
let autoCloseTimer = null;

function clearAutoCloseTimer() {
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }
}

function startAutoCloseTimer() {
  clearAutoCloseTimer();
  autoCloseTimer = setTimeout(() => {
    closeInterventionPopup();
  }, AUTO_CLOSE_MS);
}

function showInterventionPopup({ topic, distraction, message, snoozesLeft }) {
  // Reusing the existing popup window — push the new content and restart the timer.
  if (popup && !popup.isDestroyed()) {
    popup.webContents.send('popup:init', {
      topic,
      distraction,
      message,
      snoozesLeft,
      autoCloseMs: AUTO_CLOSE_MS
    });
    popup.showInactive();      // bring to front without stealing focus from work
    popup.moveTop();
    startAutoCloseTimer();
    return;
  }

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

  // Highest always-on-top level — sits above full-screen apps, screen savers,
  // and other popups on every platform. Without this, a maximised browser or
  // game can hide the warning entirely.
  popup.setAlwaysOnTop(true, 'screen-saver');
  popup.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Position at the top-center of the primary screen so it "sticks on top"
  // even when the user is on a full-screen app.
  const { workArea } = screen.getPrimaryDisplay();
  const winBounds = popup.getBounds();
  popup.setBounds({
    x: Math.round(workArea.x + (workArea.width - winBounds.width) / 2),
    y: workArea.y + 24, // 24px below the top edge of the work area
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
    popup.webContents.send('popup:init', {
      topic,
      distraction,
      message,
      snoozesLeft,
      autoCloseMs: AUTO_CLOSE_MS
    });
    // Start the 5-second auto-close clock once the user can actually see it.
    startAutoCloseTimer();
  });

  popup.on('closed', () => {
    clearAutoCloseTimer();
    popup = null;
  });
}

function closeInterventionPopup() {
  clearAutoCloseTimer();
  if (popup && !popup.isDestroyed()) {
    popup.close();
  }
  popup = null;
}

module.exports = { showInterventionPopup, closeInterventionPopup };
