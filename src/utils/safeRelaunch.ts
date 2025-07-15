import { app, BrowserWindow } from "electron";
import { logToFile } from ".";

const MAX_ATTEMPTS = 3;
const RELAUNCH_DELAY_MS = 3000;
let relaunchAttempts = 0;
let skippedDueToKnownError = false;

/**
 * Logs an event message with a specific level, and optionally includes extra information.
 * 
 * @param {("info" | "warn" | "error")} level - The log level (info, warn, error).
 * @param {string} message - The message to log.
 * @param {any} [extraInfo={}] - Additional information to log (optional).
 */
function logEvent(level: "info" | "warn" | "error", message: string, extraInfo: any = {}): void {
    let logMessage = `${level.toUpperCase()} - ${message}`;

    if (Object.keys(extraInfo).length) {
        logMessage += ` | Additional Info: ${JSON.stringify(extraInfo)}`;
    }

    // Log to console depending on level
    if (level === "warn") {
        console.warn(logMessage);
    } else if (level === "error") {
        console.error(logMessage);
    } else {
        console.log(logMessage);
    }

    // Log to file
    logToFile("safe-relaunch", logMessage);
}

/**
 * Determines whether the given error reason is a known recoverable error.
 * 
 * @param {string} reason - The reason for the error.
 * @returns {boolean} - Returns true if the error is recoverable, otherwise false.
 */
function isKnownRecoverableError(reason: string): boolean {
    return reason.includes("net::ERR_NAME_NOT_RESOLVED") || reason.includes("getConnection");
}

/**
 * Attempts to relaunch the application if it encounters a failure or crash.
 * 
 * @param {string} reason - The reason for triggering the relaunch.
 */
function relaunchApp(reason: string): void {
    logEvent("info", `Attempting to relaunch due to: ${reason}`, { attempt: relaunchAttempts + 1 });

    if (isKnownRecoverableError(reason)) {
        if (!skippedDueToKnownError) {
            const msg = `Skipped relaunch due to known recoverable error: ${reason}`;
            logEvent("warn", msg, { reason });
            skippedDueToKnownError = true;
        }
        return;
    }

    relaunchAttempts++;
    logEvent("warn", `Relaunch attempt ${relaunchAttempts} triggered by: ${reason}`);

    if (relaunchAttempts > MAX_ATTEMPTS) {
        logEvent("error", "Max relaunch attempts exceeded. App will NOT restart.", { reason });
        return;
    }

    setTimeout(() => {
        logEvent("info", "Calling app.relaunch() and app.exit(0)", { delay: RELAUNCH_DELAY_MS });
        app.relaunch();
        app.exit(0);
    }, RELAUNCH_DELAY_MS);
}

/**
 * Sets up monitoring for the main window to detect and respond to process failures.
 * 
 * @param {BrowserWindow | null} mainWindow - The main BrowserWindow instance.
 */
export function setupSafeRelaunch(mainWindow: BrowserWindow | null): void {
    if (!mainWindow) return;

    logEvent("info", "Setting up safe relaunch monitoring...");

    mainWindow.webContents.on("render-process-gone", (_event, details) => {
        const reason = `Renderer process gone: ${details.reason}`;
        logEvent("warn", `Renderer process gone. Reason: ${details.reason}`, { details });
        relaunchApp(reason);
    });

    mainWindow.on("unresponsive", () => {
        logEvent("warn", "Renderer window became unresponsive", { windowId: mainWindow.id });
        relaunchApp("Renderer window became unresponsive");
    });

    mainWindow.webContents.on("crashed", () => {
        logEvent("error", "WebContents crashed", { windowId: mainWindow.id });
        relaunchApp("WebContents crashed");
    });

    app.on("child-process-gone", (_event, details) => {
        if (details.type === "GPU") {
            const reason = `GPU process crash. Reason: ${details.reason}, Exit Code: ${details.exitCode}`;
            logEvent("error", `GPU process crash detected`, { details });
            relaunchApp(reason);
        }
    });

    process.on("uncaughtException", (err) => {
        const msg = `Uncaught Exception: ${err.stack || err.message || err}`;
        logEvent("error", msg, { error: err });
        relaunchApp("Uncaught exception in main process");
        process.exit(1);
    });

    process.on("unhandledRejection", (reason: any) => {
        const msg = `Unhandled Promise Rejection: ${reason?.stack || reason}`;
        logEvent("error", msg, { reason });
        relaunchApp("Unhandled promise rejection in main process");
        process.exit(1);
    });
}
