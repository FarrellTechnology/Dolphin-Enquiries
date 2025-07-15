import snowflake, { FileAndStageBindStatement, RowStatement } from 'snowflake-sdk';
import { logToFile, settings } from './';

/** Snowflake connection object */
export let connection: snowflake.Connection | null = null;
let dolphinConnection: boolean = false;
let config: any = null;

/**
 * Initializes a Snowflake database connection.
 * 
 * This function checks if the connection already exists and is appropriate for the requested `isDolphinData` flag. 
 * If no valid connection exists, it establishes a new connection using the provided Snowflake configuration.
 * 
 * @param {boolean} isDolphinData - Flag to indicate whether the connection is for Dolphin data or not. Default is false.
 * @returns {Promise<snowflake.Connection | null>} - A promise that resolves to the Snowflake connection or null.
 * @throws {Error} - If the Snowflake configuration is missing.
 */
export async function initDbConnection(isDolphinData: boolean = false): Promise<snowflake.Connection | null> {
  // Check if the existing connection matches the requested flag (isDolphinData)
  if (connection && dolphinConnection == isDolphinData) return connection;

  config = await settings.getSnowflakeConfig();

  // Set the dolphinConnection flag based on the function parameter
  if (isDolphinData) {
    dolphinConnection = true;
  } else {
    dolphinConnection = false;
  }

  // Throw an error if the configuration is missing
  if (!config) throw new Error('Snowflake config is missing');

  // Create a new Snowflake connection with the provided configuration
  const conn = snowflake.createConnection({
    account: config.account,
    username: config.username,
    password: config.password,
    authenticator: 'PROGRAMMATIC_ACCESS_TOKEN',
    warehouse: config.warehouse,
    database: !isDolphinData ? config.database : 'DOLPHINDATA',
    schema: config.schema,
    role: config.role,
  });

  // Establish the connection and resolve it
  connection = await new Promise<snowflake.Connection>((resolve, reject) => {
    conn.connect((err, connectedConn) => {
      if (err) {
        logToFile("snowflake", `Failed to connect to Snowflake: ${err.message || err}`);
        reject(err);
      } else {
        logToFile("snowflake", `Connected to Snowflake: ${config.account}`);
        resolve(connectedConn);
      }
    });
  });

  return connection;
}

/**
 * Executes a SQL query on the provided Snowflake connection.
 * 
 * This function executes the provided SQL statement with optional parameter bindings.
 * If the connection is terminated, it will attempt to reconnect and retry the query.
 * 
 * @param {snowflake.Connection | null} conn - The Snowflake connection object to execute the query on.
 * @param {string} sql - The SQL query string to execute.
 * @param {any[]} [binds=[]] - An optional array of bind variables for the SQL query.
 * @param {boolean} [retry=true] - Flag indicating whether to retry the query in case of a terminated connection. Default is true.
 * @returns {Promise<any[]>} - A promise that resolves with the query result as an array of rows.
 * @throws {Error} - If the query fails after retrying.
 */
export async function query(conn: snowflake.Connection | null, sql: string, binds: any[] = [], retry = true): Promise<any[]> {
  // If no connection is provided, return an empty array
  if (!conn) return [];

  return new Promise((resolve, reject) => {
    // Execute the SQL query
    conn.execute({
      sqlText: sql,
      binds,
      complete: async (err, stmt, rows) => {
        if (err) {
          const isTerminated = /terminated connection/i.test(err.message);
          if (isTerminated) {
            logToFile("snowflake", 'Snowflake connection was terminated. Retrying...');
            connection = null;

            if (retry) {
              try {
                // Reconnect and retry the query
                const newConn = await initDbConnection();
                const result = await query(newConn, sql, binds, false);
                return resolve(result);
              } catch (retryErr) {
                logToFile("snowflake", `Error reconnecting to Snowflake: ${typeof retryErr === 'object' && retryErr !== null && 'message' in retryErr ? (retryErr as { message?: string }).message : retryErr}`);
                return reject(retryErr);
              }
            }
          }
          logToFile("snowflake", `Error executing query: ${err.message || err}`);
          return reject(err);
        } else {
          logToFile("snowflake", `Query executed successfully: ${sql}`);
          resolve(rows || []);
        }
      },
    });
  });
}
