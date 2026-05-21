const { app, BrowserWindow } = require('electron');
const path = require('path');
const { initDb } = require('./db');
const { registerIpcHandlers } = require('./ipc-handlers');
const { startWindowWatcher } = require('./window-watcher');

let mainWindow = null;

const isDev = process.env.NODE_ENV === 'development';

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    backgroundColor: '#0a0a0b',
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Push current extension status as soon as the renderer finishes loading.
  // This covers the race where extensions connected before the window existed
  // and broadcastStatus() had nobody to send to.
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const { getExtensionStatus } = require('./ws-server');
      mainWindow.webContents.send('extension:status', getExtensionStatus());
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getMainWindow() {
  return mainWindow;
}

app.whenReady().then(() => {
  // Init database first
  initDb();

  // Register IPC handlers (so the React UI can talk to main)
  registerIpcHandlers({ getMainWindow });

  // Start WebSocket server for the Chrome extension
  const wsServer = require('./ws-server');
  wsServer.setMainWindowGetter(getMainWindow);
  wsServer.startWsServer();

  // Start polling active window for desktop app detection
  startWindowWatcher();

  // Create the main window
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

module.exports = { getMainWindow };
