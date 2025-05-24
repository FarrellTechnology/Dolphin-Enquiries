import { BrowserWindow } from "electron";
import schedule from "node-schedule";

export function setupScheduler(mainWindow: BrowserWindow | null, task: (mainWindow: BrowserWindow | null) => void) {
  schedule.scheduleJob("0 1 * * *", () => void task(mainWindow));
}
