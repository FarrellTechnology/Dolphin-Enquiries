import { app, Menu, ipcMain } from "electron";
import { enableAutoLaunch, setupAutoUpdater, setupScheduler, checkDolphinFiles, watchAndTransferFiles, getAllDataIntoSnowflake } from "./features";
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
    { task: checkDolphinFiles, schedule: '0 1 * * *' },  // runs at 1:00 AM
    // { task: getAllDataIntoSnowflake, schedule: '0 2 * * *' },  // runs at 2:00 AM
    { task: watchAndTransferFiles, schedule: '*/5 * * * * *' } // runs every 5 seconds
  );
});

app.on("window-all-closed", (e: { preventDefault: () => void; }) => {
  e.preventDefault();
});
