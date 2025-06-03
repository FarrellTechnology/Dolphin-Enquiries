import path from "path";
import fs from "fs/promises";
import { app } from "electron";
import { format, parseISO } from "date-fns";

export * from "./settings";
export * from "./transfer-files";

function resolveAppPath(...segments: string[]): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", ...segments)
    : path.join(__dirname, "..", "..", "src", "assets", ...segments);
}

export function documentsFolder(): string {
  return app.getPath("documents");
}

export const assets = {
  template: (...segments: string[]) => resolveAppPath("templates", ...segments),
  image: (...segments: string[]) => resolveAppPath("images", ...segments),
  js: (...segments: string[]) => resolveAppPath("js", ...segments),
};

export async function loadEmailTemplate(
  perDateCounts: Array<{ date: string; leisureCount: number; golfCount: number }>,
  totalLeisure: number,
  totalGolf: number
): Promise<string> {
  const templatePath = assets.template("email-template.html");
  let template = await fs.readFile(templatePath, "utf-8");

  if (perDateCounts.length === 0) {
    return template
      .replace("{{summaryHeading}}", "No enquiries found.")
      .replace("{{tableRows}}", "")
      .replace("{{dateHeader}}", "Date")
      .replace("{{totalLeisure}}", "0")
      .replace("{{totalGolf}}", "0");
  }

  const hasMultipleMonths = new Set(
    perDateCounts.map((entry) => format(parseISO(entry.date), "yyyy-MM"))
  ).size > 1;

  let summaryHeading = "";
  let dateHeader = "";
  let tableRows = "";

  if (hasMultipleMonths) {
    // Monthly summary
    const grouped = new Map<string, { leisure: number; golf: number }>();

    for (const entry of perDateCounts) {
      const key = format(parseISO(entry.date), "MMMM yyyy");
      const prev = grouped.get(key) || { leisure: 0, golf: 0 };
      grouped.set(key, {
        leisure: prev.leisure + entry.leisureCount,
        golf: prev.golf + entry.golfCount,
      });
    }

    summaryHeading = `Monthly overview for ${grouped.size} enquiries`;
    dateHeader = "Month";

    tableRows = Array.from(grouped.entries()).map(([month, counts]) => `
      <tr>
        <td style="border: 1px solid #ccc; padding: 8px;">${month}</td>
        <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">${counts.leisure}</td>
        <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">${counts.golf}</td>
        <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">${counts.leisure + counts.golf}</td>
      </tr>
    `).join("");
  } else {
    // Daily breakdown
    summaryHeading = `Daily report for ${format(parseISO(perDateCounts[0].date), "MMMM yyyy")}`;
    dateHeader = "Date";

    tableRows = perDateCounts.map(day => `
      <tr>
        <td style="border: 1px solid #ccc; padding: 8px;">${format(parseISO(day.date), "dd MMM yyyy")}</td>
        <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">${day.leisureCount}</td>
        <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">${day.golfCount}</td>
        <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">${day.leisureCount + day.golfCount}</td>
      </tr>
    `).join("");
  }

  return template
    .replace("{{summaryHeading}}", summaryHeading)
    .replace("{{dateHeader}}", dateHeader)
    .replace("{{tableRows}}", tableRows)
    .replace("{{totalLeisure}}", totalLeisure.toString())
    .replace("{{totalGolf}}", totalGolf.toString());
}

export function isRegularFile(file: UnifiedFileInfo): boolean {
    if (typeof file.type === 'string') {
        return file.type === '-'; // SFTP
    }

    if (typeof file.type === 'number') {
        // basic-ftp: sometimes returns type 1 even for files, so fallback on extension
        const hasExtension = path.extname(file.name).length > 0;
        return file.type === 0 || hasExtension;
    }

    return false;
}

export function getSourceTypeFromFileName(fileName: string): string | null {
  if (!fileName) return null;
  const lower = fileName.toLowerCase();
  if (lower.startsWith('egr')) return 'EGR';
  if (lower.startsWith('lwc')) return 'LWC';
  return null;
}