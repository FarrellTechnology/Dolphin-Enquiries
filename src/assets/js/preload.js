const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Report data
  onReportData: (callback) => {
    ipcRenderer.on("report-data", (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("report-data");
  },

  // SMTP Settings
  getSMTPConfig: () => ipcRenderer.invoke("get-smtp-config"),
  saveSMTPConfig: (config) => ipcRenderer.invoke("save-smtp-config", config),

  // SFTP1 config
  getSFTP1Config: () => ipcRenderer.invoke("get-sftp1-config"),
  saveSFTP1Config: (config) => ipcRenderer.invoke("save-sftp1-config", config),

  // SFTP2 config
  getSFTP2Config: () => ipcRenderer.invoke("get-sftp2-config"),
  saveSFTP2Config: (config) => ipcRenderer.invoke("save-sftp2-config", config),

  // Azure config
  getSnowflakeConfig: () => ipcRenderer.invoke("get-snowflake-config"),
  saveSnowflakeConfig: (config) =>
    ipcRenderer.invoke("save-snowflake-config", config),

  // Theme
  onThemeChanged: (callback) => {
    ipcRenderer.on("theme-changed", (_, theme) => callback(theme));
    return () => ipcRenderer.removeAllListeners("theme-changed");
  },
});
