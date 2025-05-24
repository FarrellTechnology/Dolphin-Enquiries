import dotenv from "dotenv";
dotenv.config();

import { app, Menu } from "electron";
import { enableAutoLaunch, setupAutoUpdater, setupScheduler, checkFiles, } from "./features";
import { createMainWindow, setIsQuitting, setupTray } from "./window";

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
