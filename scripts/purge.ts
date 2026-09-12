/**
 * Retention job: run on a schedule (cron / k8s CronJob), e.g. daily.
 *   HISTORY_RETENTION_DAYS=30 npm run purge
 */
import { PurgeHistory } from "../src/application/purge-history.js";
import { systemClock } from "../src/domain/ports.js";
import { createPool } from "../src/infrastructure/db/pool.js";
import { PostgresLocationRepository } from "../src/infrastructure/db/postgres-location-repository.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const retentionDays = Number(process.env.HISTORY_RETENTION_DAYS ?? 30);

const pool = createPool(url, process.env.DATABASE_SSL === "true");
try {
  const job = new PurgeHistory(new PostgresLocationRepository(pool), retentionDays, systemClock);
  const { deleted, cutoff } = await job.execute();
  console.log(`purged ${deleted} history rows older than ${cutoff.toISOString()}`);
} finally {
  await pool.end();
}
