import { Tray, Menu, nativeImage, nativeTheme, BrowserWindow } from "electron";
import { resolveAppPath } from "../../utils";
import { checkFiles } from "..";

let tray: Tray;

export function setupTray(mainWindow: BrowserWindow | null, onQuit: () => void) {
  const iconPath = resolveAppPath("images", nativeTheme.shouldUseDarkColors ? "company-icon.png" : "company-icon-dark.png");
  tray = new Tray(nativeImage.createFromPath(iconPath));

  const contextMenu = Menu.buildFromTemplate([
    { label: "Dolphin Enquiries", enabled: false },
    { label: "Check Files Now", click: () => checkFiles(mainWindow).catch(console.error) },
    { label: "Quit", click: onQuit }
  ]);

  tray.setToolTip("Dolphin Enquiries");
  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    if (mainWindow?.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow?.show();
    }
  });
}

export function updateTrayTooltip(message: string) {
  if (tray) tray.setToolTip(message);
}
