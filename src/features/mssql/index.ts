import sql from 'mssql';
import fs from 'fs-extra';
import path from 'path';
import { format } from '@fast-csv/format';
import { documentsFolder, initDbConnection, settings } from '../../utils';
import { Connection } from 'snowflake-sdk';

let connection: sql.ConnectionPool | null = null;
let config: any = null;

function logMigrationStatus(
    tableName: string,
    status: "SUCCESS" | "FAILED" | "SKIPPED",
    timeTaken: number,
    errorMessage?: string
): void {
    const logDir = path.join(documentsFolder(), "DolphinEnquiries", "logs", "mssql");
    const logFile = path.join(logDir, `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.txt`);

    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    let logEntry = `${new Date().toLocaleTimeString()} - ${tableName} - ${status} - ${timeTaken}ms`;

    if (errorMessage && status === "FAILED") {
        const sanitizedError = errorMessage.replace(/\s+/g, ' ').substring(0, 500);
        logEntry += ` - ERROR: ${sanitizedError}`;
    }

    logEntry += `\n`;

    fs.appendFile(logFile, logEntry, (err) => {
        if (err) {
            console.error(`Failed to write log: ${err}`);
        }
    });
}

async function connect() {
    if (connection) {
        return connection;
    }

    config = await settings.getMsSQLConfig();

    if (!config) throw new Error('MsSQL config is missing');
    connection = await sql.connect(config);

    return connection;
}

async function exportTableToCSV(tableName: string, outputPath: string) {
    const pool = await connect();
    const result = await pool.request().query(`SELECT * FROM ${tableName}`);
    await pool.close();

    await fs.ensureDir(outputPath);
    const ws = fs.createWriteStream(`${outputPath}/${tableName}.csv`);
    const csvStream = format({ headers: true });

    csvStream.pipe(ws);
    result.recordset.forEach(row => csvStream.write(row));
    csvStream.end();
}

async function getAllTables() {
    const pool = await connect();

    const query = `
    SELECT TABLE_SCHEMA, TABLE_NAME 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_TYPE = 'BASE TABLE'
  `;

    const result = await pool.request().query(query);
    await pool.close();

    return result.recordset;
}

async function uploadAndCopyCSV(tableName: string, filePath: string, conn: Connection): Promise<void> {
    const stage = '@~'; // User stage
    const fileName = path.basename(filePath);

    await new Promise<void>((resolve, reject) => {
        conn.execute({
            sqlText: `PUT file://${filePath} ${stage} OVERWRITE = TRUE`,
            complete: (err) => (err ? reject(err) : resolve()),
        });
    });

    await new Promise<void>((resolve, reject) => {
        conn.execute({
            sqlText: `COPY INTO ${tableName} FROM ${stage}/${fileName} FILE_FORMAT = (TYPE = 'CSV' FIELD_OPTIONALLY_ENCLOSED_BY='"' SKIP_HEADER=1)`,
            complete: (err) => (err ? reject(err) : resolve()),
        });
    });
}

async function batchRun<T>(
    items: T[],
    batchSize: number,
    fn: (item: T) => Promise<void>
) {
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        await Promise.all(batch.map(fn));
    }
}

export async function getAllDataIntoSnowflake() {
    const tables = await getAllTables();
    const conn = await initDbConnection();
    const outputPath = './tmp_csvs';

    await batchRun(tables, 10, async (table) => {
        const tableName = `${table.TABLE_SCHEMA}.${table.TABLE_NAME}`;
        const csvPath = `${outputPath}/${tableName}.csv`;

        const startTime = Date.now();

        try {
            await exportTableToCSV(tableName, outputPath);
            await uploadAndCopyCSV(tableName, csvPath, conn);
            const timeTaken = Date.now() - startTime;
            logMigrationStatus(tableName, "SUCCESS", timeTaken);
        } catch (error) {
            const timeTaken = Date.now() - startTime;
            logMigrationStatus(tableName, "FAILED", timeTaken, (error as Error).message);
        }
    });

    console.log('All tables migrated to Snowflake');
}
