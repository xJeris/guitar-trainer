const { contextBridge, ipcRenderer } = require('electron');

// The Tuner/Metronome/Drill tabs use only standard browser APIs (Web Audio,
// getUserMedia) directly in the renderer — no privileged access needed there.
//
// The Tabs/Songs library needs to read/write a JSON file in Electron's
// userData directory and open a native file-picker dialog, both of which
// are main-process-only. We expose a small, explicit API surface here
// rather than granting full Node/IPC access to the renderer.
contextBridge.exposeInMainWorld('tabsApi', {
  list: () => ipcRenderer.invoke('tabs:list'),
  save: (tab) => ipcRenderer.invoke('tabs:save', tab),
  delete: (id) => ipcRenderer.invoke('tabs:delete', id),
  importFile: () => ipcRenderer.invoke('tabs:import-file')
});

contextBridge.exposeInMainWorld('appControl', {
  quit: () => ipcRenderer.send('app:quit')
});
