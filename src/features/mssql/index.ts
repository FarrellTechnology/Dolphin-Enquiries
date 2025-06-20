import sql from 'mssql';
import fs from 'fs-extra';
import path from 'path';
import { format } from '@fast-csv/format';
import { documentsFolder, fixTimestampFormat, initDbConnection, mapMSSQLTypeToSnowflakeType, runWithConcurrencyLimit, settings } from '../../utils';
import { Connection } from 'snowflake-sdk';
import * as csvSplitStream from 'csv-split-stream';
import readline from 'readline';

let connection: sql.ConnectionPool | null = null;
let config: any = null;
let isRunning = false;

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
    if (connection && connection.connected) {
        return connection;
    }

    config = await settings.getMsSQLConfig();
    if (!config) throw new Error('MsSQL config is missing');

    connection = await sql.connect(config);
    return connection;
}

async function exportTableToCSV(schema: string, tableName: string, outputPath: string) {
    const pool = await connect();
    const fullTableName = `[${schema}].[${tableName}]`;
    const outputFile = `${outputPath}/${tableName}.csv`;

    await fs.ensureDir(outputPath);
    const ws = fs.createWriteStream(outputFile);
    const csvStream = format({ headers: true });
    csvStream.pipe(ws);

    const request = pool.request();
    request.stream = true;

    return new Promise<void>((resolve, reject) => {
        request.query(`SELECT * FROM ${fullTableName}`);

        request.on('row', (row) => {
            const ok = csvStream.write(fixTimestampFormat(row));
            if (!ok) {
                request.pause();
                csvStream.once('drain', () => request.resume());
            }
        });

        request.on('error', (err) => {
            csvStream.end();
            ws.close();
            reject(err);
        });

        request.on('done', () => {
            csvStream.end();
            resolve();
        });
    });
}

async function getAllTables() {
    const pool = await connect();

    const query = `
    SELECT TABLE_SCHEMA, TABLE_NAME 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_TYPE = 'BASE TABLE'
  `;

    const result = await pool.request().query(query);
    return result.recordset;
}

async function getLineCount(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        let lineCount = 0;
        const stream = fs.createReadStream(filePath);
        const rl = readline.createInterface({ input: stream });

        rl.on('line', () => lineCount++);
        rl.on('close', () => resolve(lineCount));
        rl.on('error', reject);
    });
}

async function uploadAndCopyCSV(tableName: string, filePath: string, conn: Connection): Promise<void> {
    const stage = '@~';
    const CHUNK_SIZE_MB = 250;

    const stats = await fs.stat(filePath);
    const totalSizeMB = stats.size / (1024 * 1024);

    if (totalSizeMB <= CHUNK_SIZE_MB) {
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

        return;
    }

    console.log(`Splitting large CSV (${totalSizeMB.toFixed(1)}MB)...`);

    const totalLines = await getLineCount(filePath);
    if (totalLines <= 1) {
        throw new Error('CSV file has insufficient lines to split.');
    }

    const avgBytesPerLine = stats.size / totalLines;
    const linesPerChunk = Math.floor((CHUNK_SIZE_MB * 1024 * 1024) / avgBytesPerLine);

    console.log(`Total lines: ${totalLines}, splitting into chunks of approx ${linesPerChunk} lines (~${CHUNK_SIZE_MB}MB each)`);

    const splitDir = path.join(path.dirname(filePath), `${path.basename(filePath, '.csv')}_parts`);
    await fs.ensureDir(splitDir);

    try {
        await csvSplitStream.split(
            fs.createReadStream(filePath),
            {
                lineLimit: linesPerChunk,
                keepHeaders: true
            },
            (index: number) => fs.createWriteStream(path.join(splitDir, `part_${index}.csv`))
        );

        const chunkFiles = (await fs.readdir(splitDir)).filter(f => f.endsWith('.csv'));

        for (const chunkFile of chunkFiles) {
            const chunkPath = path.join(splitDir, chunkFile);
            const stageFile = `${stage}/${chunkFile}`;

            await new Promise<void>((resolve, reject) => {
                conn.execute({
                    sqlText: `PUT file://${chunkPath} ${stage} OVERWRITE = TRUE`,
                    complete: (err) => (err ? reject(err) : resolve()),
                });
            });

            await new Promise<void>((resolve, reject) => {
                conn.execute({
                    sqlText: `COPY INTO ${tableName} FROM '${stageFile}' FILE_FORMAT = (TYPE = 'CSV' FIELD_OPTIONALLY_ENCLOSED_BY='"' SKIP_HEADER=1)`,
                    complete: (err) => (err ? reject(err) : resolve()),
                });
            });

            await fs.remove(chunkPath);
        }
    } catch (err) {
        console.error(`Error during split-upload-copy: ${err}`);
        throw err;
    } finally {
        try {
            await fs.remove(splitDir);
        } catch (cleanupErr) {
            console.warn(`Failed to remove temp split directory '${splitDir}':`, cleanupErr);
        }
    }
}

