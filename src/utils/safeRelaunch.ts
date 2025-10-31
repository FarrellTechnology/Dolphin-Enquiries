import { app, BrowserWindow } from "electron";
import { logToFile } from ".";
import { sendEmail } from "../features";

const MAX_ATTEMPTS = 3;
const RELAUNCH_DELAY_MS = 3000;
const EMAIL_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
let relaunchAttempts = 0;
let skippedDueToKnownError = false;
let lastEmailSentAt = 0;

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

    if (level === "warn") {
        console.warn(logMessage);
    } else if (level === "error") {
        console.error(logMessage);
    } else {
        console.log(logMessage);
    }

    logToFile("safe-relaunch", logMessage);
}

/**
 * Determines whether the given error reason is a known recoverable error.
 * 
 * @param {string} reason - The reason for the error.
 * @returns {boolean} - Returns true if the error is recoverable, otherwise false.
 */
function isKnownRecoverableError(reason: any): boolean {
    const reasonStr =
        typeof reason === "string"
            ? reason
            : reason instanceof Error
                ? reason.message
                : JSON.stringify(reason);

    const recoverablePatterns = [
        "net::ERR_NAME_NOT_RESOLVED",
        "ECONNRESET",
        "ENOTFOUND",
        "ETIMEDOUT",
        "getConnection",
        "Timed out while waiting for handshake",
        "FTP",
        "EAI_AGAIN",
        "socket hang up",
        "connect ECONNREFUSED",
        "fetch failed",
    ];

    return recoverablePatterns.some((p) => reasonStr.includes(p));
}

/**
 * Attempts to relaunch the application if it encounters a failure or crash.
 * 
 * @param {string} reason - The reason for triggering the relaunch.
 */
async function relaunchApp(reason: string): Promise<void> {
    logEvent("info", `Handling failure due to: ${reason}`, { attempt: relaunchAttempts + 1 });

    if (isKnownRecoverableError(reason)) {
        logEvent("warn", "Recoverable error detected — app will idle and retry later.", { reason });
        skippedDueToKnownError = true;
        return;
    }

    relaunchAttempts++;

    if (relaunchAttempts > MAX_ATTEMPTS) {
        logEvent("error", "Max relaunch attempts exceeded. App will NOT restart.", { reason });
        return;
    }

    const now = Date.now();
    const sinceLastEmail = now - lastEmailSentAt;

    if (sinceLastEmail > EMAIL_COOLDOWN_MS) {
        try {
            await sendEmail(
                "it@efrtravel.com",
                "⚠️ Dolphin Tray Relaunch Triggered",
                `The Dolphin Enquiries Tray app attempted to relaunch.\nReason: ${reason}\nAttempt: ${relaunchAttempts}`,
                `
          <p><strong>Dolphin Tray has triggered a relaunch.</strong></p>
          <p><strong>Reason:</strong> ${reason}</p>
          <p><strong>Attempt:</strong> ${relaunchAttempts}</p>
          <p>This message was generated automatically. {{logo}}</p>
        `
            );
            lastEmailSentAt = now;
            logEvent("info", "Email sent successfully, cooldown started", { cooldownMs: EMAIL_COOLDOWN_MS });
        } catch (emailErr) {
            logEvent("error", "Failed to send relaunch email", { emailErr });
        }
    } else {
        const nextIn = Math.round((EMAIL_COOLDOWN_MS - sinceLastEmail) / 60000);
        logEvent("info", `Skipping email — cooldown active (${nextIn} min remaining).`);
    }

    setTimeout(() => {
        logEvent("info", "Restarting app via app.relaunch()", { delay: RELAUNCH_DELAY_MS });
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

        if (!isKnownRecoverableError(err)) {
            relaunchApp("Uncaught exception in main process");
        } else {
            logEvent("warn", "Recoverable uncaught exception — ignored", { err });
        }
    });

    process.on("unhandledRejection", (reason: any) => {
        const msg = `Unhandled Promise Rejection: ${typeof reason === "object" ? JSON.stringify(reason, null, 2) : reason}`;
        logEvent("error", msg, { reason });

        if (!isKnownRecoverableError(reason)) {
            relaunchApp(msg);
        } else {
            logEvent("warn", "Recoverable rejection — ignored", { reason });
        }
    });
}
