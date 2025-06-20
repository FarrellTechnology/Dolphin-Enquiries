import snowflake from 'snowflake-sdk';
import { settings } from './';

export let connection: snowflake.Connection | null = null;
let dolphinConnection: boolean = false;
let config: any = null;

export async function initDbConnection(isDolphinData: boolean = false) {
  if (connection && dolphinConnection == isDolphinData) return connection;

  config = await settings.getSnowflakeConfig();

  if (isDolphinData) {
    dolphinConnection = true;
  } else {
    dolphinConnection = false;
  }

  if (!config) throw new Error('Snowflake config is missing');

  const conn = snowflake.createConnection({
    account: config.account,
    username: config.username,
    password: config.password,
    warehouse: config.warehouse,
    database: !isDolphinData ? config.database : 'DOLPHINDATA',
    schema: config.schema,
    role: config.role,
  });

  connection = await new Promise<snowflake.Connection>((resolve, reject) => {
    conn.connect((err, connectedConn) => {
      if (err) reject(err);
      else resolve(connectedConn);
    });
  });

  return connection;
}

export async function query(conn: snowflake.Connection, sql: string, binds: any[] = [], retry = true): Promise<any[]> {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      binds,
      complete: async (err, stmt, rows) => {
        if (err) {
          const isTerminated = /terminated connection/i.test(err.message);
          if (isTerminated) {
            console.warn('Snowflake connection was terminated.');
            connection = null;

            if (retry) {
              console.warn('Reconnecting and retrying...');
              try {
                const newConn = await initDbConnection();
                const result = await query(newConn, sql, binds, false);
                return resolve(result);
              } catch (retryErr) {
                return reject(retryErr);
              }
            }
          }
          return reject(err);
        } else {
          resolve(rows || []);
        }
      },
    });
  });
}
