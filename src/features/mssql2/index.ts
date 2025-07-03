import sql, { ConnectionPool } from "mssql";
import { Transform } from "stream";
import zlib from "zlib";
import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { exec } from "child_process";
import util from "util";

import { initDbConnection, logToFile, settings } from "../../utils";
import { Connection } from "snowflake-sdk";

const execPromise = util.promisify(exec);
const MAX_CHUNK_BYTES = 50 * 1024 * 1024; // 50 MB chunk size

let connection: ConnectionPool | null = null;
let config: any = null;

export async function connect(): Promise<ConnectionPool> {
    if (connection && connection.connected) {
        return connection;
    }

    config = await settings.getMsSQLConfig();
    if (!config) throw new Error("MsSQL config is missing");

    connection = await sql.connect(config);
    logToFile("mssql2", "Connected to MSSQL database");
    return connection;
}

export async function getAllTables(): Promise<{ TABLE_SCHEMA: string; TABLE_NAME: string }[]> {
    const pool = await connect();

    const query = `
    SELECT TABLE_SCHEMA, TABLE_NAME 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_TYPE = 'BASE TABLE'
  `;

    const result = await pool.request().query(query);
    logToFile("mssql2", `Fetched ${result.recordset.length} tables from MSSQL`);
    return result.recordset;
}

class CsvChunker extends Transform {
    headers: string[];
    chunkBuffers: Buffer[] = [];
    chunkSize: number = 0;
    chunksCreated: number = 0;
    onChunkReady: (chunkPath: string) => Promise<void>;

    constructor(headers: string[], onChunkReady: (chunkPath: string) => Promise<void>) {
        super({ objectMode: true });
        this.headers = headers;
        this.onChunkReady = onChunkReady;

        // Push header row first
        this.push(headers.join(",") + "\n");
    }

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

    async flushChunk(): Promise<string> {
        this.chunksCreated++;
        const chunkData = Buffer.concat(this.chunkBuffers, this.chunkSize);
        this.chunkBuffers = [];
        this.chunkSize = 0;

        // Compress chunk
        const compressedData = zlib.gzipSync(chunkData);

        // Write chunk to temp file
        const chunkFileName = `chunk_${uuidv4()}.csv.gz`;
        const chunkFilePath = path.join("/tmp", chunkFileName);
        await fs.writeFile(chunkFilePath, compressedData);

        logToFile("mssql2", `Created chunk #${this.chunksCreated}: ${chunkFilePath}`);

        return chunkFilePath;
    }
}

async function uploadChunkToSnowflakeStage(conn: Connection, stageName: string, chunkPath: string) {
    const fileName = path.basename(chunkPath);
    logToFile("mssql2", `Uploading ${fileName} to Snowflake stage ${stageName}`);

    // Using snowsql CLI for PUT (since SDK lacks direct PUT)
    const putCmd = `PUT file://${chunkPath} @${stageName} AUTO_COMPRESS=TRUE`;
    try {
        conn.execute({
            sqlText: putCmd,
            complete: function (err, stmt, rows) { }
        });
        await fs.unlink(chunkPath);
        logToFile("mssql2", `Uploaded and deleted local chunk file ${fileName}`);
    } catch (error: any) {
        logToFile("mssql2", `ERROR uploading chunk ${fileName}: ${error.message || error}`);
        throw error;
    }
}

async function streamTableToChunks(tableName: string, stageName: string, conn: Connection | null) {
    const pool = await connect();
    const request = pool.request();
    request.stream = true;

    // Get column headers
    const columnsResult = await pool.request().query(`SELECT * FROM ${tableName} WHERE 1=0`);
    const headers = Object.keys(columnsResult.recordset.columns);

    return new Promise<void>((resolve, reject) => {
        const csvChunker = new CsvChunker(headers, async (chunkPath) => {
            if (!conn) throw new Error("Snowflake connection not initialized");
            await uploadChunkToSnowflakeStage(conn, stageName, chunkPath);
        });

        request.query(`SELECT * FROM ${tableName}`);

        request.on("row", row => {
            csvChunker.write(row);
        });

        request.on("error", async err => {
            logToFile("mssql2", `ERROR streaming table ${tableName}: ${err.message || err}`);
            reject(err);
        });

        request.on("done", () => {
            csvChunker.end();
            csvChunker.on("finish", () => {
                logToFile("mssql2", `Finished streaming table ${tableName}`);
                resolve();
            });
        });
    });
}

export async function getAllDataIntoSnowflakeTwo() {
    try {
        const sfConnection = await initDbConnection(true);

        const tables = await getAllTables();
        logToFile("mssql2", `Starting migration of ${tables.length} tables`);

        for (const { TABLE_SCHEMA, TABLE_NAME } of tables) {
            const fullTableName = `[${TABLE_SCHEMA}].[${TABLE_NAME}]`;
            const snowflakeStage = "your_snowflake_stage";

            logToFile("mssql2", `Starting streaming migration of ${fullTableName} to Snowflake stage ${snowflakeStage}`);
            await streamTableToChunks(fullTableName, snowflakeStage, sfConnection);
            logToFile("mssql2", `Finished streaming migration of ${fullTableName}`);
        }

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
