import sql from 'mssql';
import fs from 'fs-extra';
import path from 'path';
import { format } from '@fast-csv/format';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import {
    compressCsvChunks,
    documentsFolder,
    fixTimestampFormat,
    initDbConnection,
    logToFile,
    mapMSSQLTypeToSnowflakeType,
    normalize,
    settings
} from '../../utils';
import { Connection } from 'snowflake-sdk';
import readline from 'readline';

let connection: sql.ConnectionPool | null = null;
let config: any = null;
let isRunning = false;
const MAX_CHUNK_SIZE_BYTES = 250 * 1024 * 1024;

/**
 * Logs the migration status for a given table.
 * 
 * @param {string} tableName - The name of the table being migrated.
 * @param {"SUCCESS" | "FAILED" | "SKIPPED"} status - The status of the migration (SUCCESS, FAILED, or SKIPPED).
 * @param {number} timeTaken - The time taken to process the table in milliseconds.
 * @param {number} [rowsAffected] - The number of rows affected by the migration (optional).
 * @param {string} [errorMessage] - The error message if the migration failed (optional).
 */
function logMigrationStatus(
    tableName: string,
    status: "SUCCESS" | "FAILED" | "SKIPPED",
    timeTaken: number,
    rowsAffected?: number,
    errorMessage?: string
): void {
    let logLine = `${tableName} - ${status} - ${timeTaken}ms`;

    if (rowsAffected !== undefined) {
        logLine += ` - Rows affected: ${rowsAffected}`;
    }

    if (errorMessage && status === "FAILED") {
        const sanitizedError = errorMessage.replace(/\s+/g, " ").substring(0, 500);
        logLine += ` - ERROR: ${sanitizedError}`;
    }

    logToFile("mssql", logLine);
}

/**
 * Connects to the MSSQL database and returns the connection pool.
 * 
 * @returns {Promise<sql.ConnectionPool>} The MSSQL connection pool.
 * @throws {Error} If the MSSQL configuration is missing.
 */
async function connect() {
    if (connection && connection.connected) {
        return connection;
    }

    config = await settings.getMsSQLConfig();
    if (!config) throw new Error('MsSQL config is missing');

    connection = await sql.connect(config);
    return connection;
}

/**
 * Exports a table from MSSQL to a CSV file.
 * 
 * @param {string} schema - The schema of the table.
 * @param {string} tableName - The name of the table to export.
 * @param {string} outputPath - The output path where the CSV file will be saved.
 * @returns {Promise<void>} Resolves when the export is complete.
 */
async function exportTableToCSV(schema: string, tableName: string, outputPath: string) {
    const pool = await connect();
    const fullTableName = `[${schema}].[${tableName}]`;
    await fs.ensureDir(outputPath);
    const outputFile = path.join(outputPath, `${normalize(tableName)}.csv`);
    const ws = fs.createWriteStream(outputFile, { encoding: 'utf8' });
    const csvStream = format({ headers: true, quote: '"', escape: '"' });
    csvStream.pipe(ws);

    const request = pool.request();
    request.stream = true;
    request.query(`SELECT * FROM ${fullTableName}`);

    return new Promise<void>((resolve, reject) => {
        request.on('row', (row) => {
            const cleaned = Object.fromEntries(Object.entries(row).map(([k, v]) =>
                [k, v === null ? '' : typeof v === 'string' ? v.trim() : v]
            ));
            const ok = csvStream.write(fixTimestampFormat(cleaned));
            if (!ok) {
                request.pause();
                csvStream.once('drain', () => request.resume());
            }
        });
        request.on('error', err => {
            csvStream.end();
            ws.close();
            reject(err);
        });
        request.on('done', () => csvStream.end());
        csvStream.on('finish', () => resolve());
    });
}

/**
 * Retrieves all table names from the database.
 * 
 * @returns {Promise<Array<{ TABLE_SCHEMA: string, TABLE_NAME: string }>>} A list of tables with their schemas.
 */
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

/**
 * Executes a SQL query on the Snowflake database.
 * 
 * @param {Connection | null} conn - The Snowflake connection instance.
 * @param {string} sql - The SQL query to execute.
 * @returns {Promise<number>} The number of affected rows.
 */
