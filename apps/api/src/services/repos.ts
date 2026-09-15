import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  Channel,
  ChannelInput,
  Place,
  PlaceGroup,
  PlaceGroupInput,
  PlaceInput,
  Recipient,
  RecipientInput,
  Rule,
  RuleInput,
} from '@georeminder/shared';
import type { Db } from '../db/client.js';
import {
  channels,
  placeGroupMembers,
  placeGroups,
  places,
  recipients,
  ruleRecipients,
  rules,
} from '../db/schema.js';
import { geoPoint } from '../db/geo.js';
import { haSlugify } from '../integrations/home-assistant.js';
import type { SecretBox } from '../crypto.js';

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} not found`);
    this.name = 'NotFoundError';
  }
}
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

// ---------------- Places ----------------

type PlaceRow = typeof places.$inferSelect;

export function rowToPlace(r: PlaceRow): Place {
  return {
    id: r.id,
    name: r.name,
    lat: r.position.lat,
    lng: r.position.lng,
    enter_radius_m: r.enter_radius_m,
    approach_radius_m: r.approach_radius_m,
    dwell_seconds: r.dwell_seconds,
    icon: r.icon,
    color: r.color,
    active: r.active,
    notion_shop: r.notion_shop,
    notion_categories: r.notion_categories,
    notion_min_items: r.notion_min_items,
    message_template: r.message_template,
    group_by_category: r.group_by_category,
    notion_url: r.notion_url,
    ha_zone_id: r.ha_zone_id,
    ha_zone_entity_id: r.ha_zone_entity_id,
    ha_zone_synced_at: iso(r.ha_zone_synced_at),
    ha_zone_error: r.ha_zone_error,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function placeValues(input: PlaceInput) {
  return {
    name: input.name,
    position: { lat: input.lat, lng: input.lng },
    enter_radius_m: input.enter_radius_m,
    approach_radius_m: input.approach_radius_m,
    dwell_seconds: input.dwell_seconds,
    icon: input.icon,
    color: input.color,
    active: input.active,
    notion_shop: input.notion_shop,
    notion_categories: input.notion_categories,
    notion_min_items: input.notion_min_items,
    message_template: input.message_template,
    group_by_category: input.group_by_category,
    notion_url: input.notion_url,
  };
}

export async function listPlaces(db: Db): Promise<Place[]> {
  const rows = await db.select().from(places).orderBy(asc(places.name));
  return rows.map(rowToPlace);
}

export async function getPlace(db: Db, id: string): Promise<Place> {
  const [row] = await db.select().from(places).where(eq(places.id, id));
  if (!row) throw new NotFoundError('place', id);
  return rowToPlace(row);
}

export async function createPlace(db: Db, input: PlaceInput): Promise<Place> {
  const [row] = await db.insert(places).values(placeValues(input)).returning();
  return rowToPlace(row!);
}

export async function updatePlace(db: Db, id: string, input: PlaceInput): Promise<Place> {
  const [row] = await db
    .update(places)
    .set({ ...placeValues(input), updated_at: new Date() })
    .where(eq(places.id, id))
    .returning();
  if (!row) throw new NotFoundError('place', id);
  return rowToPlace(row);
}

export async function deletePlace(db: Db, id: string): Promise<Place> {
  const [row] = await db.delete(places).where(eq(places.id, id)).returning();
  if (!row) throw new NotFoundError('place', id);
  return rowToPlace(row);
}

export async function setPlaceZone(
  db: Db,
  id: string,
  zone: { ha_zone_id: string | null; ha_zone_entity_id: string | null; error: string | null },
): Promise<void> {
  await db
    .update(places)
    .set({
      ha_zone_id: zone.ha_zone_id,
      ha_zone_entity_id: zone.ha_zone_entity_id,
      ha_zone_error: zone.error,
      ha_zone_synced_at: zone.error ? undefined : new Date(),
    })
    .where(eq(places.id, id));
}

/**
 * Resolve a Home Assistant zone reference to a place. Accepts the zone entity id (`zone.gr_lidl`),
 * the zone's friendly name (`GR Lidl`, what a device_tracker state shows), the place name, or the HA zone storage id.
 */
export async function findPlaceByZone(db: Db, zone: string): Promise<Place | null> {
  const z = zone.trim();
  const slug = haSlugify(z.replace(/^zone\./, ''));
  const all = await db.select().from(places);
  const row =
    all.find((p) => p.ha_zone_id === z) ??
    all.find((p) => p.ha_zone_entity_id === `zone.${slug}`) ??
    all.find((p) => haSlugify(p.name) === slug) ??
    all.find(
      (p) =>
        p.ha_zone_entity_id &&
        haSlugify(p.ha_zone_entity_id.replace(/^zone\./, '')).endsWith(`_${slug}`),
    );
  return row ? rowToPlace(row) : null;
}

export interface NearbyPlace extends Place {
  distance_m: number;
}

export async function nearbyPlaces(
  db: Db,
  lat: number,
  lng: number,
  radiusM: number,
  limit: number,
): Promise<NearbyPlace[]> {
  const pt = geoPoint(lat, lng);
  const rows = await db
    .select({
      row: places,
      distance_m: sql<number>`ST_Distance(${places.position}, ${pt})`.as('distance_m'),
    })
    .from(places)
    .where(sql`ST_DWithin(${places.position}, ${pt}, ${radiusM})`)
    .orderBy(sql`distance_m`)
    .limit(limit);
  return rows.map((r) => ({
    ...rowToPlace(r.row),
    distance_m: Math.round(Number(r.distance_m) * 10) / 10,
  }));
}

// ---------------- Place groups ----------------

export async function listGroups(db: Db): Promise<PlaceGroup[]> {
  const groups = await db.select().from(placeGroups).orderBy(asc(placeGroups.name));
  const members = await db.select().from(placeGroupMembers);
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    place_ids: members.filter((m) => m.group_id === g.id).map((m) => m.place_id),
    created_at: g.created_at.toISOString(),
    updated_at: g.updated_at.toISOString(),
  }));
}

export async function getGroup(db: Db, id: string): Promise<PlaceGroup> {
  const g = (await listGroups(db)).find((x) => x.id === id);
  if (!g) throw new NotFoundError('place_group', id);
  return g;
}

async function assertPlacesExist(db: Db, ids: string[]) {
  if (ids.length === 0) return;
  const found = await db.select({ id: places.id }).from(places).where(inArray(places.id, ids));
  const missing = ids.filter((id) => !found.some((f) => f.id === id));
  if (missing.length) throw new NotFoundError('place', missing.join(','));
}

export async function createGroup(db: Db, input: PlaceGroupInput): Promise<PlaceGroup> {
  await assertPlacesExist(db, input.place_ids);
  return db.transaction(async (tx) => {
    const [g] = await tx.insert(placeGroups).values({ name: input.name }).returning();
    if (input.place_ids.length) {
      await tx
        .insert(placeGroupMembers)
        .values(input.place_ids.map((place_id) => ({ group_id: g!.id, place_id })));
    }
    return getGroup(tx as unknown as Db, g!.id);
  });
}

export async function updateGroup(db: Db, id: string, input: PlaceGroupInput): Promise<PlaceGroup> {
  await assertPlacesExist(db, input.place_ids);
  return db.transaction(async (tx) => {
    const [g] = await tx
      .update(placeGroups)
      .set({ name: input.name, updated_at: new Date() })
      .where(eq(placeGroups.id, id))
      .returning();
    if (!g) throw new NotFoundError('place_group', id);
    await tx.delete(placeGroupMembers).where(eq(placeGroupMembers.group_id, id));
    if (input.place_ids.length) {
      await tx
        .insert(placeGroupMembers)
        .values(input.place_ids.map((place_id) => ({ group_id: id, place_id })));
    }
    return getGroup(tx as unknown as Db, id);
  });
}

export async function deleteGroup(db: Db, id: string): Promise<void> {
  const [g] = await db.delete(placeGroups).where(eq(placeGroups.id, id)).returning();
  if (!g) throw new NotFoundError('place_group', id);
}

// ---------------- Channels ----------------

type ChannelRow = typeof channels.$inferSelect;

export function rowToChannel(r: ChannelRow): Channel {
  return {
    id: r.id,
    name: r.name,
    type: r.type as Channel['type'],
    config: r.config as Record<string, unknown>,
    secret_set: r.secret_enc !== null,
    last_test_at: iso(r.last_test_at),
    last_test_ok: r.last_test_ok,
    last_test_error: r.last_test_error,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

/** Split the input config into a public part (stored as JSON) and the secret (encrypted). */
function splitChannelConfig(
  input: ChannelInput,
  secrets: SecretBox,
): { config: Record<string, unknown>; secret_enc?: string } {
  const cfg = { ...(input.config as Record<string, unknown>) };
  let secret: string | undefined;
  if (input.type === 'home_assistant' && typeof cfg.token === 'string' && cfg.token)
    secret = cfg.token;
  if (
    input.type === 'fcm' &&
    typeof cfg.service_account_json === 'string' &&
    cfg.service_account_json
  )
    secret = cfg.service_account_json;
  delete cfg.token;
  delete cfg.service_account_json;
  return { config: cfg, ...(secret ? { secret_enc: secrets.encrypt(secret) } : {}) };
}

export async function listChannels(db: Db): Promise<Channel[]> {
  return (await db.select().from(channels).orderBy(asc(channels.name))).map(rowToChannel);
}

export async function getChannelRow(db: Db, id: string): Promise<ChannelRow> {
  const [row] = await db.select().from(channels).where(eq(channels.id, id));
  if (!row) throw new NotFoundError('channel', id);
  return row;
}

export async function createChannel(
  db: Db,
  input: ChannelInput,
  secrets: SecretBox,
): Promise<Channel> {
  const [row] = await db
    .insert(channels)
    .values({ name: input.name, type: input.type, ...splitChannelConfig(input, secrets) })
    .returning();
  return rowToChannel(row!);
}

export async function updateChannel(
  db: Db,
  id: string,
  input: ChannelInput,
  secrets: SecretBox,
): Promise<Channel> {
  const split = splitChannelConfig(input, secrets);
  const [row] = await db
    .update(channels)
    .set({
      name: input.name,
      type: input.type,
      config: split.config,
      ...(split.secret_enc ? { secret_enc: split.secret_enc } : {}),
      updated_at: new Date(),
    })
    .where(eq(channels.id, id))
    .returning();
  if (!row) throw new NotFoundError('channel', id);
  return rowToChannel(row);
}

export async function deleteChannel(db: Db, id: string): Promise<void> {
  const [used] = await db
    .select({ id: recipients.id })
    .from(recipients)
    .where(eq(recipients.channel_id, id))
    .limit(1);
  if (used) throw new ConflictError('channel is used by recipients');
  const [row] = await db.delete(channels).where(eq(channels.id, id)).returning();
  if (!row) throw new NotFoundError('channel', id);
}

export async function recordChannelTest(
  db: Db,
  id: string,
  ok: boolean,
  error: string | null,
): Promise<void> {
  await db
    .update(channels)
    .set({ last_test_at: new Date(), last_test_ok: ok, last_test_error: error })
    .where(eq(channels.id, id));
}

// ---------------- Recipients ----------------

type RecipientRow = typeof recipients.$inferSelect;
export const rowToRecipient = (r: RecipientRow): Recipient => ({
  id: r.id,
  name: r.name,
  person: r.person,
  channel_id: r.channel_id,
  target: r.target,
  active: r.active,
  created_at: r.created_at.toISOString(),
  updated_at: r.updated_at.toISOString(),
});

export async function listRecipients(db: Db): Promise<Recipient[]> {
  return (
    await db.select().from(recipients).orderBy(asc(recipients.person), asc(recipients.name))
  ).map(rowToRecipient);
}

export async function createRecipient(db: Db, input: RecipientInput): Promise<Recipient> {
  await getChannelRow(db, input.channel_id);
  const [row] = await db.insert(recipients).values(input).returning();
  return rowToRecipient(row!);
}

export async function updateRecipient(
  db: Db,
  id: string,
  input: RecipientInput,
): Promise<Recipient> {
  await getChannelRow(db, input.channel_id);
  const [row] = await db
    .update(recipients)
    .set({ ...input, updated_at: new Date() })
    .where(eq(recipients.id, id))
    .returning();
  if (!row) throw new NotFoundError('recipient', id);
  return rowToRecipient(row);
}

export async function deleteRecipient(db: Db, id: string): Promise<void> {
  const [row] = await db.delete(recipients).where(eq(recipients.id, id)).returning();
  if (!row) throw new NotFoundError('recipient', id);
}

// ---------------- Rules ----------------

type RuleRow = typeof rules.$inferSelect;

function rowToRule(r: RuleRow, recipientIds: string[]): Rule {
  return {
    id: r.id,
    name: r.name,
    place_id: r.place_id,
    place_group_id: r.place_group_id,
    trigger: r.trigger as Rule['trigger'],
    recipient_ids: recipientIds,
    window_start: r.window_start,
    window_end: r.window_end,
    days_of_week: r.days_of_week,
    cooldown_seconds: r.cooldown_seconds,
    max_per_day: r.max_per_day,
    enabled: r.enabled,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

export async function listRules(db: Db): Promise<Rule[]> {
  const rows = await db.select().from(rules).orderBy(asc(rules.name));
  const links = await db.select().from(ruleRecipients);
  return rows.map((r) =>
    rowToRule(
      r,
      links.filter((l) => l.rule_id === r.id).map((l) => l.recipient_id),
    ),
  );
}

export async function getRule(db: Db, id: string): Promise<Rule> {
  const r = (await listRules(db)).find((x) => x.id === id);
  if (!r) throw new NotFoundError('rule', id);
  return r;
}

async function assertRuleRefs(db: Db, input: RuleInput) {
  if (input.place_id) await getPlace(db, input.place_id);
  if (input.place_group_id) await getGroup(db, input.place_group_id);
  if (input.recipient_ids.length) {
    const found = await db
      .select({ id: recipients.id })
      .from(recipients)
      .where(inArray(recipients.id, input.recipient_ids));
    const missing = input.recipient_ids.filter((id) => !found.some((f) => f.id === id));
    if (missing.length) throw new NotFoundError('recipient', missing.join(','));
  }
}

const ruleValues = (input: RuleInput) => ({
  name: input.name,
  place_id: input.place_id,
  place_group_id: input.place_group_id,
  trigger: input.trigger,
  window_start: input.window_start,
  window_end: input.window_end,
  days_of_week: input.days_of_week,
  cooldown_seconds: input.cooldown_seconds,
  max_per_day: input.max_per_day,
  enabled: input.enabled,
});

export async function createRule(db: Db, input: RuleInput): Promise<Rule> {
  await assertRuleRefs(db, input);
  return db.transaction(async (tx) => {
    const [r] = await tx.insert(rules).values(ruleValues(input)).returning();
    if (input.recipient_ids.length) {
      await tx
        .insert(ruleRecipients)
        .values(input.recipient_ids.map((recipient_id) => ({ rule_id: r!.id, recipient_id })));
    }
    return rowToRule(r!, input.recipient_ids);
  });
}

export async function updateRule(db: Db, id: string, input: RuleInput): Promise<Rule> {
  await assertRuleRefs(db, input);
  return db.transaction(async (tx) => {
    const [r] = await tx
      .update(rules)
      .set({ ...ruleValues(input), updated_at: new Date() })
      .where(eq(rules.id, id))
      .returning();
    if (!r) throw new NotFoundError('rule', id);
    await tx.delete(ruleRecipients).where(eq(ruleRecipients.rule_id, id));
    if (input.recipient_ids.length) {
      await tx
        .insert(ruleRecipients)
        .values(input.recipient_ids.map((recipient_id) => ({ rule_id: id, recipient_id })));
    }
    return rowToRule(r, input.recipient_ids);
  });
}

export async function deleteRule(db: Db, id: string): Promise<void> {
  const [r] = await db.delete(rules).where(eq(rules.id, id)).returning();
  if (!r) throw new NotFoundError('rule', id);
}

/** Enabled rules that apply to a place (directly or through a group) for a given trigger, with their recipients. */
export interface ApplicableRule extends Rule {
  recipients: Array<Recipient & { channel: ChannelRow }>;
}

export async function rulesForPlace(
  db: Db,
  placeId: string,
  trigger: string,
): Promise<ApplicableRule[]> {
  const groupIds = (
    await db
      .select({ g: placeGroupMembers.group_id })
      .from(placeGroupMembers)
      .where(eq(placeGroupMembers.place_id, placeId))
  ).map((x) => x.g);
  const rows = await db
    .select()
    .from(rules)
    .where(
      and(
        eq(rules.enabled, true),
        eq(rules.trigger, trigger),
        groupIds.length
          ? sql`(${rules.place_id} = ${placeId} OR ${rules.place_group_id} = ANY(${groupIds}))`
          : eq(rules.place_id, placeId),
      ),
    )
    .orderBy(desc(rules.created_at));
  if (rows.length === 0) return [];
  const links = await db
    .select({ rule_id: ruleRecipients.rule_id, recipient: recipients, channel: channels })
    .from(ruleRecipients)
    .innerJoin(recipients, eq(recipients.id, ruleRecipients.recipient_id))
    .innerJoin(channels, eq(channels.id, recipients.channel_id))
    .where(
      inArray(
        ruleRecipients.rule_id,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((r) => {
    const mine = links.filter((l) => l.rule_id === r.id);
    return {
      ...rowToRule(
        r,
        mine.map((l) => l.recipient.id),
      ),
      recipients: mine.map((l) => ({ ...rowToRecipient(l.recipient), channel: l.channel })),
    };
  });
}
