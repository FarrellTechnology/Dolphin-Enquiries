const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onReportData: (callback) => ipcRenderer.on('report-data', (event, data) => callback(data)),
  onThemeChanged: (callback) => ipcRenderer.on('theme-changed', (event, theme) => callback(theme))
});