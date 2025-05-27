import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Report data
  onReportData: (callback: (data: any) => void) => {
    ipcRenderer.on('report-data', (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('report-data');
  },

  // SMTP Settings
  getSMTPConfig: () => ipcRenderer.invoke('get-smtp-config'),
  saveSMTPConfig: (config: any) => ipcRenderer.invoke('save-smtp-config', config),
  
  // Theme
  onThemeChanged: (callback: (theme: string) => void) => {
    ipcRenderer.on('theme-changed', (_, theme) => callback(theme));
    return () => ipcRenderer.removeAllListeners('theme-changed');
  }
}); 