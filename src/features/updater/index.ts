import { autoUpdater } from "electron-updater";
import { app, dialog } from "electron";

/**
 * Sets up the auto updater for the application.
 * It checks for updates, handles user interaction for downloading and installing updates,
 * and handles errors during the update process.
 */
export function setupAutoUpdater(): void {
  // Disable automatic download and set the app to install the update when it quits
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableWebInstaller = true;

  // Check for updates on app startup
  checkForUpdates();

  // Event listener for when an update is available
  autoUpdater.on("update-available", (info) => {
    dialog.showMessageBox({
      type: "info",
      title: "Update Available",
      message: `Version ${info.version} is available. Download now?`,
      buttons: ["Yes", "No"]
    }).then(result => {
      if (result.response === 0) autoUpdater.downloadUpdate();
    });
  });

  // Event listener for when an update has been downloaded
  autoUpdater.on("update-downloaded", () => {
    dialog.showMessageBox({
      type: "info",
      title: "Update Ready",
      message: "Update downloaded. Restart to apply?",
      buttons: ["Restart", "Later"]
    }).then(result => {
      if (result.response === 0) autoUpdater.quitAndInstall();
    });
  });

  // Event listener for errors during the update process
  autoUpdater.on("error", err => {
    dialog.showErrorBox("Update Error", err.message);
  });
}

/**
 * Checks for updates if the application is packaged.
 * If the app is not packaged, the update check is skipped.
 */
export function checkForUpdates() {
  if (!app.isPackaged) {
    return;
  }

  autoUpdater.checkForUpdates();
}
