import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { app, BrowserWindow } from "electron";
import { resolveAppPath } from "../../utils";
import { sendEmail, updateTrayTooltip } from "..";

export async function checkFiles(mainWindow: BrowserWindow | null): Promise<void> {
  const documentsFolder = app.getPath("documents");
  const baseFolder = path.join(documentsFolder, "DolphinEnquiries", "completed");

  const yesterday = new Date(Date.now() - 86400000);
  const formattedDate = yesterday.toLocaleDateString("en-GB").replace(/\//g, "-");
  const yyyymmdd = yesterday.toISOString().slice(0, 10).replace(/-/g, "");
  const folderPath = path.join(baseFolder, yyyymmdd);

  if (!fsSync.existsSync(folderPath)) {
    console.log("Folder does not exist:", folderPath);
    return;
  }

  const files = fsSync.readdirSync(folderPath);
  const leisureCount = files.filter(f => f.toLowerCase().startsWith("lwc")).length;
  const golfCount = files.filter(f => f.toLowerCase().startsWith("egr")).length;

  const message = `[${formattedDate}] Leisure Enquiries: ${leisureCount}, Golf Enquiries: ${golfCount}`;
  updateTrayTooltip(message);

  if (mainWindow) {
    mainWindow.loadFile(resolveAppPath('templates', 'report.html'));
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('report-data', { formattedDate, leisureCount, golfCount });
    });
  }

  const html = await loadEmailTemplate(formattedDate, leisureCount, golfCount);
  await sendEmail("Dolphin Enquiries Daily Report", undefined, html);
}

async function loadEmailTemplate(date: string, leisure: number, golf: number): Promise<string> {
  const templatePath = resolveAppPath("templates", "email-template.html");
  let template = await fs.readFile(templatePath, "utf-8");
  return template.replace("{{formattedDate}}", date)
                 .replace("{{leisureCount}}", leisure.toString())
                 .replace("{{golfCount}}", golf.toString());
}