async function execSql(conn: Connection | null, sql: string): Promise<number> {
    return new Promise((resolve, reject) => {
        conn?.execute({
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

/**
 * Retrieves the column list for a given table.
 * 
 * @param {Connection | null} conn - The Snowflake connection instance.
 * @param {string} tableName - The name of the table.
 * @returns {Promise<string[]>} A list of column names for the table.
 */
async function getColumnList(conn: Connection | null, tableName: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        conn?.execute({
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

/**
 * Checks if a table exists in the Snowflake database.
 * 
 * @param {Connection | null} conn - The Snowflake connection instance.
 * @param {string} tableName - The name of the table.
 * @returns {Promise<boolean>} True if the table exists, false otherwise.
 */
async function doesTableExistInSnowflake(conn: Connection | null, tableName: string): Promise<boolean> {
    const schema = 'PUBLIC';
    const name = tableName;
    const query = `
        SELECT COUNT(*) AS count
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = UPPER('${schema}')
        AND TABLE_NAME = UPPER('${name}')
    `;

    return new Promise<boolean>((resolve, reject) => {
        conn?.execute({
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

/**
 * Generates the SQL `CREATE TABLE` statement for a Snowflake table based on the MSSQL table schema.
 * 
 * @param {string} tableSchema - The schema of the MSSQL table.
 * @param {string} tableName - The name of the MSSQL table.
 * @returns {Promise<string>} The `CREATE TABLE` SQL statement for Snowflake.
 */
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

/**
 * Splits a CSV file into smaller chunks based on file size.
 * 
 * @param {string} inputCsv - The input CSV file path.
 * @param {string} outputDir - The directory to save the chunked files.
 * @param {string} baseName - The base name for the chunked files.
 * @param {number} maxSize - The maximum size of each chunk in bytes.
 * @returns {Promise<void>} Resolves when the file is split into chunks.
 */
async function splitCsvBySizeWithHeaders(inputCsv: string, outputDir: string, baseName: string, maxSize = MAX_CHUNK_SIZE_BYTES) {
    await fs.ensureDir(outputDir);

    const rl = readline.createInterface({
        input: fs.createReadStream(inputCsv, 'utf8'),
        crlfDelay: Infinity,
    });

    let header: string | null = null;
    let chunkLines: string[] = [];
    let chunkSize = 0;
    let chunkIndex = 0;

    async function writeChunk() {
        if (chunkLines.length === 0) return;
        const chunkPath = path.join(outputDir, `${baseName}_chunk_${chunkIndex}.csv`);
        const data = [header!, ...chunkLines].join('\n') + '\n';
        await fs.writeFile(chunkPath, data, 'utf8');
        chunkIndex++;
        chunkLines = [];
        chunkSize = 0;
    }

    for await (const line of rl) {
        if (!header) {
            header = line;
            continue;
        }

        const lineSize = Buffer.byteLength(line, 'utf8') + 1; // +1 for newline
        if (chunkSize + lineSize > maxSize) {
            await writeChunk();
        }

        chunkLines.push(line);
        chunkSize += lineSize;
    }

    await writeChunk();
    rl.close();
}

/**
 * Fixes the columns in CSV chunks to match the expected number of columns.
 * 
 * @param {string} chunkDir - The directory containing the chunked CSV files.
 * @param {number} expectedCols - The expected number of columns in the CSV files.
 * @returns {Promise<void>} Resolves when the columns are fixed.
 */
async function fixCsvChunksColumns(chunkDir: string, expectedCols: number) {
    const files = await fs.readdir(chunkDir);
    for (const file of files) {
        if (!file.endsWith('.csv')) continue;
        const filePath = path.join(chunkDir, file);
        const content = await fs.readFile(filePath, 'utf8');

        let records = parse(content, { columns: false, skip_empty_lines: true, relax_quotes: true });

        records = records.map((row: string | any[]) => {
            if (row.length > expectedCols) return row.slice(0, expectedCols);
            else if (row.length < expectedCols) return [...row, ...Array(expectedCols - row.length).fill('')];
            return row;
        });

        const output = stringify(records, { quoted: true, quoted_empty: true, record_delimiter: '\n', escape: '"' });
        await fs.writeFile(filePath, output, 'utf8');
    }
}

/**
 * Uploads all CSV chunks to the Snowflake stage.
 * 
 * @param {Connection | null} conn - The Snowflake connection instance.
 * @param {string} chunkDir - The directory containing the CSV chunks.
 * @param {string} stage - The Snowflake stage to upload the files to.
 * @returns {Promise<void>} Resolves when all chunks are uploaded.
 */
async function uploadAllChunksToStage(conn: Connection | null, chunkDir: string, stage: string) {
    const files = (await fs.readdir(chunkDir))
        .filter(f => f.endsWith('.csv.gz'))
        .map(f => path.join(chunkDir, f));

    for (const file of files) {
        await uploadChunkWithRetry(conn, file, stage);
    }
}

/**
 * Loads CSV data into a Snowflake table.
 * 
 * @param {Connection | null} conn - The Snowflake connection instance.
 * @param {string} tableName - The Snowflake table name.
 * @param {string} csvFilePath - The path to the CSV file to load.
 * @returns {Promise<number>} The number of rows loaded into the table.
 */
async function loadCsvIntoTable(conn: Connection | null, tableName: string, csvFilePath: string) {
    const baseName = normalize(tableName);
    const tempTable = `${baseName}_STAGING`;
    const stage = `@~/${baseName}`;

    await execSql(conn, `CREATE OR REPLACE TRANSIENT TABLE ${tempTable} LIKE ${baseName}`);

    const chunkDir = path.join(path.dirname(csvFilePath), 'chunks', baseName);
    await fs.ensureDir(chunkDir);

    const stats = await fs.stat(csvFilePath);
    if (stats.size === 0) return 0;

    const columns = await getColumnList(conn, baseName);
    if (columns.length === 0) return 0;

    await splitCsvBySizeWithHeaders(csvFilePath, chunkDir, baseName);
    await fixCsvChunksColumns(chunkDir, columns.length);
    await compressCsvChunks(chunkDir);
    await uploadAllChunksToStage(conn, chunkDir, stage);

    await execSql(conn, `
        COPY INTO ${tempTable}
        FROM '${stage}'
        PATTERN = '.*_chunk_.*\\.csv\\.gz'
        FILE_FORMAT = (
            TYPE = 'CSV',
            FIELD_DELIMITER = ',',
            FIELD_OPTIONALLY_ENCLOSED_BY = '"',
            SKIP_HEADER = 1,
            COMPRESSION = 'GZIP',
            TRIM_SPACE = TRUE,
            NULL_IF = (''),
            EMPTY_FIELD_AS_NULL = TRUE
        )
        ON_ERROR = 'CONTINUE'
        VALIDATION_MODE = RETURN_ERRORS
    `);

    const backupTable = `${baseName}_OLD`;
    await execSql(conn, 'BEGIN TRANSACTION;');
    await execSql(conn, `ALTER TABLE ${baseName} RENAME TO ${backupTable};`);
    await execSql(conn, `ALTER TABLE ${tempTable} RENAME TO ${baseName};`);
    await execSql(conn, `DROP TABLE IF EXISTS ${backupTable};`);
    await execSql(conn, 'COMMIT;');

    try {
        await execSql(conn, `REMOVE ${stage} PATTERN='.*\\.csv\\.gz';`);
        await execSql(conn, `DROP TABLE IF EXISTS ${tempTable};`);
    } catch (err) {
        console.warn('Failed to clear stage files', err);
    }

    return await execSql(conn, `SELECT COUNT(*) FROM ${baseName};`);
}

/**
 * Uploads a single CSV chunk to the Snowflake stage, retrying on failure.
 * 
 * @param {Connection | null} conn - The Snowflake connection instance.
 * @param {string} file - The file path of the CSV chunk to upload.
 * @param {string} stage - The Snowflake stage to upload the file to.
 * @param {number} [maxRetries=3] - The maximum number of retry attempts.
 * @returns {Promise<void>} Resolves when the chunk is uploaded.
 */
async function uploadChunkWithRetry(conn: Connection | null, file: string, stage: string, maxRetries = 3) {
    const command = `PUT file://${file} ${stage} AUTO_COMPRESS=FALSE`;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await execSql(conn, command);
            return;
        } catch (error) {
            if (attempt === maxRetries) throw error;
            console.warn(`Upload failed for ${file}, retrying ${attempt}/${maxRetries}...`);
            await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
}

/**
 * Main function to migrate all data from MSSQL to Snowflake.
 * 
 * @returns {Promise<void>} Resolves when the migration is complete.
 */
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
