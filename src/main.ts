import { app, Menu, ipcMain } from "electron";
import { enableAutoLaunch, setupAutoUpdater, setupScheduler, checkDolphinFiles, watchAndTransferFiles } from "./features";
import { createMainWindow, getMainWindow, setIsQuitting, setupSettingsHandlers, setupTray } from "./window";
import { setupSafeRelaunch } from "./utils";

/**
 * This function is executed when the app is ready and sets up the various components for the application.
 * It enables auto-launch, sets up auto-updating, creates the main window, and sets up tray functionality.
 * Additionally, it schedules tasks for periodic actions such as checking dolphin files and transferring files.
 * 
 * @returns {Promise<void>} Resolves when the app is fully initialized and tasks are scheduled.
 */
app.whenReady().then(async () => {
  // Enable auto-launch for the app when the system starts
  await enableAutoLaunch();
  
  // Set up auto-updater for automatic app updates
  setupAutoUpdater();

  // Set up IPC handlers for managing application settings
  setupSettingsHandlers(ipcMain);

  // Remove the default application menu
  Menu.setApplicationMenu(null);

  // Create and show the main window
  createMainWindow();

  // Set up safe relaunch behavior if the app is packaged
  if (app.isPackaged) {
    setupSafeRelaunch(getMainWindow());
  }

  // Set up the system tray with quit functionality
  setupTray(() => {
    setIsQuitting(true);  // Mark the app as quitting
    app.quit();  // Quit the app
  });

  // Set up the scheduler to run tasks at specified intervals
  setupScheduler(
    { task: checkDolphinFiles, schedule: '0 1 * * *' },  // runs at 1:00 AM
    // { task: getAllDataIntoSnowflake, schedule: '0 2 * * *' },  // runs at 2:00 AM (commented out)
    { task: watchAndTransferFiles, schedule: '*/5 * * * * *' } // runs every 5 seconds
  );
});

/**
 * Prevents the default behavior of the "window-all-closed" event when the app's window is closed.
 * This ensures that the app does not quit when all windows are closed, typically useful in apps
 * that run in the background (e.g., tray apps).
 * 
 * @param {Object} e - The event object.
 * @param {Function} e.preventDefault - Prevents the app from quitting when windows are closed.
 */
app.on("window-all-closed", (e: { preventDefault: () => void; }) => {
  e.preventDefault();  // Prevent default quit behavior
});
