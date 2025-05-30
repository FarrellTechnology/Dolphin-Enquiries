import dotenv from "dotenv";
dotenv.config();

import { app, Menu, ipcMain } from "electron";
import { enableAutoLaunch, setupAutoUpdater, setupScheduler, checkDolphinFiles, } from "./features";
import { createMainWindow, setIsQuitting, setupTray } from "./window";
import { setupSettingsHandlers } from "./window/settings";

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

  setupScheduler(checkDolphinFiles);

  if (app.isPackaged) checkDolphinFiles();
});

app.on("window-all-closed", (e: { preventDefault: () => void; }) => {
  e.preventDefault();
});
