import { BrowserWindow, dialog, app, nativeImage, nativeTheme } from 'electron';
import { assets, settings, logToFile } from '../../utils';

let settingsWindow: BrowserWindow | null = null;

/**
 * Creates the settings window if it does not exist, or brings the existing one into focus.
 * 
 * This function also loads the SMTP, SFTP, Snowflake configurations and sends them to the window once it finishes loading.
 */
export async function createSettingsWindow(): Promise<void> {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  logToFile("window", "Creating settings window...");

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 750,
    show: false,
    resizable: false,
    icon: nativeImage.createFromPath(
      assets.image(nativeTheme.shouldUseDarkColors ? "company-icon.png" : "company-icon-dark.png")
    ),
    webPreferences: {
      contextIsolation: true,
      preload: assets.js('preload.js'),
    },
  });

  settingsWindow.loadFile(assets.template('settings.html'));
  logToFile("window", "Settings window loaded.");

  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show();
    logToFile("window", "Settings window is now visible.");
    if (!app.isPackaged) settingsWindow?.webContents.openDevTools({ mode: 'detach' });
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
    logToFile("window", "Settings window closed.");
  });

  try {
    const smtpConfig = await settings.getSMTPConfig();
    const sftp1Config = await settings.getSFTPConfigOne();
    const sftp2Config = await settings.getSFTPConfigTwo();
    const sftp3Config = await settings.getSFTPConfigThree();
    const snowflakeConfig = await settings.getSnowflakeConfig();

    settingsWindow.webContents.on('did-finish-load', () => {
      settingsWindow?.webContents.send('smtp-config', smtpConfig);
      settingsWindow?.webContents.send('sftp1-config', sftp1Config);
      settingsWindow?.webContents.send('sftp2-config', sftp2Config);
      settingsWindow?.webContents.send('sftp3-config', sftp3Config);
      settingsWindow?.webContents.send('snowflake-config', snowflakeConfig);
      settingsWindow?.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
      logToFile("window", "Sent configuration data to settings window.");
    });

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logToFile("window", `Error loading configurations: ${errorMsg}`);
  }

  nativeTheme.on('updated', () => {
    settingsWindow?.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    logToFile("window", `System theme updated to ${nativeTheme.shouldUseDarkColors ? 'dark' : 'light'}.`);
  });
}

/**
 * Sets up handlers for IPC calls to get and save various configurations.
 * 
 * @param {Electron.IpcMain} ipcMain - The Electron IPC main instance.
 */
export function setupSettingsHandlers(ipcMain: Electron.IpcMain): void {
  ipcMain.handle('get-smtp-config', async () => {
    return await settings.getSMTPConfig();
  });

  ipcMain.handle('save-smtp-config', async (_, config) => {
    try {
      await settings.setSMTPConfig(config);
      logToFile("settings", "SMTP config saved.");
      return { success: true };
    } catch (err) {
      const error = err as Error;
      logToFile("settings", `Failed to save SMTP config: ${error.message}`);
      dialog.showErrorBox('Error', 'Failed to save SMTP settings');
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-sftp1-config', async () => {
    return await settings.getSFTPConfigOne();
  });

  ipcMain.handle('save-sftp1-config', async (_, config) => {
    try {
      await settings.setSFTPConfigOne(config);
      logToFile("settings", "SFTP One config saved.");
      return { success: true };
    } catch (err) {
      const error = err as Error;
      logToFile("settings", `Failed to save SFTP One config: ${error.message}`);
      dialog.showErrorBox('Error', 'Failed to save SFTP One settings');
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-sftp2-config', async () => {
    return await settings.getSFTPConfigTwo();
  });

  ipcMain.handle('save-sftp2-config', async (_, config) => {
    try {
      await settings.setSFTPConfigTwo(config);
      logToFile("settings", "SFTP Two config saved.");
      return { success: true };
    } catch (err) {
      const error = err as Error;
      logToFile("settings", `Failed to save SFTP Two config: ${error.message}`);
      dialog.showErrorBox('Error', 'Failed to save SFTP Two settings');
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-sftp3-config', async () => {
    return await settings.getSFTPConfigThree();
  });

  ipcMain.handle('save-sftp3-config', async (_, config) => {
    try {
      await settings.setSFTPConfigThree(config);
      logToFile("settings", "SFTP Three config saved.");
      return { success: true };
    } catch (err) {
      const error = err as Error;
      logToFile("settings", `Failed to save SFTP Three config: ${error.message}`);
      dialog.showErrorBox('Error', 'Failed to save SFTP Three settings');
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-snowflake-config', async () => {
    return await settings.getSnowflakeConfig();
  });

  ipcMain.handle('save-snowflake-config', async (_, config) => {
    try {
      await settings.setSnowflakeConfig(config);
      logToFile("settings", "Snowflake config saved.");
      return { success: true };
    } catch (err) {
      const error = err as Error;
      logToFile("settings", `Failed to save Snowflake config: ${error.message}`);
      dialog.showErrorBox('Error', 'Failed to save Snowflake settings');
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-cronitor-config', async () => {
    return await settings.getCronitorConfig();
  });

  ipcMain.handle('save-cronitor-config', async (_, config) => {
    try {
      await settings.setCronitorConfig(config);
      logToFile("settings", "Cronitor config saved.");
      return { success: true };
    } catch (err) {
      const error = err as Error;
      logToFile("settings", `Failed to save Cronitor config: ${error.message}`);
      dialog.showErrorBox('Error', 'Failed to save Cronitor settings');
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-mssql-config', async () => {
    return await settings.getMsSQLConfig();
  });

  ipcMain.handle('save-mssql-config', async (_, config) => {
    try {
      await settings.setMsSQLConfig(config);
      logToFile("settings", "MSSQL config saved.");
      return { success: true };
    } catch (err) {
      const error = err as Error;
      logToFile("settings", `Failed to save MSSQL config: ${error.message}`);
      dialog.showErrorBox('Error', 'Failed to save MSSQL settings');
      return { success: false, error: error.message };
    }
  });
}
