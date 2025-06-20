import sql from 'mssql';
import fs from 'fs-extra';
import path from 'path';
import { format } from '@fast-csv/format';
import { documentsFolder, fixTimestampFormat, initDbConnection, mapMSSQLTypeToSnowflakeType, settings } from '../../utils';
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

async function doesTableExistInSnowflake(conn: Connection, tableName: string): Promise<boolean> {
    const schema = 'PUBLIC'; // always use PUBLIC
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
                const exists = !!(rows && rows[0] && rows[0].COUNT === 1);
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

        // Detect if maxLen indicates VARCHAR(MAX) or similar
        const isMaxLength = maxLen === -1 || maxLen === 2147483647;

        const typeWithLength = ['VARCHAR', 'CHAR'].includes(snowflakeType)
            ? (isMaxLength ? `${snowflakeType}(16777216)` : `${snowflakeType}(${maxLen})`)
            : snowflakeType;

        return `"${col.COLUMN_NAME}" ${typeWithLength}`;
    });

    return `CREATE TABLE PUBLIC.${tableName} (\n  ${columns.join(',\n  ')}\n);`;
}

async function batchRun<T>(
    items: T[],
    batchSize: number,
    fn: (item: T, index: number) => Promise<void>
) {
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        await Promise.all(batch.map((item, idx) => fn(item, i + idx)));
    }
}

export async function getAllDataIntoSnowflake() {
    const tables = await getAllTables();
    console.log(`Total tables found: ${tables.length}`);
    const conn = await initDbConnection(true);
    const outputPath = './tmp_csvs';

    await batchRun(tables, 4, async (table, index) => {
        console.log(`Migrating table ${index + 1} of ${tables.length}: ${table.TABLE_SCHEMA}.${table.TABLE_NAME}`);

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
        } catch (error) {
            const timeTaken = Date.now() - startTime;
            logMigrationStatus(`PUBLIC.${snowflakeTableName}`, "FAILED", timeTaken, (error as Error).message);
        }
    });

    console.log('All tables migrated to Snowflake');
}

