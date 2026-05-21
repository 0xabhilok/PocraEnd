const { BrowserWindow } = require('electron');
const path = require('path');

let popup = null;

function showInterventionPopup({ topic, distraction, message, snoozesLeft }) {
  if (popup && !popup.isDestroyed()) {
    // Already showing — just update content
    popup.webContents.send('popup:init', { topic, distraction, message, snoozesLeft });
    popup.show();
    popup.focus();
    return;
  }

  popup = new BrowserWindow({
    width: 480,
    height: 340,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    center: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/popup-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    popup.loadURL('http://localhost:5173/popup.html');
  } else {
    popup.loadFile(path.join(__dirname, '../../renderer/dist/popup.html'));
  }

  popup.webContents.once('did-finish-load', () => {
    popup.webContents.send('popup:init', { topic, distraction, message, snoozesLeft });
  });

  popup.on('closed', () => {
    popup = null;
  });
}

function closeInterventionPopup() {
  if (popup && !popup.isDestroyed()) {
    popup.close();
  }
  popup = null;
}

module.exports = { showInterventionPopup, closeInterventionPopup };
