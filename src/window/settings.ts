import { BrowserWindow, dialog, app, nativeImage, nativeTheme } from 'electron';
import { assets, settings } from '../utils';

let settingsWindow: BrowserWindow | null = null;

export async function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 500,
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

  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show();
    if (!app.isPackaged) settingsWindow?.webContents.openDevTools({ mode: 'detach' });
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  const config = await settings.getSMTPConfig();
  settingsWindow.webContents.on('did-finish-load', () => {
    settingsWindow?.webContents.send('smtp-config', config);
    settingsWindow?.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  });

  nativeTheme.on('updated', () => {
    settingsWindow?.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  });
}

export function setupSettingsHandlers(ipcMain: Electron.IpcMain) {
  ipcMain.handle('get-smtp-config', async () => {
    return await settings.getSMTPConfig();
  });

  ipcMain.handle('save-smtp-config', async (_, config) => {
    try {
      await settings.setSMTPConfig(config);
      return { success: true };
    } catch (err: unknown) {
      const error = err as Error;
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
      return { success: true };
    } catch (err: unknown) {
      const error = err as Error;
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
      return { success: true };
    } catch (err: unknown) {
      const error = err as Error;
      dialog.showErrorBox('Error', 'Failed to save SFTP Two settings');
      return { success: false, error: error.message };
    }
  });
}