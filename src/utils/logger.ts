import fs from "fs";
import path from "path";
import { documentsFolder } from ".";

/**
 * Logs a message to a specified log file.
 * @param {string} subfolder - The subfolder in which the log will be stored.
 * @param {string} logLine - The log message.
 * @param {Object} options - Additional options for customizing log file behavior.
 * @param {boolean} [options.dateBasedName=true] - If true, the file name will be based on the date.
 * @param {string} [options.extension='.txt'] - The file extension for the log file.
 * @param {string} [options.filePrefix=''] - Prefix to add to the log file name.
 */
export function logToFile(
  subfolder: string,
  logLine: string,
  options?: {
    dateBasedName?: boolean;
    extension?: string;
    filePrefix?: string;
  }
): void {
  const {
    dateBasedName = true,
    extension = ".txt",
    filePrefix = "",
  } = options || {};

  const logDir = path.join(documentsFolder(), "DolphinEnquiries", "logs", subfolder);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const fileName = dateBasedName
    ? `${filePrefix}${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${extension}`
    : `${filePrefix}log${extension}`;

  const logFile = path.join(logDir, fileName);
  const timeStampedLine = `${new Date().toLocaleTimeString()} - ${logLine}\n`;

  fs.appendFile(logFile, timeStampedLine, (err) => {
    if (err) console.error(`Failed to write log to ${logFile}`, err);
  });
}
