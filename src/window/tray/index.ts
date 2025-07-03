import { Tray, nativeTheme, nativeImage, Menu } from "electron";
import { checkDolphinFiles, checkForUpdates, getAllDataIntoSnowflake, getAllDataIntoSnowflakeTwo } from "../../features";
import { assets } from "../../utils";
import { getMainWindow } from "../main-window";
import { createSettingsWindow } from "../settings";

let tray: Tray;

export function setupTray(onQuit: () => void) {
  const iconPath = assets.image(nativeTheme.shouldUseDarkColors ? "company-icon.png" : "company-icon-dark.png");
  tray = new Tray(nativeImage.createFromPath(iconPath));

  const contextMenu = Menu.buildFromTemplate([
    { label: "Dolphin Enquiries", enabled: false },
    { label: "Check Dolphin Files Now", click: () => checkDolphinFiles().catch(console.error) },
    { label: "Upload MsSQL Files", click: () => getAllDataIntoSnowflake().catch(console.error) },
    { label: "Upload MsSQL Files (V2)", click: () => getAllDataIntoSnowflakeTwo().catch(console.error) },
    { type: "separator" },
    { label: "Settings", click: () => createSettingsWindow() },
    { label: "Check for Updates", click: () => checkForUpdates() },
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
