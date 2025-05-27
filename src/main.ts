import dotenv from "dotenv";
dotenv.config();

import { app, Menu, ipcMain } from "electron";
import { enableAutoLaunch, setupAutoUpdater, setupScheduler, checkDolphinFiles, watchAndTransferFiles } from "./features";
import { createMainWindow, setIsQuitting, setupSettingsHandlers, setupTray } from "./window";

app.whenReady().then(async () => {
  await enableAutoLaunch();
  setupAutoUpdater();
  setupSettingsHandlers(ipcMain);
  Menu.setApplicationMenu(null);

  createMainWindow();
  setupTray(() => {
    setIsQuitting(true);
    app.quit();
  });

  setupScheduler(
    { task: checkDolphinFiles, schedule: '15 1 * * *' }  // runs at 1:15 AM
  );

  if (app.isPackaged) {
    checkDolphinFiles();
    watchAndTransferFiles();
  }
});

app.on("window-all-closed", (e: { preventDefault: () => void; }) => {
  e.preventDefault();
});
