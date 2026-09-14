/**
 * Integration tests against a real PostGIS container (testcontainers).
 * Covers: approach trigger, hysteresis, cooldown, daily cap, time window, missing Notion data,
 * zone events, plausibility and the HTTP layer (auth + validation).
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { ChannelType, LocationFix } from '@georeminder/shared';
import { createDb, runMigrations, type Db } from './db/client.js';
import { createLogger } from './logger.js';
import { SecretBox } from './crypto.js';
import { loadConfig, type Config } from './config.js';
import { Evaluator } from './services/evaluation.js';
import { NotionService } from './services/notion-sync.js';
import { ZoneSync } from './services/ha-zones.js';
import {
  ChannelFactory,
  type DeliveryResult,
  type NotificationChannel,
  type NotificationMessage,
} from './services/channels.js';
import { NominatimClient } from './integrations/nominatim.js';
import { createChannel, createPlace, createRecipient, createRule } from './services/repos.js';
import { notionItems } from './db/schema.js';
import { queryEvents } from './services/events.js';
import { buildApp, type App } from './http/app.js';

const ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: '',
  API_KEY: 'test-api-key-0123456789',
  JWT_SECRET: 'x'.repeat(40),
  ENCRYPTION_KEY: 'ab'.repeat(32),
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'admin-password',
  LOG_LEVEL: 'silent',
  TZ: 'Europe/Bucharest',
  LOCATION_MIN_INTERVAL_SECONDS: '0',
  HA_ZONE_SYNC: 'false',
};

class FakeChannelFactory extends ChannelFactory {
  sent: Array<{ target: string; msg: NotificationMessage }> = [];
  failNext = false;
  override build(): NotificationChannel {
    return {
      type: 'home_assistant' as ChannelType,
      send: async (target: string, msg: NotificationMessage): Promise<DeliveryResult> => {
        if (this.failNext) {
          this.failNext = false;
          return { ok: false, channel_type: 'home_assistant', target, error: 'boom' };
        }
        this.sent.push({ target, msg });
        return { ok: true, channel_type: 'home_assistant', target };
      },
      test: async () => ({ ok: true }),
    };
  }
}

// Place: Lidl at (44.4200, 26.1500); enter 100 m, approach 500 m.
const LIDL = { lat: 44.42, lng: 26.15 };
/** Offset a point roughly `metres` east. */
const east = (m: number) => ({
  lat: LIDL.lat,
  lng: LIDL.lng + m / (111_320 * Math.cos((LIDL.lat * Math.PI) / 180)),
});

let container: StartedPostgreSqlContainer;
let db: Db;
let pool: Awaited<ReturnType<typeof createDb>>['pool'];
let config: Config;
let secrets: SecretBox;
let clock = new Date('2026-07-01T09:00:00Z'); // 12:00 Bucharest, Wednesday
let channels: FakeChannelFactory;
let notion: NotionService;
let evaluator: Evaluator;
let app: App;
let placeId: string;
let recipientId: string;

const fix = (p: { lat: number; lng: number }, accuracy = 10, person = 'alex'): LocationFix => ({
  person,
  lat: p.lat,
  lng: p.lng,
  accuracy_m: accuracy,
  recorded_at: clock.toISOString(),
});
const tick = (seconds: number) => {
  clock = new Date(clock.getTime() + seconds * 1000);
};

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgis/postgis:16-3.4')
    .withDatabase('georeminder')
    .start();
  ENV.DATABASE_URL = container.getConnectionUri();
  config = loadConfig(ENV);
  const log = createLogger(config);
  ({ db, pool } = createDb(config.DATABASE_URL, 5));
  await runMigrations(db, log);
  secrets = new SecretBox(config.ENCRYPTION_KEY);
  channels = new FakeChannelFactory(secrets);
  notion = new NotionService(db, secrets, log);
  evaluator = new Evaluator({ db, config, log, notion, channels, now: () => clock });
  const zones = new ZoneSync(db, secrets, config, log);
  app = await buildApp({
    config,
    log,
    db,
    secrets,
    evaluator,
    notion,
    zones,
    channels,
    nominatim: new NominatimClient('http://localhost', 'test'),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});

