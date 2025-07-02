import sql from 'mssql';
import fs from 'fs-extra';
import path from 'path';
import { format } from '@fast-csv/format';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { globSync } from 'glob';
import {
    compressCsvChunks,
    documentsFolder,
    fixTimestampFormat,
    initDbConnection,
    mapMSSQLTypeToSnowflakeType,
    normalize,
    runWithConcurrencyLimit,
    settings
} from '../../utils';
import { Connection } from 'snowflake-sdk';
import readline from 'readline';

let connection: sql.ConnectionPool | null = null;
let config: any = null;
let isRunning = false;
const MAX_CHUNK_SIZE_BYTES = 250 * 1024 * 1024;

function logMigrationStatus(
    tableName: string,
    status: "SUCCESS" | "FAILED" | "SKIPPED",
    timeTaken: number,
    rowsAffected?: number,
    errorMessage?: string
): void {
    const logDir = path.join(documentsFolder(), "DolphinEnquiries", "logs", "mssql");
    const logFile = path.join(logDir, `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.txt`);

    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    let logEntry = `${new Date().toLocaleTimeString()} - ${tableName} - ${status} - ${timeTaken}ms`;

    if (rowsAffected !== undefined) {
        logEntry += ` - Rows affected: ${rowsAffected}`;
    }

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
    const outputFile = `${outputPath}/${normalize(tableName)}.csv`;

    await fs.ensureDir(outputPath);
    const ws = fs.createWriteStream(outputFile, { encoding: 'utf8' });
    const csvStream = format({ headers: true, quote: '"', escape: '"' });
    csvStream.pipe(ws);

    const request = pool.request();
    request.stream = true;

    return new Promise<void>((resolve, reject) => {
        request.query(`SELECT * FROM ${fullTableName}`);

        request.on('row', (row) => {
            const cleaned = Object.fromEntries(
                Object.entries(row).map(([k, v]) => [k, v === null ? '' : typeof v === 'string' ? v.trim() : v])
            );
            const ok = csvStream.write(fixTimestampFormat(cleaned));
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
        });

        csvStream.on('finish', () => {
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

async function execSql(conn: Connection, sql: string): Promise<number> {
    return new Promise((resolve, reject) => {
        conn.execute({
            sqlText: sql,
            complete: (err, stmt, rows) => {
                if (err) return reject(err);
                console.log(`Executed SQL: ${sql}`);
                if (rows?.length) {
                    console.log(`Returned rows:`, rows);
                }
                try {
                    if (sql.trim().toUpperCase().startsWith("SELECT COUNT(*)")) {
                        const count = parseInt(rows?.[0]?.['COUNT(*)'] || rows?.[0]?.['COUNT'] || '0', 10);
                        resolve(count);
                    } else {
                        const affectedRows = stmt?.getNumUpdatedRows?.() ?? 0;
                        resolve(affectedRows);
                    }
                } catch (e) {
                    resolve(0);
                }
            },
        });
    });
}

async function getColumnList(conn: Connection, tableName: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        conn.execute({
            sqlText: `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = UPPER('${tableName}')
        AND TABLE_SCHEMA = CURRENT_SCHEMA()
        ORDER BY ORDINAL_POSITION
      `,
            complete: (err, _stmt, rows: any) => {
                if (err) return reject(err);
                const columns = rows.map((r: any) => `"${r.COLUMN_NAME}"`);
                resolve(columns);
            }
        });
    });
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

    return new Promise<boolean>((resolve, reject) => {
        conn.execute({
            sqlText: query,
            complete: (err, _stmt, rows) => {
                if (err) return reject(err);
                const count = rows?.[0]?.COUNT || rows?.[0]?.count || 0;
                const exists = Number(count) > 0;
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

    return `CREATE TABLE PUBLIC.${normalize(tableName)} (\n  ${columns.join(',\n  ')}\n);`;
}

async function splitCsvBySizeWithHeaders(inputCsv: string, outputDir: string, tableName: string): Promise<void> {
    const headerLines: string[] = [];
    let header: string | null = null;

    await fs.ensureDir(outputDir);

    const input = fs.createReadStream(inputCsv, { encoding: 'utf8' });
    const rl = readline.createInterface({ input, crlfDelay: Infinity });

    let currentChunkLines: string[] = [];
    let currentSize = 0;
    let chunkIndex = 0;

    const writeChunk = async () => {
        if (currentChunkLines.length === 0) return;

        const chunkPath = path.join(outputDir, `${tableName}_chunk_${chunkIndex}.csv`);
        const data = [header!, ...currentChunkLines].join('\n');
        await fs.writeFile(chunkPath, data, 'utf8');
        chunkIndex++;
        currentChunkLines = [];
        currentSize = 0;
    };

    for await (const line of rl) {
        if (header === null) {
            header = line;
            continue;
        }

        const lineSize = Buffer.byteLength(line, 'utf8') + 1;
        if (currentSize + lineSize > MAX_CHUNK_SIZE_BYTES) {
            await writeChunk();
        }

        currentChunkLines.push(line);
        currentSize += lineSize;
    }

    await writeChunk();
    rl.close();
}

async function fixCsvChunksColumns(chunkDir: string, expectedColumnsCount: number): Promise<void> {
  const files = await fs.readdir(chunkDir);

  for (const file of files) {
    if (!file.endsWith('.csv')) continue;

    const filePath = path.join(chunkDir, file);
    const content = await fs.readFile(filePath, 'utf-8');

    let records: string[][] = [];
    try {
      records = parse(content, {
        columns: false,
        skip_empty_lines: true,
        delimiter: ',',
        relax_quotes: false,
        trim: true,
      });
    } catch (err) {
      console.error(`Failed to parse file ${file}:`, err);
      continue;
    }

    const fixedRows = records.map((row, index) => {
      if (row.length > expectedColumnsCount) {
        const id = row[0];
        const status = row[row.length - 2];
        const runtime = row[row.length - 1];
        const queryParts = row.slice(1, row.length - 2);
        const query = queryParts.join(',');

        return [id, query, status, runtime];
      } else {
        const trimmed = row.slice(0, expectedColumnsCount);
        while (trimmed.length < expectedColumnsCount) trimmed.push('');
        return trimmed;
      }
    });

    const output = stringify(fixedRows, {
      quoted: true,
      quoted_empty: true,
      record_delimiter: '\n',
      escape: '"',
    });

    await fs.writeFile(filePath, output, 'utf-8');
  }
}

async function loadCsvIntoTable(conn: Connection, tableName: string, csvFilePath: string): Promise<number> {
    const tempTable = `${normalize(tableName)}_STAGING`;
    const stage = `@~/${normalize(tableName)}`;

    await execSql(conn, `CREATE OR REPLACE TRANSIENT TABLE ${normalize(tempTable)} LIKE ${normalize(tableName)}`);

    const chunkFolder = path.join(path.dirname(csvFilePath), 'chunks', normalize(tableName));
    await fs.ensureDir(chunkFolder);

    const stats = await fs.stat(csvFilePath);
    const columns = await getColumnList(conn, tableName);

    console.log(`CSV size for ${normalize(tableName)}: ${stats.size} bytes`);

    if (stats.size === 0 || columns.length === 0) {
        return 0;
    }

    await splitCsvBySizeWithHeaders(csvFilePath, chunkFolder, normalize(tableName));
    await fixCsvChunksColumns(chunkFolder, columns.length);
    await compressCsvChunks(chunkFolder);

    console.log(`Uploading chunks from ${chunkFolder} to stage ${stage}`);
    await uploadAllChunksToStage(conn, chunkFolder, stage);

    try {
        await execSql(conn, `
            COPY INTO ${tempTable}
            FROM '${stage}'
            PATTERN = '.*_chunk_.*\\.csv\\.gz'
            FILE_FORMAT = (
                TYPE = 'CSV'
                FIELD_OPTIONALLY_ENCLOSED_BY='"'
                SKIP_HEADER = 1
                COMPRESSION = 'GZIP'
                NULL_IF = ('')
            )
        `);
    } catch (error) {
        console.error(`Failed processing chunks for ${tableName}:`, error);
        throw error;
    } finally {
        await fs.remove(chunkFolder);
    }

    const mainTable = normalize(tableName);
    const stagingTable = `${mainTable}_STAGING`;
    const backupTable = `${mainTable}_OLD`;

    try {
        await execSql(conn, `BEGIN TRANSACTION;`);

        await execSql(conn, `ALTER TABLE ${mainTable} RENAME TO ${backupTable};`);
        await execSql(conn, `ALTER TABLE ${stagingTable} RENAME TO ${mainTable};`);

        await execSql(conn, `DROP TABLE IF EXISTS ${backupTable};`);
        await execSql(conn, `DROP TABLE IF EXISTS ${stagingTable};`);

        await execSql(conn, `COMMIT;`);

    } catch (error) {
        await execSql(conn, `ROLLBACK;`);
        throw error;
    }

    try {
        await execSql(conn, `REMOVE ${stage} pattern='.*\\.csv\\.gz';`);
    } catch (error) {
        console.error(`Failed to remove staged files:`, error);
    }

    return await execSql(conn, `SELECT COUNT(*) FROM ${mainTable};`);
}

async function uploadChunkWithRetry(conn: Connection, file: string, stageName: string, retries = 3) {
    const command = `PUT file://${file} ${stageName} AUTO_COMPRESS=FALSE`;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await execSql(conn, command);
            console.log(`Uploaded chunk: ${file}`);
            return;
        } catch (err) {
            console.warn(`Attempt ${attempt} failed for chunk ${file}: ${err}`);
            if (attempt === retries) throw err;
            await new Promise(res => setTimeout(res, 1000 * attempt));
        }
    }
}

async function uploadAllChunksToStage(conn: Connection, chunkFolder: string, stageName: string) {
    const files = globSync(`${chunkFolder}/*_chunk_*.csv.gz`);
    if (files.length === 0) throw new Error(`No compressed CSV chunks found for ${chunkFolder}`);

    for (const file of files) {
        await uploadChunkWithRetry(conn, file, stageName);
    }
}

export async function getAllDataIntoSnowflake() {
    if (isRunning) {
        console.log('Migration is already running. Skipping this invocation.');
        return;
    }
    isRunning = true;

    const tables = await getAllTables();
    console.log(`Total tables found: ${tables.length}`);
    const outputPath = path.join(documentsFolder(), "DolphinEnquiries", "tmp", "csvs");
    const conn = await initDbConnection(true);

    let successCount = 0;
    let failedCount = 0;

    try {
        for (const table of tables) {
            const mssqlSchema = table.TABLE_SCHEMA;
            const mssqlTableName = table.TABLE_NAME;
            const snowflakeTableName = normalize(mssqlTableName);

            const csvPath = `${outputPath}/${snowflakeTableName}.csv`;
            const startTime = Date.now();

            try {
                const tableExists = await doesTableExistInSnowflake(conn, snowflakeTableName);

                if (!tableExists) {
                    const createSQL = await generateCreateTableSQL(mssqlSchema, mssqlTableName);
                    await execSql(conn, createSQL);
                    console.log(`Created missing table: PUBLIC.${snowflakeTableName}`);
                }

                await exportTableToCSV(mssqlSchema, mssqlTableName, outputPath);
                const rowsAffected = await loadCsvIntoTable(conn, mssqlTableName, csvPath);

                const timeTaken = Date.now() - startTime;
                logMigrationStatus(`PUBLIC.${snowflakeTableName}`, "SUCCESS", timeTaken, rowsAffected);
                successCount++;
            } catch (error) {
                const timeTaken = Date.now() - startTime;
                logMigrationStatus(`PUBLIC.${snowflakeTableName}`, "FAILED", timeTaken, undefined, (error as Error).message);
                failedCount++;
            }
        }
    } finally {
        try {
            if (conn) {
                conn.destroy((err) => {
                    if (err) {
                        console.error("Error closing Snowflake connection:", err);
                    } else {
                        console.log("Snowflake connection closed.");
                    }
                });
            }

            if (connection && connection.connected) {
                await connection.close();
                console.log("MSSQL connection closed.");
            }
        } catch (err) {
            console.error("Error during connection cleanup:", err);
        }

        console.log(`Migration complete. Success: ${successCount}, Failed: ${failedCount}`);
        isRunning = false;
    }
}
