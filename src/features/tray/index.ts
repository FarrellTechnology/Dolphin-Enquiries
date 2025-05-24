import { Tray, Menu, nativeImage, nativeTheme } from "electron";
import { resolveAppPath } from "../../utils";
import { checkFiles, getMainWindow } from "..";

let tray: Tray;

export function setupTray(onQuit: () => void) {
  const iconPath = resolveAppPath("images", nativeTheme.shouldUseDarkColors ? "company-icon.png" : "company-icon-dark.png");
  tray = new Tray(nativeImage.createFromPath(iconPath));

  const contextMenu = Menu.buildFromTemplate([
    { label: "Dolphin Enquiries", enabled: false },
    { label: "Check Files Now", click: () => checkFiles().catch(console.error) },
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