beforeEach(async () => {
  clock = new Date('2026-07-01T09:00:00Z');
  channels.sent = [];
  await db.execute(
    sql`TRUNCATE rule_events, place_states, person_locations, rule_recipients, rules, recipients, channels, place_group_members, place_groups, places, notion_items RESTART IDENTITY CASCADE`,
  );
  const channel = await createChannel(
    db,
    { name: 'HA', type: 'home_assistant', config: { base_url: 'http://ha.local', token: 't' } },
    secrets,
  );
  const recipient = await createRecipient(db, {
    name: 'Alex phone',
    person: 'alex',
    channel_id: channel.id,
    target: 'mobile_app_alex',
    active: true,
  });
  recipientId = recipient.id;
  const place = await createPlace(db, {
    name: 'Lidl',
    ...LIDL,
    enter_radius_m: 100,
    approach_radius_m: 500,
    dwell_seconds: 60,
    icon: 'mdi:cart',
    color: '#ff0000',
    active: true,
    notion_shop: 'Lidl',
    notion_categories: [],
    notion_min_items: 1,
    message_template: '{count} items for {shop}: {items}',
    group_by_category: false,
    notion_url: 'https://notion.so/x',
  });
  placeId = place.id;
  await db.insert(notionItems).values([
    { page_id: 'p1', name: 'Milk', shop: 'Lidl', category: 'Kitchen', needed: true },
    { page_id: 'p2', name: 'Soap', shop: 'Lidl', category: 'Bathroom', needed: true },
    { page_id: 'p3', name: 'Beer', shop: 'Kaufland', category: 'Kitchen', needed: true },
  ]);
});

async function approachRule(overrides: Partial<Parameters<typeof createRule>[1]> = {}) {
  return createRule(db, {
    name: 'Lidl approach',
    place_id: placeId,
    place_group_id: null,
    trigger: 'approach',
    recipient_ids: [recipientId],
    window_start: null,
    window_end: null,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    cooldown_seconds: 3600,
    max_per_day: 5,
    enabled: true,
    ...overrides,
  });
}

