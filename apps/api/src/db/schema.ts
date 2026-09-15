import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { geographyPoint } from './geo.js';

const timestamps = {
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const places = pgTable(
  'places',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    position: geographyPoint('position').notNull(),
    enter_radius_m: integer('enter_radius_m').notNull().default(100),
    approach_radius_m: integer('approach_radius_m').notNull().default(500),
    dwell_seconds: integer('dwell_seconds').notNull().default(120),
    icon: text('icon').notNull().default('mdi:cart'),
    color: text('color').notNull().default('#2563eb'),
    active: boolean('active').notNull().default(true),
    notion_shop: text('notion_shop'),
    notion_categories: text('notion_categories')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notion_min_items: integer('notion_min_items').notNull().default(1),
    message_template: text('message_template').notNull().default('{count} items to buy'),
    group_by_category: boolean('group_by_category').notNull().default(false),
    notion_url: text('notion_url'),
    ha_zone_id: text('ha_zone_id'),
    ha_zone_entity_id: text('ha_zone_entity_id'),
    ha_zone_synced_at: timestamp('ha_zone_synced_at', { withTimezone: true }),
    ha_zone_error: text('ha_zone_error'),
    ...timestamps,
  },
  (t) => [
    index('places_position_idx').using('gist', t.position),
    index('places_active_idx').on(t.active),
  ],
);

export const placeGroups = pgTable('place_groups', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  ...timestamps,
});

export const placeGroupMembers = pgTable(
  'place_group_members',
  {
    group_id: uuid('group_id')
      .notNull()
      .references(() => placeGroups.id, { onDelete: 'cascade' }),
    place_id: uuid('place_id')
      .notNull()
      .references(() => places.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.group_id, t.place_id] }), index('pgm_place_idx').on(t.place_id)],
);

export const channels = pgTable('channels', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  type: text('type').notNull(),
  config: jsonb('config')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  secret_enc: text('secret_enc'),
  last_test_at: timestamp('last_test_at', { withTimezone: true }),
  last_test_ok: boolean('last_test_ok'),
  last_test_error: text('last_test_error'),
  ...timestamps,
});

export const recipients = pgTable(
  'recipients',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    person: text('person').notNull(),
    channel_id: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'restrict' }),
    target: text('target').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('recipients_person_idx').on(t.person)],
);

export const rules = pgTable(
  'rules',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    place_id: uuid('place_id').references(() => places.id, { onDelete: 'cascade' }),
    place_group_id: uuid('place_group_id').references(() => placeGroups.id, {
      onDelete: 'cascade',
    }),
    trigger: text('trigger').notNull(),
    window_start: text('window_start'),
    window_end: text('window_end'),
    days_of_week: integer('days_of_week')
      .array()
      .notNull()
      .default(sql`'{0,1,2,3,4,5,6}'::int[]`),
    cooldown_seconds: integer('cooldown_seconds').notNull().default(3600),
    max_per_day: integer('max_per_day').notNull().default(5),
    enabled: boolean('enabled').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('rules_place_idx').on(t.place_id), index('rules_group_idx').on(t.place_group_id)],
);

export const ruleRecipients = pgTable(
  'rule_recipients',
  {
    rule_id: uuid('rule_id')
      .notNull()
      .references(() => rules.id, { onDelete: 'cascade' }),
    recipient_id: uuid('recipient_id')
      .notNull()
      .references(() => recipients.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.rule_id, t.recipient_id] })],
);

export const notionConfig = pgTable('notion_config', {
  id: integer('id').primaryKey().default(1),
  token_enc: text('token_enc'),
  database_id: text('database_id'),
  data_source_id: text('data_source_id'),
  mapping: jsonb('mapping')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(
      sql`'{"title":"Name","needed":"Needed","needed_means_true":true,"shop":"Shop","category":"Category"}'::jsonb`,
    ),
  sync_interval_seconds: integer('sync_interval_seconds').notNull().default(300),
  enabled: boolean('enabled').notNull().default(false),
  last_sync_at: timestamp('last_sync_at', { withTimezone: true }),
  last_sync_ok: boolean('last_sync_ok'),
  last_sync_error: text('last_sync_error'),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notionItems = pgTable(
  'notion_items',
  {
    page_id: text('page_id').primaryKey(),
    name: text('name').notNull(),
    shop: text('shop'),
    category: text('category'),
    shops: text('shops')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    categories: text('categories')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    needed: boolean('needed').notNull().default(true),
    url: text('url'),
    last_edited_at: timestamp('last_edited_at', { withTimezone: true }),
    synced_at: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notion_items_shop_idx').on(t.shop)],
);

export const personLocations = pgTable('person_locations', {
  person: text('person').primaryKey(),
  position: geographyPoint('position').notNull(),
  accuracy_m: real('accuracy_m'),
  recorded_at: timestamp('recorded_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Per person × place geofence state (hysteresis + dwell tracking). */
export const placeStates = pgTable(
  'place_states',
  {
    person: text('person').notNull(),
    place_id: uuid('place_id')
      .notNull()
      .references(() => places.id, { onDelete: 'cascade' }),
    in_approach: boolean('in_approach').notNull().default(false),
    in_enter: boolean('in_enter').notNull().default(false),
    entered_at: timestamp('entered_at', { withTimezone: true }),
    dwell_notified: boolean('dwell_notified').notNull().default(false),
    last_distance_m: real('last_distance_m'),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.person, t.place_id] })],
);

export const ruleEvents = pgTable(
  'rule_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    person: text('person').notNull(),
    place_id: uuid('place_id').references(() => places.id, { onDelete: 'set null' }),
    place_name: text('place_name'),
    rule_id: uuid('rule_id').references(() => rules.id, { onDelete: 'set null' }),
    rule_name: text('rule_name'),
    trigger: text('trigger'),
    outcome: text('outcome').notNull(),
    reason: text('reason').notNull(),
    distance_m: real('distance_m'),
    matched_items: jsonb('matched_items')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    delivery: jsonb('delivery').$type<Record<string, unknown>>(),
    source: text('source').notNull().default('location'),
  },
  (t) => [
    index('rule_events_created_idx').on(t.created_at),
    index('rule_events_person_created_idx').on(t.person, t.created_at),
    index('rule_events_rule_person_idx').on(t.rule_id, t.person, t.outcome, t.created_at),
  ],
);

/** Admin/member accounts for the admin UI and the future apps. Passwords are scrypt hashes. */
export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    username: text('username').notNull(),
    display_name: text('display_name').notNull(),
    role: text('role').notNull().default('member'),
    password_hash: text('password_hash').notNull(),
    person: text('person'),
    preferences: jsonb('preferences')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    active: boolean('active').notNull().default(true),
    last_login_at: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_username_idx').on(sql`lower(${t.username})`),
    index('users_person_idx').on(t.person),
  ],
);
