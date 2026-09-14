import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';
import type { Logger } from '../logger.js';

export type Db = NodePgDatabase<typeof schema>;

export function createDb(databaseUrl: string, poolMax = 10): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: poolMax });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/** Wait until the database accepts connections (Postgres restarts once while initialising a fresh volume). */
export async function waitForDb(
  db: Db,
  log?: Logger,
  attempts = 30,
  delayMs = 2000,
): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await db.execute(sql`SELECT 1`);
      return;
    } catch (err) {
      if (i === attempts) throw err;
      log?.warn(
        { attempt: i, err: err instanceof Error ? err.message : String(err) },
        'database not ready, retrying',
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/** Idempotent: drizzle tracks applied migrations in __drizzle_migrations. */
export async function runMigrations(db: Db, log?: Logger): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/db/client.js -> ../../drizzle ; src/db/client.ts -> ../../drizzle
  const migrationsFolder = resolve(here, '..', '..', 'drizzle');
  log?.info({ migrationsFolder }, 'running migrations');
  await migrate(db, { migrationsFolder });
  const [row] = (await db.execute(sql`SELECT PostGIS_Lib_Version() AS v`)).rows as { v: string }[];
  log?.info({ postgis: row?.v }, 'migrations applied');
}

export async function checkDb(db: Db): Promise<{ ok: boolean; postgis?: string; error?: string }> {
  try {
    const res = await db.execute(sql`SELECT PostGIS_Lib_Version() AS v`);
    return { ok: true, postgis: (res.rows[0] as { v: string } | undefined)?.v };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
