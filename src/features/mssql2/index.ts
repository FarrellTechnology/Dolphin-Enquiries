import sql, { ConnectionPool } from "mssql";
import { Transform } from "stream";
import zlib from "zlib";
import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { exec } from "child_process";
import util from "util";

import { initDbConnection, logToFile, mapMSSQLTypeToSnowflakeType, processInBatches, settings } from "../../utils";
import { Connection } from "snowflake-sdk";

const execPromise = util.promisify(exec);
const MAX_CHUNK_BYTES = 50 * 1024 * 1024;

let connection: ConnectionPool | null = null;
let config: any = null;

/**
 * Connects to the MSSQL database and returns a connection pool.
 * 
 * @returns {Promise<ConnectionPool>} The connection pool to the MSSQL database.
 * @throws {Error} Throws an error if the MSSQL configuration is missing.
 */
export async function connect(): Promise<ConnectionPool> {
    if (connection && connection.connected) return connection;

    config = await settings.getMsSQLConfig();
    if (!config) throw new Error("MsSQL config is missing");

    connection = await sql.connect(config);
    logToFile("mssql2", "Connected to MSSQL database");
    return connection;
}

/**
 * Retrieves all table names and schemas from the MSSQL database.
 * 
 * @returns {Promise<{ TABLE_SCHEMA: string; TABLE_NAME: string }[]>} A list of tables with their schema names.
 */
export async function getAllTables(): Promise<{ TABLE_SCHEMA: string; TABLE_NAME: string }[]> {
    const pool = await connect();

    const query = `SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'`;
    const result = await pool.request().query(query);
    logToFile("mssql2", `Fetched ${result.recordset.length} tables from MSSQL`);
    return result.recordset;
}

/**
 * Class for chunking CSV data.
 * This class is used to split large data into smaller chunks, compress, and upload them to Snowflake.
 */
class CsvChunker extends Transform {
    headers: string[];
    chunkBuffers: Buffer[] = [];
    chunkSize: number = 0;
    chunksCreated: number = 0;
    onChunkReady: (chunkPath: string) => Promise<void>;

    /**
     * Creates a CsvChunker instance.
     * 
     * @param {string[]} headers - The headers for the CSV data.
     * @param {(chunkPath: string) => Promise<void>} onChunkReady - Callback to be called when a chunk is ready to be uploaded.
     */
    constructor(headers: string[], onChunkReady: (chunkPath: string) => Promise<void>) {
        super({ objectMode: true });
        this.headers = headers;
        this.onChunkReady = onChunkReady;
        this.push(headers.join(",") + "\n");
    }

