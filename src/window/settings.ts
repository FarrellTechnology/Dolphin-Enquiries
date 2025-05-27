import { BrowserWindow, dialog, app } from 'electron';
import { assets } from '../utils';
import { settings } from '../utils/settings';
import { nativeTheme } from 'electron';

let settingsWindow: BrowserWindow | null = null;

export async function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 500,
    height: 600,
    show: false,
    icon: assets.image(nativeTheme.shouldUseDarkColors ? "company-icon.png" : "company-icon-dark.png"),
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
  ipcMain.handle('save-smtp-config', async (_, config) => {
    try {
      settings.setSMTPConfig(config);
      return { success: true };
    } catch (err: unknown) {
      const error = err as Error;
      dialog.showErrorBox('Error', 'Failed to save SMTP settings');
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-smtp-config', async () => {
    return await settings.getSMTPConfig();
  });
} 