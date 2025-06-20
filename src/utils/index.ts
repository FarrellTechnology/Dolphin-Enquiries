import path from "path";
import fs from "fs/promises";
import { app } from "electron";
import { format, parseISO } from "date-fns";

export * from "./settings";
export * from "./transfer-files";
export * from "./snowflake";

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
      .replace("{{showTable}}", "");
  }

  const hasMultipleMonths = new Set(
    perDateCounts.map((entry) => format(parseISO(entry.date), "yyyy-MM"))
  ).size > 1;

  let summaryHeading = "";
  let dateHeader = "";
  let tableRows = "";

  if (hasMultipleMonths) {
    const grouped = new Map<string, { leisure: number; golf: number }>();

    for (const entry of perDateCounts) {
      const key = format(parseISO(entry.date), "MMMM yyyy");
      const prev = grouped.get(key) || { leisure: 0, golf: 0 };
      grouped.set(key, {
        leisure: prev.leisure + entry.leisureCount,
        golf: prev.golf + entry.golfCount,
      });
    }

    summaryHeading = `Monthly overview for ${grouped.size} month(s)`;
    dateHeader = "Month";

    tableRows = Array.from(grouped.entries()).map(([month, counts]) => `
      <tr>
        <td>${month}</td>
        <td style="text-align: right;">${counts.leisure}</td>
        <td style="text-align: right;">${counts.golf}</td>
        <td style="text-align: right;">${counts.leisure + counts.golf}</td>
      </tr>
    `).join("");
  } else {
    summaryHeading = `Daily report for ${format(parseISO(perDateCounts[0].date), "MMMM yyyy")}`;
    dateHeader = "Date";

    tableRows = perDateCounts.map(day => `
      <tr>
        <td>${format(parseISO(day.date), "dd MMM yyyy")}</td>
        <td style="text-align: right;">${day.leisureCount}</td>
        <td style="text-align: right;">${day.golfCount}</td>
        <td style="text-align: right;">${day.leisureCount + day.golfCount}</td>
      </tr>
    `).join("");
  }

  const tableAndTotals = `
    <table cellpadding="8" cellspacing="0" style="width: 100%; border-collapse: collapse; background: #ffffff; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.05); margin-top: 20px;">
      <thead style="background-color: #0077cc; color: white;">
        <tr>
          <th style="text-align: left; padding: 12px;">${dateHeader}</th>
          <th style="text-align: right; padding: 12px;">Leisure</th>
          <th style="text-align: right; padding: 12px;">Golf</th>
          <th style="text-align: right; padding: 12px;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>

    <div style="margin-top: 16px;">
      <p><strong>Total Leisure:</strong> ${totalLeisure}</p>
      <p><strong>Total Golf:</strong> ${totalGolf}</p>
    </div>
  `;

  return template
    .replace("{{summaryHeading}}", summaryHeading)
    .replace("{{showTable}}", tableAndTotals);
}

export function isRegularFile(file: UnifiedFileInfo): boolean {
  if (typeof file.type === 'string') {
    return file.type === '-';
  }

  if (typeof file.type === 'number') {
    const hasExtension = path.extname(file.name).length > 0;
    return file.type === 0 || hasExtension;
  }

  return false;
}

export function getSourceTypeFromFileName(fileName: string): string | null {
  if (!fileName) return null;

  const match = fileName.match(/egr|lwc/i);
  return match ? match[0].toUpperCase() : null;
}

export async function runWithConcurrencyLimit<T>(
  items: T[],
  limit: number,
  asyncFn: (item: T) => Promise<any>
) {
  const results: any[] = [];
  let i = 0;

  async function runner() {
    while (i < items.length) {
      const currentIndex = i++;
      results[currentIndex] = await asyncFn(items[currentIndex]);
    }
  }

  const runners = [];
  for (let j = 0; j < limit; j++) {
    runners.push(runner());
  }

  await Promise.all(runners);

  return results;
}

export function mapMSSQLTypeToSnowflakeType(type: string): string {
    const typeMap: Record<string, string> = {
        int: 'INTEGER',
        bigint: 'BIGINT',
        smallint: 'SMALLINT',
        tinyint: 'SMALLINT',
        bit: 'BOOLEAN',
        decimal: 'NUMBER',
        numeric: 'NUMBER',
        money: 'FLOAT',
        float: 'FLOAT',
        real: 'FLOAT',
        datetime: 'TIMESTAMP_NTZ',
        smalldatetime: 'TIMESTAMP_NTZ',
        date: 'DATE',
        time: 'TIME',
        char: 'CHAR',
        varchar: 'VARCHAR',
        nchar: 'CHAR',
        nvarchar: 'VARCHAR',
        text: 'TEXT',
        ntext: 'TEXT',
        binary: 'BINARY',
        varbinary: 'BINARY',
        uniqueidentifier: 'VARCHAR'
    };

    return typeMap[type.toLowerCase()] || 'VARCHAR';
}

export function fixTimestampFormat(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const key in obj) {
        const val = obj[key];

        if (val instanceof Date) {
            // Format as Snowflake-compatible timestamp
            result[key] = val.toISOString().replace('T', ' ').replace('Z', '');
        } else if (typeof val === 'string') {
            if (val.includes('GMT')) {
                const d = new Date(val);
                result[key] = isNaN(d.getTime())
                    ? val
                    : d.toISOString().replace('T', ' ').replace('Z', '');
            } else if (/^\d{4}-\d{2}-\d{2}T/.test(val)) {
                // ISO string, possibly from DB
                result[key] = val.replace('T', ' ').replace('Z', '');
            } else {
                result[key] = val;
            }
        } else {
            result[key] = val;
        }
    }
    return result;
}

