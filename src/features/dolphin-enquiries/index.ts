
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { ping, saveParsedTravelFolder, sendEmail } from "..";
import { getMainWindow, updateTrayTooltip } from "../../window";
import { assets, documentsFolder, loadEmailTemplate, runWithConcurrencyLimit } from "../../utils";

async function parseFilesAndSendToDatabase(): Promise<Array<{ date: string, leisureCount: number, golfCount: number }>> {
  updateTrayTooltip("Parsing Dolphin Enquiries files...");

  ping('EFR-Electron-DolphinEnquiries', { state: 'run' });

  const baseFolder = path.join(documentsFolder(), "DolphinEnquiries", "completed");

  if (!fsSync.existsSync(baseFolder)) {
    console.error("Base folder does not exist:", baseFolder);
    return [];
  }

  const folderNames = await fs.readdir(baseFolder);
  const results: Array<{ date: string, leisureCount: number, golfCount: number }> = [];

  for (const folderName of folderNames) {
    const folderPath = path.join(baseFolder, folderName);
    const stat = await fs.stat(folderPath);
    if (!stat.isDirectory() || !/^\d{8}$/.test(folderName)) continue;

    const files = (await fs.readdir(folderPath)).filter(f => f.toLowerCase().endsWith(".xml"));
    let leisureCount = 0;
    let golfCount = 0;

    // Use custom concurrency limiter instead of p-limit
    const resultsPerFile = await runWithConcurrencyLimit(files, 4, async (file) => {
      try {
        const fullPath = path.join(folderPath, file);
        const xmlContent = await fs.readFile(fullPath, "utf-8");
        const saved = await saveParsedTravelFolder(xmlContent, file);
        return { file, saved };
      } catch (error) {
        console.error(`Failed to process file ${file}`, error);

        const message =
          error instanceof Error ? error.message : String(error);

        ping('EFR-Electron-DolphinEnquiries', { state: 'warn', message: `Failed to process file ${file}: ${message}` });

        return { file, saved: false };
      }
    });

    for (const { file, saved } of resultsPerFile) {
      if (saved) {
        if (file.toLowerCase().startsWith("lwc")) leisureCount++;
        else if (file.toLowerCase().startsWith("egr")) golfCount++;
      }
    }

    if (leisureCount + golfCount > 0) {
      const date = `${folderName.slice(0, 4)}-${folderName.slice(4, 6)}-${folderName.slice(6)}`;
      results.push({ date, leisureCount, golfCount });
    }
  }

  ping('EFR-Electron-DolphinEnquiries', { state: 'complete' });

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
