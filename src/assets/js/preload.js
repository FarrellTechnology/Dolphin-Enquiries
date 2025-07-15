const { contextBridge, ipcRenderer } = require("electron");

/**
 * Exposes the Electron API to the renderer process through the `electronAPI` object.
 * This allows the renderer process to interact with Electron's main process securely
 * while adhering to Electron's sandboxing model.
 */
contextBridge.exposeInMainWorld("electronAPI", {
  
  // Report data
  /**
   * Listens for the "report-data" event from the main process.
   * @param {Function} callback - The callback function to handle the report data.
   * @returns {Function} - A function that removes the event listener when invoked.
   */
  onReportData: (callback) => {
    ipcRenderer.on("report-data", (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("report-data");
  },

  // SMTP Settings
  /**
   * Fetches the SMTP configuration from the main process.
   * @returns {Promise<SMTPConfig>} - A promise that resolves with the SMTP configuration.
   */
  getSMTPConfig: () => ipcRenderer.invoke("get-smtp-config"),

  /**
   * Saves the SMTP configuration to the main process.
   * @param {SMTPConfig} config - The SMTP configuration to be saved.
   * @returns {Promise<void>} - A promise that resolves when the configuration is saved.
   */
  saveSMTPConfig: (config) => ipcRenderer.invoke("save-smtp-config", config),

  // FTP1 config
  /**
   * Fetches the FTP1 configuration from the main process.
   * @returns {Promise<FTPConfig>} - A promise that resolves with the FTP1 configuration.
   */
  getSFTP1Config: () => ipcRenderer.invoke("get-sftp1-config"),

  /**
   * Saves the FTP1 configuration to the main process.
   * @param {FTPConfig} config - The FTP1 configuration to be saved.
   * @returns {Promise<void>} - A promise that resolves when the configuration is saved.
   */
  saveSFTP1Config: (config) => ipcRenderer.invoke("save-sftp1-config", config),

  // FTP2 config
  /**
   * Fetches the FTP2 configuration from the main process.
   * @returns {Promise<FTPConfig>} - A promise that resolves with the FTP2 configuration.
   */
  getSFTP2Config: () => ipcRenderer.invoke("get-sftp2-config"),

  /**
   * Saves the FTP2 configuration to the main process.
   * @param {FTPConfig} config - The FTP2 configuration to be saved.
   * @returns {Promise<void>} - A promise that resolves when the configuration is saved.
   */
  saveSFTP2Config: (config) => ipcRenderer.invoke("save-sftp2-config", config),

  // FTP3 config
  /**
   * Fetches the FTP3 configuration from the main process.
   * @returns {Promise<FTPConfig>} - A promise that resolves with the FTP3 configuration.
   */
  getSFTP3Config: () => ipcRenderer.invoke("get-sftp3-config"),

  /**
   * Saves the FTP3 configuration to the main process.
   * @param {FTPConfig} config - The FTP3 configuration to be saved.
   * @returns {Promise<void>} - A promise that resolves when the configuration is saved.
   */
  saveSFTP3Config: (config) => ipcRenderer.invoke("save-sftp3-config", config),

  // Snowflake config
  /**
   * Fetches the Snowflake configuration from the main process.
   * @returns {Promise<SnowflakeConfig>} - A promise that resolves with the Snowflake configuration.
   */
  getSnowflakeConfig: () => ipcRenderer.invoke("get-snowflake-config"),

  /**
   * Saves the Snowflake configuration to the main process.
   * @param {SnowflakeConfig} config - The Snowflake configuration to be saved.
   * @returns {Promise<void>} - A promise that resolves when the configuration is saved.
   */
  saveSnowflakeConfig: (config) =>
    ipcRenderer.invoke("save-snowflake-config", config),

  // Cronitor config
  /**
   * Fetches the Cronitor configuration from the main process.
   * @returns {Promise<CronitorConfig>} - A promise that resolves with the Cronitor configuration.
   */
  getCronitorConfig: () => ipcRenderer.invoke("get-cronitor-config"),

  /**
   * Saves the Cronitor configuration to the main process.
   * @param {CronitorConfig} config - The Cronitor configuration to be saved.
   * @returns {Promise<void>} - A promise that resolves when the configuration is saved.
   */
  saveCronitorConfig: (config) =>
    ipcRenderer.invoke("save-cronitor-config", config),

  // Ms SQL config
  /**
   * Fetches the Ms SQL configuration from the main process.
   * @returns {Promise<MsSQLConfig>} - A promise that resolves with the Ms SQL configuration.
   */
  getMsSQLConfig: () => ipcRenderer.invoke("get-mssql-config"),

  /**
   * Saves the Ms SQL configuration to the main process.
   * @param {MsSQLConfig} config - The Ms SQL configuration to be saved.
   * @returns {Promise<void>} - A promise that resolves when the configuration is saved.
   */
  saveMsSQLConfig: (config) =>
    ipcRenderer.invoke("save-mssql-config", config),

  // Theme
  /**
   * Listens for theme changes from the main process.
   * @param {Function} callback - The callback function to handle the theme change.
   * @returns {Function} - A function that removes the event listener when invoked.
   */
  onThemeChanged: (callback) => {
    ipcRenderer.on("theme-changed", (_, theme) => callback(theme));
    return () => ipcRenderer.removeAllListeners("theme-changed");
  },
});
