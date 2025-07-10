import { app, BrowserWindow } from "electron";
import { logToFile } from ".";

let relaunchAttempts: number = 0;
const MAX_ATTEMPTS: number = 3;
const RELAUNCH_DELAY_MS: number = 3000;

function logRelaunchEvent(message: string): void {
    console.warn(`[safeRelaunch] ${message}`);
    logToFile("safe-relaunch", message);
}

function relaunchApp(reason: string): void {
    relaunchAttempts++;
    const message = `Attempt ${relaunchAttempts}: ${reason}`;
    logRelaunchEvent(message);

    if (relaunchAttempts > MAX_ATTEMPTS) {
        const failMsg = "Max relaunch attempts exceeded. App will exit.";
        console.error(`[safeRelaunch] ${failMsg}`);
        logToFile("safe-relaunch", failMsg);
        return;
    }

    setTimeout(() => {
        logToFile("safe-relaunch", "Calling app.relaunch() and app.exit(0)");
        app.relaunch();
        app.exit(0);
    }, RELAUNCH_DELAY_MS);
}

export function setupSafeRelaunch(mainWindow: BrowserWindow | null): void {
    if (!mainWindow) return;

    // Renderer crash
    mainWindow.webContents.on("render-process-gone", (_event, details) => {
        relaunchApp(`Renderer process gone: ${details.reason}`);
    });

    // Renderer unresponsive
    mainWindow.on("unresponsive", () => {
        relaunchApp("Window became unresponsive");
    });

    // WebContents crash
    mainWindow.webContents.on("crashed", () => {
        relaunchApp("WebContents crashed");
    });

    // GPU crash
    app.on("child-process-gone", (_event, details) => {
        const { type, reason, exitCode } = details;
        if (type === "GPU") {
            relaunchApp(`GPU process gone. Reason: ${reason}, Exit Code: ${exitCode}`);
        }
    });

    // Main process exceptions
    process.on("uncaughtException", (err) => {
        const msg = `Uncaught Exception: ${err.stack || err.message || err}`;
        console.error("[safeRelaunch]", err);
        logToFile("safe-relaunch", msg);
        relaunchApp("Uncaught exception in main process");
    });

    // Promise rejections
    process.on("unhandledRejection", (reason: any) => {
        const msg = `Unhandled Rejection: ${reason?.stack || reason}`;
        console.error("[safeRelaunch]", reason);
        logToFile("safe-relaunch", msg);
        relaunchApp("Unhandled promise rejection in main process");
    });
}
