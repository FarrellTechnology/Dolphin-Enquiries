
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { saveParsedTravelFolder, sendEmail } from "..";
import { getMainWindow, updateTrayTooltip } from "../../window";
import { assets, documentsFolder, loadEmailTemplate } from "../../utils";

async function parseFilesAndSendToDatabase(): Promise<Array<{ date: string, leisureCount: number, golfCount: number }>> {
  const baseFolder = path.join(documentsFolder(), "DolphinEnquiries", "completed");

  if (!fsSync.existsSync(baseFolder)) {
    console.warn("Base folder does not exist:", baseFolder);
    return [];
  }

  const folderNames = await fs.readdir(baseFolder);
  const results: Array<{ date: string, leisureCount: number, golfCount: number }> = [];

  for (const folderName of folderNames) {
    const folderPath = path.join(baseFolder, folderName);
    const stat = await fs.stat(folderPath);
    if (!stat.isDirectory() || !/^\d{8}$/.test(folderName)) continue; // skip non-date folders

    const files = await fs.readdir(folderPath);
    let leisureCount = 0;
    let golfCount = 0;

    for (const file of files) {
      if (!file.toLowerCase().endsWith(".xml")) continue;

      const fullPath = path.join(folderPath, file);
      let xmlContent: string;
      try {
        xmlContent = await fs.readFile(fullPath, "utf-8");
      } catch {
        console.warn(`Failed to read file ${file}, skipping.`);
        continue;
      }

      let saved = false;
      try {
        saved = await saveParsedTravelFolder(xmlContent);
      } catch (error) {
        console.error(`Failed to save parsed data for file ${file}:`, error);
      }

      if (saved) {
        if (file.toLowerCase().startsWith("lwc")) {
          leisureCount++;
        } else if (file.toLowerCase().startsWith("egr")) {
          golfCount++;
        }
      }
    }

    if (leisureCount + golfCount > 0) {
      const date = `${folderName.slice(0, 4)}-${folderName.slice(4, 6)}-${folderName.slice(6)}`;
      results.push({ date, leisureCount, golfCount });
    }
  }

  return results;
}

export async function checkDolphinFiles(): Promise<void> {
  let counts: Array<{ date: string; leisureCount: number; golfCount: number }> = [];
  try {
    counts = await parseFilesAndSendToDatabase();
  } catch (err) {
    console.error("Error saving daily counts:", err);
    counts = [];
  }

  updateTrayTooltip("Processed " + counts.length + " day(s)");

  getMainWindow()?.loadFile(assets.template('report.html'));
  getMainWindow()?.webContents.once('did-finish-load', () => {
    getMainWindow()?.webContents.send('report-data', { perDateCounts: counts });
  });

  const totalLeisure = counts.reduce((sum, d) => sum + d.leisureCount, 0);
  const totalGolf = counts.reduce((sum, d) => sum + d.golfCount, 0);
  const html = await loadEmailTemplate(counts, totalLeisure, totalGolf);

  await sendEmail("Dolphin Enquiries Report", undefined, html);
}
