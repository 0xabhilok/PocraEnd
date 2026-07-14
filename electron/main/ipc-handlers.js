const { ipcMain, shell, app } = require('electron');
const path = require('path');
const db = require('./db');

const sm = require('./session-manager');
const intervention = require('./intervention');
const ollamaSetup = require('./ollama-setup');

// In dev the folder lives at the project root. In a packaged build it must be
// unpacked from the asar (see build.asarUnpack in package.json) so Chrome's
// "Load unpacked" folder picker and Explorer can actually browse into it.
function getChromeExtensionFolder() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'chrome-extension')
    : path.join(__dirname, '../../chrome-extension');
}

function registerIpcHandlers({ getMainWindow }) {
  intervention.setMainWindowGetter(getMainWindow);

  // Settings
  ipcMain.handle('settings:get', () => {
    return db.getSettings();
  });

  ipcMain.handle('settings:update', (_e, patch) => {
    db.updateSettings(patch);
    return db.getSettings();
  });

  // Session lifecycle
  ipcMain.handle('session:start', (_e, { topic, workType, durationMin }) => {
    const sessionId = db.createSession({
      topic,
      workType,
      plannedDurationMin: durationMin
    });
    sm.startSession({ sessionId, topic, workType, durationMin });
    // Clear any stale dedup key from a previous session and ask the Chrome
    // extension to re-report the current tab so this session evaluates the
    // page the user is already sitting on (instead of waiting for them to
    // switch tabs to trigger an event).
    intervention.onSessionStarted();
    const wsServer = require('./ws-server');
    wsServer.broadcastToExtension({ command: 'report_current_tab' });
    return { sessionId, topic, workType, durationMin };
  });

  ipcMain.handle('session:end', (_e, { completed }) => {
    const state = sm.getState();
    if (!state.active) return null;

    const actualMin = Math.max(0, Math.round((Date.now() - state.startTime) / 60000));
    const sessionId = state.sessionId;

    db.endSession(sessionId, { actualDurationMin: actualMin, completed });
    intervention.onSessionStopped();
    sm.stopSession();

    return db.getSession(sessionId);
  });

  ipcMain.handle('session:state', () => {
    const s = sm.getState();
    return {
      active: s.active,
      topic: s.topic,
      workType: s.workType,
      startTime: s.startTime,
      plannedEndTime: s.plannedEndTime
    };
  });

  // Popup action
  ipcMain.handle('popup:action', (_e, action) => {
    // Mark user action FIRST so any racing auto-close timer doesn't
    // misclassify this click as "ignored" and schedule a re-check.
    const { markUserActionTaken } = require('./popup-window');
    markUserActionTaken();
    intervention.handlePopupAction(action);
  });

  // Dashboard
  ipcMain.handle('data:dashboard', () => {
    return db.getDashboardData();
  });

  // Extension status
  ipcMain.handle('extension:status', () => {
    const { getExtensionStatus } = require('./ws-server');
    return getExtensionStatus();
  });

  // Extension install guide
  ipcMain.handle('extension:folder-path', () => getChromeExtensionFolder());

  ipcMain.handle('extension:open-folder', async () => {
    const err = await shell.openPath(getChromeExtensionFolder());
    return { ok: !err, error: err || null };
  });

  ipcMain.handle('extension:open-extensions-page', async () => {
    await shell.openExternal('chrome://extensions/');
  });

  // Custom motivations
  ipcMain.handle('motivations:list', () => db.getMotivations());
  ipcMain.handle('motivations:add', (_e, text) => {
    const id = db.addMotivation(text);
    return { id, text };
  });
  ipcMain.handle('motivations:delete', (_e, id) => db.deleteMotivation(id));

  // Ollama / AI model
  ipcMain.handle('ollama:status', () => {
    const settings = db.getSettings();
    return ollamaSetup.getStatus(settings && settings.ai_model);
  });

  ipcMain.handle('ollama:models', () => ollamaSetup.listInstalledModels());

  ipcMain.handle('system:info', () => ollamaSetup.getDeviceInfo());

  ipcMain.handle('ollama:install', async (_e, model) => {
    const emit = (data) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('ollama:progress', data);
      }
    };
    try {
      const status = await ollamaSetup.runSetup(model, emit);
      return { ok: true, status };
    } catch (err) {
      emit({ phase: 'error', message: err.message });
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ollama:delete', async (_e, model) => {
    try {
      await ollamaSetup.deleteModel(model);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ollama:set-active', (_e, model) => {
    db.updateSettings({ ai_model: model });
    return db.getSettings();
  });
}

module.exports = { registerIpcHandlers };
