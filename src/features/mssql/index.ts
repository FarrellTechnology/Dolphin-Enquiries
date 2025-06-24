import sql from 'mssql';
import fs from 'fs-extra';
import path from 'path';
import { format } from '@fast-csv/format';
import { documentsFolder, fixTimestampFormat, initDbConnection, mapMSSQLTypeToSnowflakeType, normalize, runWithConcurrencyLimit, settings } from '../../utils';
import { Connection } from 'snowflake-sdk';

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
    const outputFile = `${outputPath}/${normalize(tableName)}.csv`;

    await fs.ensureDir(outputPath);
    const ws = fs.createWriteStream(outputFile);
    const csvStream = format({ headers: true });
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

async function mergeCsvIntoTable(conn: Connection, tableName: string, fileName: string) {
    const tempTable = `${tableName}_STAGING`;
    const stage = '@~';

    await execSql(conn, `CREATE OR REPLACE TEMP TABLE ${tempTable} LIKE ${tableName}`);

    await execSql(conn, `
        COPY INTO ${tempTable}
        FROM '${stage}/${fileName}'
        FILE_FORMAT = (TYPE = 'CSV' FIELD_OPTIONALLY_ENCLOSED_BY='"' SKIP_HEADER=1)
    `);

    const columns = await getColumnList(conn, tableName);
    const mergeKey = columns[0];

    const updateSet = columns
        .filter(col => col !== mergeKey)
        .map(col => `target.${col} = source.${col}`)
        .join(', ');

    const columnList = columns.join(', ');
    const insertValues = columns.map(col => `source.${col}`).join(', ');

    await execSql(conn, `
        MERGE INTO ${tableName} AS target
        USING ${tempTable} AS source
        ON target.${mergeKey} = source.${mergeKey}
        WHEN MATCHED THEN UPDATE SET ${updateSet}
        WHEN NOT MATCHED THEN INSERT (${columnList}) VALUES (${insertValues});
    `);
}

async function execSql(conn: Connection, sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
        conn.execute({
            sqlText: sql,
            complete: (err) => (err ? reject(err) : resolve())
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

    return `CREATE TABLE PUBLIC.${normalize(tableName)} (\n  ${columns.join(',\n  ')}\n);`;
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
                    await new Promise<void>((resolve, reject) => {
                        conn.execute({
                            sqlText: createSQL,
                            complete: (err) => (err ? reject(err) : resolve()),
                        });
                    });
                    console.log(`Created missing table: PUBLIC.${snowflakeTableName}`);
                }

                await exportTableToCSV(mssqlSchema, mssqlTableName, outputPath);
                await mergeCsvIntoTable(conn, snowflakeTableName, csvPath);

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
