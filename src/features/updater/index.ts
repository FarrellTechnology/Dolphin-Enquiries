import { autoUpdater } from "electron-updater";
import { app, dialog } from "electron";

export function setupAutoUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableWebInstaller = true;

  if (app.isPackaged) {
    autoUpdater.checkForUpdates();
  }

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

  autoUpdater.on("error", err => {
    dialog.showErrorBox("Update Error", err.message);
  });
}
