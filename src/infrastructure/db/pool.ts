import pg from "pg";

export type DbPool = pg.Pool;

export function createPool(connectionString: string, ssl: boolean): DbPool {
  return new pg.Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: true } : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Guard against a runaway query holding a connection.
    statement_timeout: 10_000,
  });
}
