const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Report data
  onReportData: (callback) => {
    ipcRenderer.on('report-data', (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('report-data');
  },

  // SMTP Settings
  getSMTPConfig: () => ipcRenderer.invoke('get-smtp-config'),
  saveSMTPConfig: (config) => ipcRenderer.invoke('save-smtp-config', config),

  // Theme
  onThemeChanged: (callback) => {
    ipcRenderer.on('theme-changed', (_, theme) => callback(theme));
    return () => ipcRenderer.removeAllListeners('theme-changed');
  }
});
