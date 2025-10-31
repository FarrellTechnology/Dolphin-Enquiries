import { app, BrowserWindow, nativeImage, nativeTheme } from "electron";
import { assets, logToFile } from "../../utils";

let mainWindow: BrowserWindow | null = null;
let quitting: boolean = false;

/**
 * Gets the current main window.
 * 
 * @returns {BrowserWindow | null} - The current main window or null if not created.
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/**
 * Gets the quitting status of the app.
 * 
 * @returns {boolean} - True if the app is quitting, false otherwise.
 */
export function isQuitting(): boolean {
  return quitting;
}

/**
 * Sets the quitting status of the app.
 * 
 * @param {boolean} value - The value to set for the quitting status.
 */
export function setIsQuitting(value: boolean): void {
  quitting = value;
}

/**
 * Creates the main window for the application.
 * 
 * This function configures the main window, loads the HTML template, handles theme changes, 
 * and manages window events like minimizing and closing.
 */
export function createMainWindow(): void {
  logToFile("window", "Creating main window...");

  mainWindow = new BrowserWindow({
    width: 550,
    height: 500,
    show: false,
    resizable: true,
    icon: nativeImage.createFromPath(
      assets.image(nativeTheme.shouldUseDarkColors ? "company-icon-light.png" : "company-icon-dark.png")
    ),
    webPreferences: {
      contextIsolation: true,
      preload: assets.js("preload.js"),
    },
  });

  logToFile("window", "Main window created with configuration.");

  mainWindow.loadFile(assets.template("index.html"));
  logToFile("window", "Loaded index.html into main window.");

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    logToFile("window", "Main window is now visible.");
    if (!app.isPackaged) mainWindow?.webContents.openDevTools({ mode: "detach" });
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting()) {
      event.preventDefault();
      mainWindow?.hide();
      logToFile("window", "Window close attempted, hiding window instead.");
    }
  });

  mainWindow.webContents.on("did-finish-load", () => {
    const theme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    mainWindow?.webContents.send("theme-changed", theme);
    logToFile("window", `Theme changed to ${theme} after page load.`);
  });

  nativeTheme.on("updated", () => {
    const theme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    mainWindow?.webContents.send("theme-changed", theme);
    logToFile("window", `System theme updated to ${theme}.`);
  });
}
