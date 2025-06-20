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

  // FTP1 config
  getSFTP1Config: () => ipcRenderer.invoke("get-sftp1-config"),
  saveSFTP1Config: (config) => ipcRenderer.invoke("save-sftp1-config", config),

  // FTP2 config
  getSFTP2Config: () => ipcRenderer.invoke("get-sftp2-config"),
  saveSFTP2Config: (config) => ipcRenderer.invoke("save-sftp2-config", config),

  // FTP3 config
  getSFTP3Config: () => ipcRenderer.invoke("get-sftp3-config"),
  saveSFTP3Config: (config) => ipcRenderer.invoke("save-sftp3-config", config),

  // Snowflake config
  getSnowflakeConfig: () => ipcRenderer.invoke("get-snowflake-config"),
  saveSnowflakeConfig: (config) =>
    ipcRenderer.invoke("save-snowflake-config", config),

  // Cronitor config
  getCronitorConfig: () => ipcRenderer.invoke("get-cronitor-config"),
  saveCronitorConfig: (config) =>
    ipcRenderer.invoke("save-cronitor-config", config),

  // Ms SQL config
  getMsSQLConfig: () => ipcRenderer.invoke("get-mssql-config"),
  saveMsSQLConfig: (config) =>
    ipcRenderer.invoke("save-mssql-config", config),

  // Theme
  onThemeChanged: (callback) => {
    ipcRenderer.on("theme-changed", (_, theme) => callback(theme));
    return () => ipcRenderer.removeAllListeners("theme-changed");
  },
});