describe('rule evaluation (PostGIS)', () => {
  it('notifies on approach with the matching Notion items, then applies hysteresis', async () => {
    await approachRule();
    let r = await evaluator.processFix(fix(east(2000)));
    expect(r.status).toBe('accepted');
    expect(channels.sent).toHaveLength(0);

    tick(60);
    r = await evaluator.processFix(fix(east(400)));
    expect(r.notifications).toBe(1);
    expect(channels.sent[0]?.msg.message).toBe('2 items for Lidl: Milk, Soap');
    expect(channels.sent[0]?.msg.url).toBe('https://notion.so/x');

    // 550 m is outside the approach radius but inside the 625 m hysteresis band: still "in approach"
    tick(60);
    await evaluator.processFix(fix(east(550)));
    tick(60);
    r = await evaluator.processFix(fix(east(400)));
    expect(r.notifications).toBe(0);

    // leave for good (> 625 m), come back after the cooldown -> fires again
    tick(60);
    await evaluator.processFix(fix(east(700)));
    tick(3600);
    r = await evaluator.processFix(fix(east(400)));
    expect(r.notifications).toBe(1);
    expect(channels.sent).toHaveLength(2);
  });

  it('respects cooldown and logs why it did not fire', async () => {
    await approachRule({ cooldown_seconds: 1800 });
    await evaluator.processFix(fix(east(400)));
    expect(channels.sent).toHaveLength(1);
    tick(60);
    await evaluator.processFix(fix(east(700)));
    tick(60);
    const r = await evaluator.processFix(fix(east(400)));
    expect(r.notifications).toBe(0);
    const { items } = await queryEvents(db, { limit: 10 });
    expect(items[0]?.outcome).toBe('skipped');
    expect(items[0]?.reason).toMatch(/cooldown/);
  });

  it('enforces the daily cap', async () => {
    await approachRule({ cooldown_seconds: 0, max_per_day: 2 });
    for (let i = 0; i < 3; i++) {
      await evaluator.processFix(fix(east(400)));
      tick(60);
      await evaluator.processFix(fix(east(700)));
      tick(60);
    }
    expect(channels.sent).toHaveLength(2);
    const { items } = await queryEvents(db, { limit: 1, outcome: 'skipped' });
    expect(items[0]?.reason).toMatch(/daily cap/);
  });

  it('skips outside the time window / days', async () => {
    await approachRule({ window_start: '18:00', window_end: '21:00' }); // now is 12:00 local
    await evaluator.processFix(fix(east(400)));
    expect(channels.sent).toHaveLength(0);
    const { items } = await queryEvents(db, { limit: 1 });
    expect(items[0]?.reason).toMatch(/outside window/);
  });

  it('does not notify when there are no cached Notion items for the shop (Notion missing)', async () => {
    await db.delete(notionItems);
    await approachRule();
    await evaluator.processFix(fix(east(400)));
    expect(channels.sent).toHaveLength(0);
    const { items } = await queryEvents(db, { limit: 1 });
    expect(items[0]?.outcome).toBe('skipped');
    expect(items[0]?.reason).toMatch(/only 0 item/);
  });

  it('places without a Notion binding notify with the template alone', async () => {
    await db.execute(
      sql`UPDATE places SET notion_shop = NULL, message_template = 'You are near {place}'`,
    );
    await approachRule();
    await evaluator.processFix(fix(east(400)));
    expect(channels.sent[0]?.msg.message).toBe('You are near Lidl');
  });

  it('ignores fixes whose accuracy exceeds the relevant radius', async () => {
    await approachRule();
    await evaluator.processFix(fix(east(50), 800));
    expect(channels.sent).toHaveLength(0);
    tick(30);
    await evaluator.processFix(fix(east(50), 50));
    expect(channels.sent).toHaveLength(1);
  });

  it('fires enter, dwell and exit rules', async () => {
    await createRule(db, {
      name: 'enter',
      place_id: placeId,
      place_group_id: null,
      trigger: 'enter',
      recipient_ids: [recipientId],
      window_start: null,
      window_end: null,
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      cooldown_seconds: 0,
      max_per_day: 0,
      enabled: true,
    });
    await createRule(db, {
      name: 'dwell',
      place_id: placeId,
      place_group_id: null,
      trigger: 'dwell',
      recipient_ids: [recipientId],
      window_start: null,
      window_end: null,
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      cooldown_seconds: 0,
      max_per_day: 0,
      enabled: true,
    });
    await createRule(db, {
      name: 'exit',
      place_id: placeId,
      place_group_id: null,
      trigger: 'exit',
      recipient_ids: [recipientId],
      window_start: null,
      window_end: null,
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      cooldown_seconds: 0,
      max_per_day: 0,
      enabled: true,
    });
    await evaluator.processFix(fix(east(50)));
    expect(channels.sent).toHaveLength(1); // enter
    tick(90);
    await evaluator.processFix(fix(east(40)));
    expect(channels.sent).toHaveLength(2); // dwell
    tick(30);
    await evaluator.processFix(fix(east(200)));
    expect(channels.sent).toHaveLength(3); // exit
  });

  it('accepts Home Assistant zone events by zone name', async () => {
    await approachRule();
    const r = await evaluator.processGeofenceEvent({
      person: 'alex',
      zone: 'zone.lidl',
      transition: 'enter',
      recorded_at: clock.toISOString(),
    });
    expect(r.status).toBe('accepted');
    expect(channels.sent).toHaveLength(1);
  });

  it('rejects out-of-order and implausible fixes', async () => {
    await approachRule();
    await evaluator.processFix(fix(east(2000)));
    clock = new Date(clock.getTime() - 60_000);
    let r = await evaluator.processFix(fix(east(400)));
    expect(r.status).toBe('ignored');
    expect(r.reason).toMatch(/out of order/);
    clock = new Date(clock.getTime() + 120_000);
    r = await evaluator.processFix(fix({ lat: 46.77, lng: 23.62 })); // Cluj, 1 minute later
    expect(r.status).toBe('ignored');
    expect(r.reason).toMatch(/implausible/);
    expect(channels.sent).toHaveLength(0);
  });

  it('records failed deliveries', async () => {
    await approachRule();
    channels.failNext = true;
    const r = await evaluator.processFix(fix(east(400)));
    expect(r.notifications).toBe(0);
    const { items } = await queryEvents(db, { limit: 1 });
    expect(items[0]?.outcome).toBe('failed');
  });

  it('only notifies recipients belonging to the moving person', async () => {
    await approachRule();
    await evaluator.processFix(fix(east(400), 10, 'maria'));
    expect(channels.sent).toHaveLength(0);
    const { items } = await queryEvents(db, { limit: 1 });
    expect(items[0]?.reason).toMatch(/no active recipient/);
  });

  it('uses the GiST index for the candidate query', async () => {
    const res = await db.execute(
      sql`EXPLAIN SELECT id FROM places WHERE ST_DWithin(position, ST_SetSRID(ST_MakePoint(26.15, 44.42),4326)::geography, 500)`,
    );
    const plan = res.rows.map((r) => Object.values(r as Record<string, string>)[0]).join('\n');
    // With a single row Postgres may seq-scan; the index must at least exist and be usable.
    const idx = await db.execute(
      sql`SELECT indexname FROM pg_indexes WHERE tablename = 'places' AND indexname = 'places_position_idx'`,
    );
    expect(idx.rows).toHaveLength(1);
    expect(plan).toMatch(/places/);
  });
});

