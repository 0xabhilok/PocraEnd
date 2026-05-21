const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popupAPI', {
  onInit: (cb) => {
    ipcRenderer.on('popup:init', (_e, data) => cb(data));
  },
  action: (name) => ipcRenderer.invoke('popup:action', name)
});
