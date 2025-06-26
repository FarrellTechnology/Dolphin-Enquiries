import sql from 'mssql';
import fs from 'fs-extra';
import path from 'path';
import { format } from '@fast-csv/format';
import {
    documentsFolder,
    fixTimestampFormat,
    initDbConnection,
    mapMSSQLTypeToSnowflakeType,
    normalize,
    runWithConcurrencyLimit,
    settings
} from '../../utils';
import { Connection } from 'snowflake-sdk';
import csvSplitStream from 'csv-split-stream';
import readline from 'readline';

let connection: sql.ConnectionPool | null = null;
let config: any = null;
let isRunning = false;

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
                Object.entries(row).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
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
                try {
                    const affectedRows = stmt?.getNumUpdatedRows?.() ?? 0;
                    resolve(affectedRows);
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

    return `CREATE TABLE PUBLIC.${normalize(tableName)} (\n  ${columns.join(',\n  ')}\n);`;
}

const MAX_CHUNK_SIZE_BYTES = 250 * 1024 * 1024; // 250MB

async function getPrimaryKeyColumn(schema: string, tableName: string): Promise<string | null> {
    const pool = await connect();
    const result = await pool.request().query(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS AS TC
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS KU
          ON TC.CONSTRAINT_NAME = KU.CONSTRAINT_NAME
        WHERE TC.TABLE_SCHEMA = '${schema}'
          AND TC.TABLE_NAME = '${tableName}'
          AND TC.CONSTRAINT_TYPE = 'PRIMARY KEY'
    `);
    return result.recordset[0]?.COLUMN_NAME || null;
}

async function splitCsvBySizeWithHeaders(inputCsv: string, outputDir: string): Promise<void> {
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

        const chunkPath = path.join(outputDir, `chunk_${chunkIndex}.csv`);
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

        const lineSize = Buffer.byteLength(line, 'utf8') + 1; // +1 for newline
        if (currentSize + lineSize > MAX_CHUNK_SIZE_BYTES) {
            await writeChunk();
        }

        currentChunkLines.push(line);
        currentSize += lineSize;
    }

    await writeChunk(); // Write remaining lines
    rl.close();
}

async function mergeCsvIntoTable(conn: Connection, schema: string, tableName: string, csvFilePath: string): Promise<number> {
    const tempTable = `${normalize(tableName)}_STAGING`;
    const stage = '@~';

    await execSql(conn, `CREATE OR REPLACE TEMP TABLE ${normalize(tempTable)} LIKE ${normalize(tableName)}`);

    const chunkFolder = path.join(path.dirname(csvFilePath), 'chunks', normalize(tableName));
    await fs.ensureDir(chunkFolder);

    const stats = await fs.stat(csvFilePath);
    console.log(`CSV size for ${normalize(tableName)}: ${stats.size} bytes`);
    if (stats.size === 0) throw new Error('CSV file is empty');

    await splitCsvBySizeWithHeaders(csvFilePath, chunkFolder);

    const columns = await getColumnList(conn, tableName);
    if (columns.length === 0) {
        throw new Error(`No columns found for table ${tableName}`);
    }
    const pk = await getPrimaryKeyColumn(schema, tableName);
    const mergeKey = pk ?? columns[0];

    await uploadAllChunksToStage(conn, chunkFolder, stage);

    try {
        if (!columns.includes(mergeKey)) {
            throw new Error(`Merge key column ${mergeKey} not found in Snowflake table ${tableName}`);
        }

        await execSql(conn, `
            COPY INTO ${tempTable}
            FROM '${stage}/..*\\.csv'
            FILE_FORMAT = (TYPE = 'CSV' FIELD_OPTIONALLY_ENCLOSED_BY='"' SKIP_HEADER=1)
        `);

        await fs.remove(chunkFolder);
    } catch (error) {
        console.error(`Failed processing chunks for ${tableName}:`, error);
        throw error;
    } finally {
        await execSql(conn, `DROP TABLE IF EXISTS ${tempTable}`);
    }

    await fs.remove(chunkFolder);

    const updateSet = columns
        .filter(col => col !== mergeKey)
        .map(col => `target.${col} = source.${col}`)
        .join(', ');
    const columnList = columns.join(', ');
    const insertValues = columns.map(col => `source.${col}`).join(', ');

    const rowsAffected = await execSql(conn, `
        MERGE INTO ${tableName} AS target
        USING ${tempTable} AS source
        ON target.${mergeKey} = source.${mergeKey}
        WHEN MATCHED THEN UPDATE SET ${updateSet}
        WHEN NOT MATCHED THEN INSERT (${columnList}) VALUES (${insertValues});
    `);

    return rowsAffected;
}

async function uploadAllChunksToStage(conn: Connection, chunkDir: string, stageName: string) {
    const command = `PUT file://${chunkDir}/*.csv ${stageName} AUTO_COMPRESS=FALSE PARALLEL=8`;
    await execSql(conn, command);
}

async function uploadFileToStage(conn: Connection, localFilePath: string, stageName: string) {
    const sql = `PUT file://${localFilePath} ${stageName} AUTO_COMPRESS=FALSE`;
    await execSql(conn, sql);
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
        const outputPath = path.join(documentsFolder(), "DolphinEnquiries", "tmp", "csvs");

        await runWithConcurrencyLimit(tables, 10, async (table) => {
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
                const rowsAffected = await mergeCsvIntoTable(conn, mssqlSchema, mssqlTableName, csvPath);

                const timeTaken = Date.now() - startTime;
                logMigrationStatus(`PUBLIC.${snowflakeTableName}`, "SUCCESS", timeTaken, rowsAffected);
                successCount++;
            } catch (error) {
                const timeTaken = Date.now() - startTime;
                logMigrationStatus(`PUBLIC.${snowflakeTableName}`, "FAILED", timeTaken, undefined, (error as Error).message);
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