async function doesTableExistInSnowflake(conn: Connection, tableName: string): Promise<boolean> {
    const schema = 'PUBLIC';
    const name = tableName;
    const query = `
        SELECT COUNT(*) AS count
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = UPPER('${schema}')
        AND TABLE_NAME = UPPER('${name}')
    `;

    return await new Promise<boolean>((resolve, reject) => {
        conn.execute({
            sqlText: query,
            complete: (err, stmt, rows) => {
                if (err) return reject(err);
                const exists = rows?.[0] && Object.values(rows[0])[0] === 1;
                resolve(exists);
            }
        });
    });
}

async function generateCreateTableSQL(tableSchema: string, tableName: string): Promise<string> {
    const pool = await connect();

    const result = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = '${tableSchema}' AND TABLE_NAME = '${tableName}'
        ORDER BY ORDINAL_POSITION
    `);

    const columns = result.recordset.map(col => {
        const snowflakeType = mapMSSQLTypeToSnowflakeType(col.DATA_TYPE);
        const maxLen = col.CHARACTER_MAXIMUM_LENGTH;

        const isMaxLength = maxLen === -1 || maxLen === 2147483647;

        const typeWithLength = ['VARCHAR', 'CHAR'].includes(snowflakeType)
            ? (isMaxLength ? `${snowflakeType}(16777216)` : `${snowflakeType}(${maxLen})`)
            : snowflakeType;

        return `"${col.COLUMN_NAME}" ${typeWithLength}`;
    });

    return `CREATE TABLE PUBLIC.${tableName} (\n  ${columns.join(',\n  ')}\n);`;
}


export async function getAllDataIntoSnowflake() {
    if (isRunning) {
        console.log('Migration is already running. Skipping this invocation.');
        return;
    }
    isRunning = true;

    let successCount = 0;
    let failedCount = 0;

    try {
        const tables = await getAllTables();
        console.log(`Total tables found: ${tables.length}`);
        const conn = await initDbConnection(true);
        const outputPath = './tmp_csvs';

        await runWithConcurrencyLimit(tables, 10, async (table) => {
            const mssqlSchema = table.TABLE_SCHEMA;
            const mssqlTableName = table.TABLE_NAME;
            const snowflakeTableName = mssqlTableName;

            const csvPath = `${outputPath}/${snowflakeTableName}.csv`;
            const startTime = Date.now();

            try {
                const tableExists = await doesTableExistInSnowflake(conn, snowflakeTableName);

                if (!tableExists) {
                    const createSQL = await generateCreateTableSQL(table.TABLE_SCHEMA, table.TABLE_NAME);
                    await new Promise<void>((resolve, reject) => {
                        conn.execute({
                            sqlText: createSQL,
                            complete: (err) => (err ? reject(err) : resolve()),
                        });
                    });
                    console.log(`Created missing table: PUBLIC.${snowflakeTableName}`);
                }

                await exportTableToCSV(mssqlSchema, mssqlTableName, outputPath);
                await uploadAndCopyCSV(snowflakeTableName, csvPath, conn);

                const timeTaken = Date.now() - startTime;
                logMigrationStatus(`PUBLIC.${snowflakeTableName}`, "SUCCESS", timeTaken);
                successCount++;
            } catch (error) {
                const timeTaken = Date.now() - startTime;
                logMigrationStatus(`PUBLIC.${snowflakeTableName}`, "FAILED", timeTaken, (error as Error).message);
                failedCount++;
            } finally {
                await fs.remove(csvPath);
            }
        });

        console.log('All tables migrated to Snowflake');
        console.log(`Success count: ${successCount}`);
        console.log(`Failed count: ${failedCount}`);
    } finally {
        isRunning = false;
    }
}

