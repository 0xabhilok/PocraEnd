const { ipcMain } = require('electron');
const db = require('./db');

const sm = require('./session-manager');
const intervention = require('./intervention');

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

  // Custom motivations
  ipcMain.handle('motivations:list', () => db.getMotivations());
  ipcMain.handle('motivations:add', (_e, text) => {
    const id = db.addMotivation(text);
    return { id, text };
  });
  ipcMain.handle('motivations:delete', (_e, id) => db.deleteMotivation(id));
}

module.exports = { registerIpcHandlers };
