const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPorts: () => ipcRenderer.invoke('get-ports'),
  refreshPorts: () => ipcRenderer.invoke('refresh-ports'),
  selectPort: (portId) => ipcRenderer.send('select-port', portId),
  cancel: () => ipcRenderer.send('cancel-port-selection'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  isElectron: true,
});
