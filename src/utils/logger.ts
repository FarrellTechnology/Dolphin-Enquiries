import fs from "fs";
import path from "path";
import { documentsFolder } from ".";

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