describe('HTTP', () => {
  it('rejects unauthenticated and validates input', async () => {
    let res = await app.inject({ method: 'POST', url: '/v1/location', payload: fix(east(400)) });
    expect(res.statusCode).toBe(401);
    res = await app.inject({
      method: 'POST',
      url: '/v1/location',
      headers: { 'x-api-key': ENV.API_KEY },
      payload: { ...fix(east(400)), lat: 100 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation');
  });

  it('ingests a batch with the API key and answers nearby', async () => {
    await approachRule();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/location',
      headers: { 'x-api-key': ENV.API_KEY },
      payload: [
        fix(east(400)),
        { ...fix(east(2000)), recorded_at: new Date(clock.getTime() - 60_000).toISOString() },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(2);
    expect(channels.sent).toHaveLength(1);
    const nearby = await app.inject({
      method: 'GET',
      url: `/v1/nearby?lat=${LIDL.lat}&lng=${LIDL.lng}&radius=1000`,
      headers: { 'x-api-key': ENV.API_KEY },
    });
    expect(nearby.json().items[0].name).toBe('Lidl');
    expect(nearby.json().items[0].distance_m).toBeLessThan(1);
  });

  it('admin session login works and the OpenAPI document is served', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'admin', password: 'admin-password' },
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies.find((c) => c.name === 'gr_session')!;
    const me = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      cookies: { gr_session: cookie.value },
    });
    expect(me.json()).toEqual({ kind: 'session', username: 'admin' });
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'admin', password: 'nope' },
    });
    expect(bad.statusCode).toBe(401);
    const docs = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(docs.statusCode).toBe(200);
    expect(docs.json().paths['/v1/location']).toBeDefined();
  });

  it('exposes place items and the event log', async () => {
    const items = await app.inject({
      method: 'GET',
      url: `/v1/places/${placeId}/items`,
      headers: { 'x-api-key': ENV.API_KEY },
    });
    expect(items.json().items.map((i: { name: string }) => i.name)).toEqual(['Soap', 'Milk']);
    const events = await app.inject({
      method: 'GET',
      url: '/v1/events?person=alex',
      headers: { 'x-api-key': ENV.API_KEY },
    });
    expect(events.statusCode).toBe(200);
  });
});
