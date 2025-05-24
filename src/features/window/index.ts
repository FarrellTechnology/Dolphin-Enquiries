import { app, BrowserWindow, nativeImage, nativeTheme } from "electron";
import { resolveAppPath } from "../../utils";

export let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

export function getMainWindow() {
  return mainWindow;
}

export function setMainWindow(window: BrowserWindow | null) {
  mainWindow = window;
}

export function getIsQuitting() {
  return isQuitting;
}

export function setIsQuitting(value: boolean) {
  isQuitting = value;
}

export function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 350,
    show: false,
    icon: nativeImage.createFromPath(
      resolveAppPath("images", nativeTheme.shouldUseDarkColors ? "company-icon.png" : "company-icon-dark.png")
    ),
    webPreferences: {
      contextIsolation: true,
      preload: resolveAppPath("js", "preload.js"),
    },
  });

  mainWindow.loadFile(resolveAppPath("templates", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (!app.isPackaged) mainWindow?.webContents.openDevTools({ mode: "detach" });
  });

  mainWindow.on("close", (event) => {
    if (!getIsQuitting()) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.send("theme-changed", nativeTheme.shouldUseDarkColors ? "dark" : "light");
  });

  nativeTheme.on("updated", () => {
    mainWindow?.webContents.send("theme-changed", nativeTheme.shouldUseDarkColors ? "dark" : "light");
  });
}
