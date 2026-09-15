import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createDb, runMigrations, waitForDb } from './db/client.js';
import { SecretBox } from './crypto.js';
import { buildApp } from './http/app.js';
import { Evaluator } from './services/evaluation.js';
import { NotionService } from './services/notion-sync.js';
import { ZoneSync } from './services/ha-zones.js';
import { ChannelFactory } from './services/channels.js';
import { NominatimClient } from './integrations/nominatim.js';
import { purgeEvents } from './services/events.js';
import { channels } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { ensureBootstrapAdmin } from './services/users.js';

async function main() {
  const config = loadConfig();
  process.env.TZ = config.TZ;
  const log = createLogger(config);
  const { db, pool } = createDb(config.DATABASE_URL, config.DB_POOL_MAX);

  await waitForDb(db, log);
  if (config.RUN_MIGRATIONS) await runMigrations(db, log);

  await ensureBootstrapAdmin(db, config.ADMIN_USERNAME, config.ADMIN_PASSWORD, log);

  const secrets = new SecretBox(config.ENCRYPTION_KEY);
  const channelFactory = new ChannelFactory(secrets);
  const notion = new NotionService(db, secrets, log);
  const zones = new ZoneSync(db, secrets, config, log);
  const evaluator = new Evaluator({ db, config, log, notion, channels: channelFactory });
  const nominatim = new NominatimClient(config.NOMINATIM_URL, config.NOMINATIM_USER_AGENT);

  // Bootstrap a Home Assistant channel from env on first start so the admin has something to test.
  if (config.HA_URL && config.HA_TOKEN) {
    const [existing] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.type, 'home_assistant'))
      .limit(1);
    if (!existing) {
      await db.insert(channels).values({
        name: 'Home Assistant',
        type: 'home_assistant',
        config: { base_url: config.HA_URL },
        secret_enc: secrets.encrypt(config.HA_TOKEN),
      });
      log.info('created default Home Assistant channel from HA_URL/HA_TOKEN');
    }
  }

  const app = await buildApp({
    config,
    log,
    db,
    secrets,
    evaluator,
    notion,
    zones,
    channels: channelFactory,
    nominatim,
  });

  if (config.NOTION_SYNC_ENABLED) notion.start();
  const retention = setInterval(() => {
    purgeEvents(db, config.EVENT_RETENTION_DAYS)
      .then(
        (n) =>
          n && log.info({ deleted: n, days: config.EVENT_RETENTION_DAYS }, 'purged old events'),
      )
      .catch((err) => log.error({ err }, 'event purge failed'));
  }, config.RETENTION_INTERVAL_MINUTES * 60_000);
  retention.unref();

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    clearInterval(retention);
    notion.stop();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info(
    { port: config.PORT, docs: `${config.PUBLIC_API_URL}/docs`, tz: config.TZ },
    'GeoReminder API started',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
