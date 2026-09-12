import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { DbPool } from "./pool.js";

/**
 * Minimal versioned migration runner. Files are `NNN_name.up.sql` /
 * `NNN_name.down.sql`; applied versions are tracked in `schema_migrations`.
 */
export async function migrateUp(pool: DbPool, dir: string): Promise<string[]> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".up.sql")).sort();
  const applied = new Set(
    (await pool.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map((r) => r.version),
  );
  const done: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.up\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
      await client.query("COMMIT");
      done.push(version);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  return done;
}

export async function migrateDown(pool: DbPool, dir: string): Promise<string | null> {
  const last = await pool.query<{ version: string }>(
    "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
  );
  const version = last.rows[0]?.version;
  if (!version) return null;
  const sql = await readFile(path.join(dir, `${version}.down.sql`), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("DELETE FROM schema_migrations WHERE version = $1", [version]);
    await client.query("COMMIT");
    return version;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
