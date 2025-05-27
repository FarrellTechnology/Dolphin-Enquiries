import { Tray, Menu, nativeImage, nativeTheme } from "electron";
import { checkDolphinFiles, transferFiles } from "../../features";
import { assets } from "../../utils";
import { getMainWindow } from "..";
import { createSettingsWindow } from "../settings";

let tray: Tray;

export function setupTray(onQuit: () => void) {
  const iconPath = assets.image(nativeTheme.shouldUseDarkColors ? "company-icon.png" : "company-icon-dark.png");
  tray = new Tray(nativeImage.createFromPath(iconPath));

  const contextMenu = Menu.buildFromTemplate([
    { label: "Dolphin Enquiries", enabled: false },
    { label: "Check Dolphin Files Now", click: () => checkDolphinFiles().catch(console.error) },
    { label: "Run File Watcher Now", click: () => transferFiles().catch(console.error) },
    { type: "separator" },
    { label: "Settings", click: () => createSettingsWindow() },
    { type: "separator" },
    { label: "Quit", click: onQuit }
  ]);

  tray.setToolTip("Dolphin Enquiries");
  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    if (getMainWindow()?.isVisible()) {
      getMainWindow()?.focus();
    } else {
      getMainWindow()?.show();
    }
  });
}

export function updateTrayTooltip(message: string) {
  if (tray) tray.setToolTip(message);
}