    /**
     * Transforms each row of data into CSV format and manages chunking.
     * 
     * @param {any} row - The row of data to transform.
     * @param {string} encoding - The encoding of the data.
     * @param {Function} callback - The callback function to be called when the transformation is complete.
     */
    async _transform(row: any, encoding: string, callback: Function) {
        try {
            const line = this.headers.map(h => {
                let v = row[h];
                if (v === null || v === undefined) return "";
                v = v.toString().replace(/"/g, '""');
                if (v.includes(",") || v.includes("\n")) v = `"${v}"`;
                return v;
            }).join(",") + "\n";

            const lineBuffer = Buffer.from(line, "utf-8");
            if (this.chunkSize + lineBuffer.length > MAX_CHUNK_BYTES) {
                const chunkPath = await this.flushChunk();
                await this.onChunkReady(chunkPath);
            }
            this.chunkBuffers.push(lineBuffer);
            this.chunkSize += lineBuffer.length;
            callback();
        } catch (err) {
            callback(err);
        }
    }

    /**
     * Flushes the current chunk and prepares for the next one.
     * 
     * @param {Function} callback - The callback function to signal completion.
     */
    async _flush(callback: Function) {
        try {
            if (this.chunkBuffers.length > 0) {
                const chunkPath = await this.flushChunk();
                await this.onChunkReady(chunkPath);
            }
            callback();
        } catch (err) {
            callback(err);
        }
    }

    /**
     * Creates a chunk file, compresses it, and returns the file path.
     * 
     * @returns {Promise<string>} The file path of the created and compressed chunk.
     */
    async flushChunk(): Promise<string> {
        this.chunksCreated++;
        const chunkData = Buffer.concat(this.chunkBuffers, this.chunkSize);
        this.chunkBuffers = [];
        this.chunkSize = 0;

        const compressedData = zlib.gzipSync(chunkData);
        const chunkFileName = `chunk_${uuidv4()}.csv.gz`;
        const chunkFilePath = path.join("/tmp", chunkFileName);
        await fs.writeFile(chunkFilePath, compressedData);

        logToFile("mssql2", `Created chunk #${this.chunksCreated}: ${chunkFilePath}`);
        return chunkFilePath;
    }
}

/**
 * Uploads a chunk of CSV data to the Snowflake stage.
 * 
 * @param {Connection | null} conn - The Snowflake connection instance.
 * @param {string} stageName - The Snowflake stage name where the file will be uploaded.
 * @param {string} chunkPath - The path to the CSV chunk to be uploaded.
 */
async function uploadChunkToSnowflakeStage(conn: Connection | null, stageName: string, chunkPath: string) {
    const fileName = path.basename(chunkPath);

    logToFile("mssql2", `Uploading ${fileName} to Snowflake stage ${stageName}`);

    const putCmd = `PUT file://${chunkPath} @${stageName}`;

    try {
        await executeAsync(conn, putCmd);
        await fs.unlink(chunkPath);
        logToFile("mssql2", `Uploaded and deleted local chunk file ${fileName}`);
    } catch (error: any) {
        logToFile("mssql2", `ERROR uploading chunk ${fileName}: ${error.message || error}`);
        await fs.unlink(chunkPath).catch(() => { });
        throw error;
    }
}

/**
 * Executes a SQL command asynchronously on the Snowflake database.
 * 
 * @param {Connection | null} conn - The Snowflake connection instance.
 * @param {string} sqlText - The SQL query to execute.
 * @returns {Promise<void>} Resolves when the SQL command execution is complete.
 */
function executeAsync(conn: Connection | null, sqlText: string): Promise<void> {
    return new Promise((resolve, reject) => {
        conn?.execute({ sqlText, complete: (err) => (err ? reject(err) : resolve()) });
    });
}

/**
 * Replaces a table in Snowflake with the data from the stage.
 * 
 * @param {Connection | null} conn - The Snowflake connection instance.
 * @param {string} schema - The schema where the table exists in Snowflake.
 * @param {string} tableName - The table name to be replaced in Snowflake.
 * @param {string} stageName - The stage name from where to load the data.
 */
async function replaceSnowflakeTableWithStageData(conn: Connection | null, schema: string, tableName: string, stageName: string) {
    const stagingTable = `${tableName}_STAGING`;
    const stagePath = `@${stageName}/${tableName}`;

    try {
        await executeAsync(conn, `TRUNCATE TABLE ${tableName}`);
        await executeAsync(conn, `CREATE OR REPLACE TEMPORARY TABLE ${stagingTable} LIKE ${tableName}`);
        await executeAsync(conn, `COPY INTO ${stagingTable} FROM ${stagePath} FILE_FORMAT = (TYPE = 'CSV' FIELD_OPTIONALLY_ENCLOSED_BY = '"' SKIP_HEADER = 1 COMPRESSION = 'GZIP') PURGE = TRUE ON_ERROR = 'CONTINUE'`);
        await executeAsync(conn, `TRUNCATE TABLE ${tableName}`);
        await executeAsync(conn, `INSERT INTO ${tableName} SELECT * FROM ${stagingTable}`);
        await executeAsync(conn, `DROP TABLE IF EXISTS ${stagingTable}`);

        logToFile("mssql2", `Replaced table ${tableName} with data loaded from stage ${stagePath}`);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logToFile("mssql2", `ERROR replacing table ${tableName}: ${msg}`);
        throw error;
    }
}

/**
 * Ensures that the Snowflake table exists and matches the MSSQL table schema.
 * 
 * @param {Connection | null} conn - The Snowflake connection instance.
 * @param {string} schema - The schema in Snowflake.
 * @param {string} tableName - The name of the table in Snowflake.
 * @param {Array<{ COLUMN_NAME: string, DATA_TYPE: string }>} mssqlColumns - The columns from the MSSQL table.
 * @returns {Promise<void>} Resolves when the table exists or is created.
 */
export async function ensureSnowflakeTableExists(
    conn: Connection | null,
    schema: string,
    tableName: string,
    mssqlColumns: { COLUMN_NAME: string; DATA_TYPE: string }[]
): Promise<void> {
    const tableIdentifier = `"${schema}"."${tableName}"`;

    const columnsDefinition = mssqlColumns.map(col => {
        const snowflakeType = mapMSSQLTypeToSnowflakeType(col.DATA_TYPE);
        const colName = col.COLUMN_NAME.replace(/"/g, '""');
        return `"${colName}" ${snowflakeType}`;
    }).join(", ");

    const createSql = `CREATE TABLE IF NOT EXISTS ${tableIdentifier} (${columnsDefinition})`;

    return new Promise((resolve, reject) => {
        conn?.execute({
            sqlText: createSql,
            complete: (err) => {
                if (err) {
                    console.error(`Failed to create Snowflake table ${tableIdentifier}:`, err.message);
                    reject(err);
                } else {
                    console.log(`Ensured Snowflake table exists: ${tableIdentifier}`);
                    resolve();
                }
            }
        });
    });
}

/**
 * Streams a MSSQL table to Snowflake in chunks.
 * 
 * @param {string} tableName - The name of the table to stream.
 * @param {string} stageName - The Snowflake stage name to upload data.
 * @param {Connection | null} conn - The Snowflake connection instance.
 * @returns {Promise<void>} Resolves when the streaming and upload process is complete.
 */
async function streamTableToChunks(tableName: string, stageName: string, conn: Connection | null): Promise<void> {
    const pool = await connect();
    const request = pool.request();
    request.stream = true;

    const columnsResult = await pool.request().query(`SELECT * FROM ${tableName} WHERE 1=0`);
    const headers = columnsResult.recordset.columns
        ? Object.keys(columnsResult.recordset.columns)
        : Object.keys(columnsResult.recordset[0] || {});

    return new Promise<void>((resolve, reject) => {
        const csvChunker = new CsvChunker(headers, async (chunkPath) => {
            await uploadChunkToSnowflakeStage(conn, stageName, chunkPath);
        });

        request.query(`SELECT * FROM ${tableName}`);

        request.on("row", row => {
            if (!csvChunker.write(row)) {
                request.pause();
                csvChunker.once("drain", () => request.resume());
            }
        });
        request.on("error", err => reject(err));
        request.on("done", () => {
            csvChunker.end();
            csvChunker.on("finish", () => resolve());
        });
    });
}

/**
 * Migrates data from MSSQL to Snowflake in chunks.
 * 
 * @returns {Promise<void>} Resolves when the migration process is complete.
 */
export async function getAllDataIntoSnowflakeTwo(): Promise<void> {
    try {
        const sfConnection = await initDbConnection(true);
        await executeAsync(sfConnection, `CREATE STAGE IF NOT EXISTS migration_stage`);

        const tables = await getAllTables();
        logToFile("mssql2", `Starting migration of ${tables.length} tables`);

        await processInBatches(tables, 10, async table => {
            const fullTableName = `[${table.TABLE_SCHEMA}].[${table.TABLE_NAME.replace(/]/g, ']]')}]`;
            const sanitizedTableName = table.TABLE_NAME.replace(/\s+/g, "_");
            const snowflakeStage = `migration_stage/${sanitizedTableName}`;

            logToFile("mssql2", `Starting migration of ${fullTableName}`);

            await streamTableToChunks(sanitizedTableName, snowflakeStage, sfConnection);
            await replaceSnowflakeTableWithStageData(sfConnection, "PUBLIC", sanitizedTableName, "migration_stage");
        });

        logToFile("mssql2", "All tables migrated successfully");
    } catch (err: any) {
        logToFile("mssql2", `Error during migration: ${err.message || err}`);
        console.error("Error during migration:", err);
    } finally {
        if (connection) {
            await connection.close();
            connection = null;
            logToFile("mssql2", "Closed MSSQL connection");
        }
    }
}
