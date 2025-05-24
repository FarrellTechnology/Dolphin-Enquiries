import dotenv from "dotenv";
dotenv.config();

import { app, Menu } from "electron";
import { enableAutoLaunch, setupAutoUpdater, createMainWindow, setupTray, setupScheduler, checkFiles, setIsQuitting } from "./features";

app.whenReady().then(async () => {
  await enableAutoLaunch();
  setupAutoUpdater();
  Menu.setApplicationMenu(null);

  const mainWindow = createMainWindow();
  setupTray(mainWindow, () => {
    setIsQuitting(true);
    app.quit();
  });

  setupScheduler(mainWindow, checkFiles);
  checkFiles(mainWindow);
});

app.on("window-all-closed", (e: { preventDefault: () => void; }) => {
  e.preventDefault(); // Prevent app from quitting
});
