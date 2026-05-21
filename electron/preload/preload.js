const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),

  // Sessions
  startSession: (config) => ipcRenderer.invoke('session:start', config),
  endSession: (opts = {}) => ipcRenderer.invoke('session:end', opts),
  getSessionState: () => ipcRenderer.invoke('session:state'),

  // Dashboard
  getDashboardData: () => ipcRenderer.invoke('data:dashboard'),

  // Extension status
  getExtensionStatus: () => ipcRenderer.invoke('extension:status'),

  // Custom motivations
  getMotivations: () => ipcRenderer.invoke('motivations:list'),
  addMotivation: (text) => ipcRenderer.invoke('motivations:add', text),
  deleteMotivation: (id) => ipcRenderer.invoke('motivations:delete', id),

  // Ollama setup
  getOllamaStatus: () => ipcRenderer.invoke('ollama:status'),
  installOllama: () => ipcRenderer.invoke('ollama:install'),
  onOllamaProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('ollama:progress', handler);
    return () => ipcRenderer.removeListener('ollama:progress', handler);
  },
  onExtensionStatusChange: (cb) => {
    const handler = (e, data) => cb(e, data);
    ipcRenderer.on('extension:status', handler);
    return () => ipcRenderer.removeListener('extension:status', handler);
  },

  // Events from main
  onDriftDetected: (cb) => {
    const handler = (e, data) => cb(e, data);
    ipcRenderer.on('drift:detected', handler);
    return () => ipcRenderer.removeListener('drift:detected', handler);
  },
  onGrindClicked: (cb) => {
    const handler = (e) => cb(e);
    ipcRenderer.on('grind:clicked', handler);
    return () => ipcRenderer.removeListener('grind:clicked', handler);
  }
});
