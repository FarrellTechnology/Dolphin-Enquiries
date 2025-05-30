import path from "path";
import fs from "fs/promises";
import { app } from "electron";

export * from "./settings";

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

  const rowsHtml = perDateCounts.map(day => `
    <tr>
      <td style="border: 1px solid #ccc; padding: 8px;">${day.date}</td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">${day.leisureCount}</td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">${day.golfCount}</td>
    </tr>
  `).join("");

  return template
    .replace("{{tableRows}}", rowsHtml)
    .replace("{{totalLeisure}}", totalLeisure.toString())
    .replace("{{totalGolf}}", totalGolf.toString());
}