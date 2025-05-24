import dotenv from "dotenv";
dotenv.config();

import { app, Menu } from "electron";
import { enableAutoLaunch, setupAutoUpdater, createMainWindow, setupTray, setupScheduler, checkFiles, setIsQuitting } from "./features";

app.whenReady().then(async () => {
  await enableAutoLaunch();
  setupAutoUpdater();
  Menu.setApplicationMenu(null);

  createMainWindow();
  setupTray(() => {
    setIsQuitting(true);
    app.quit();
  });

  setupScheduler(checkFiles);

  if (app.isPackaged) checkFiles();
});

app.on("window-all-closed", (e: { preventDefault: () => void; }) => {
  e.preventDefault();
});
