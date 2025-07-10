import path from "path";
import fs from "fs-extra";
import { app } from "electron";
import { format, parseISO } from "date-fns";
import zlib from 'zlib';
import { promisify } from 'util';

export * from "./settings";
export * from "./transfer-files";
export * from "./snowflake";
export * from "./logger";
export * from "./safeRelaunch";

const gzip = promisify(zlib.gzip);

function resolveAppPath(...segments: string[]): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", ...segments)
    : path.join(__dirname, "..", "..", "src", "assets", ...segments);
}

export function documentsFolder(): string {
  return app.getPath("documents");
}

export const assets: { template: (...segments: string[]) => string, image: (...segments: string[]) => string, js: (...segments: string[]) => string } = {
  template: (...segments: string[]) => resolveAppPath("templates", ...segments),
  image: (...segments: string[]) => resolveAppPath("images", ...segments),
  js: (...segments: string[]) => resolveAppPath("js", ...segments),
};

export function determineReportMode(perDateCounts: Array<{ date: string }>): "monthly" | "weekly" | "daily" {
  const dateStrings = perDateCounts.map(r => r.date);

  const uniqueDates = [...new Set(dateStrings)].sort();
  if (uniqueDates.length === 0) return 'daily';

  const first = new Date(uniqueDates[0]);
  const last = new Date(uniqueDates[uniqueDates.length - 1]);

  const diffDays = Math.round((+last - +first) / (1000 * 60 * 60 * 24)) + 1;

  if (diffDays <= 1) return 'daily';
  if (diffDays <= 7) return 'weekly';
  return 'monthly';
}

export async function loadEmailTemplate(
  perDateCounts: Array<{ date: string; leisureCount: number; golfCount: number }>,
  totalLeisure: number,
  totalGolf: number,
  mode: 'monthly' | 'weekly' | 'daily' = 'daily'
): Promise<string> {
  const templatePath = assets.template("email-template.html");
  let template = await fs.readFile(templatePath, "utf-8");

  if (perDateCounts.length === 0) {
    return template
      .replace("{{summaryHeading}}", "No enquiries found.")
      .replace("{{showTable}}", "");
  }

  let summaryHeading = "";
  let dateHeader = "";
  let tableRows = "";

  if (mode === 'monthly') {
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
  } else if (mode === 'weekly') {
    summaryHeading = `Weekly report for ${format(parseISO(perDateCounts[0].date), "dd MMMM yyyy")} - ${format(parseISO(perDateCounts[perDateCounts.length - 1].date), "dd MMMM yyyy")}`;
    dateHeader = "Date";
    tableRows = perDateCounts.map(day => `
      <tr>
        <td>${format(parseISO(day.date), "EEE dd MMMM yyyy")}</td>
        <td style="text-align: right;">${day.leisureCount}</td>
        <td style="text-align: right;">${day.golfCount}</td>
        <td style="text-align: right;">${day.leisureCount + day.golfCount}</td>
      </tr>
    `).join("");
  } else {
    const months = new Set(perDateCounts.map(e => format(parseISO(e.date), "yyyy-MM")));
    if (months.size > 1) {
      return loadEmailTemplate(perDateCounts, totalLeisure, totalGolf, 'monthly');
    }

    summaryHeading = `Daily report for ${format(parseISO(perDateCounts[0].date), "dd MMMM yyyy")}`;
    dateHeader = "Date";
    tableRows = perDateCounts.map(day => `
      <tr>
        <td>${format(parseISO(day.date), "dd MMMM yyyy")}</td>
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
): Promise<any[]> {
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
    smallmoney: 'FLOAT',
    float: 'FLOAT',
    real: 'FLOAT',
    datetime: 'TIMESTAMP_NTZ',
    datetime2: 'TIMESTAMP_NTZ',
    datetimeoffset: 'TIMESTAMP_TZ',
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
    image: 'BINARY',
    xml: 'VARCHAR',
    sql_variant: 'VARCHAR',
    uniqueidentifier: 'VARCHAR(36)',
    hierarchyid: 'VARCHAR'
  };

  return typeMap[type.toLowerCase()] || 'VARCHAR';
}

export function fixTimestampFormat(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  const INVALID_PLACEHOLDER = '1970-01-01 00:00:00.000';


  for (const key in obj) {
    const val = obj[key];

    if (val == null || val === '') {
      result[key] = null;
      continue;
    }

    if (val instanceof Date) {
      if (isNaN(val.getTime())) {
        result[key] = null;
      } else {
        result[key] = val.toISOString().replace('T', ' ').replace('Z', '');
      }
      continue;
    }

    if (typeof val === 'string') {
      let d: Date | null = null;

      if (val === INVALID_PLACEHOLDER) {
        result[key] = null;
        continue;
      }

      if (val.includes('GMT')) {
        d = new Date(val);
      } else if (/^\d{4}-\d{2}-\d{2}T/.test(val)) {
        d = new Date(val);
      } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(val)) {
        d = new Date(val.replace(' ', 'T') + 'Z');
      }

      if (d && !isNaN(d.getTime())) {
        result[key] = d.toISOString().replace('T', ' ').replace('Z', '');
      } else {
        result[key] = val;
      }
      continue;
    }

    result[key] = val;
  }

  return result;
}

export function getWeekDateStrings(today: Date): string[] {
  const result: string[] = [];

  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));

  const lastSaturday = new Date(monday);
  lastSaturday.setDate(monday.getDate() - 2);
  const lastSunday = new Date(monday);
  lastSunday.setDate(monday.getDate() - 1);

  const formatDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

  result.push(formatDate(lastSaturday));
  result.push(formatDate(lastSunday));

  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    result.push(formatDate(d));
  }

  return result;
}

export function normalize(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

export async function processInBatches<T>(items: T[], batchSize: number, handler: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(handler));
  }
}

export async function compressCsvChunks(chunkDir: string): Promise<void> {
  const files = await fs.readdir(chunkDir);
  for (const file of files) {
    if (file.endsWith('.csv')) {
      const filePath = path.join(chunkDir, file);
      const fileContent = await fs.readFile(filePath);
      const compressed = await gzip(fileContent);
      await fs.writeFile(filePath + '.gz', compressed);
      await fs.remove(filePath);
    }
  }
}
