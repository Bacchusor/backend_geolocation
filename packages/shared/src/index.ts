import { z } from 'zod';

// ---------- Primitives ----------
export const latSchema = z.number().min(-90).max(90);
export const lngSchema = z.number().min(-180).max(180);
export const accuracySchema = z.number().min(0).max(100_000);
export const personSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_.-]+$/i, 'person must be a short identifier (letters, digits, _ . -)');
export const timeHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #RRGGBB');

export const TRIGGERS = ['approach', 'enter', 'exit', 'dwell'] as const;
export const triggerSchema = z.enum(TRIGGERS);
export type Trigger = z.infer<typeof triggerSchema>;

export const CHANNEL_TYPES = ['home_assistant', 'fcm'] as const;
export const channelTypeSchema = z.enum(CHANNEL_TYPES);
export type ChannelType = z.infer<typeof channelTypeSchema>;

export const EVENT_OUTCOMES = ['notified', 'skipped', 'failed', 'transition', 'ignored'] as const;
export const eventOutcomeSchema = z.enum(EVENT_OUTCOMES);
export type EventOutcome = z.infer<typeof eventOutcomeSchema>;

export const idSchema = z.uuid();
export const isoDate = z.iso.datetime({ offset: true });

// ---------- Places ----------
export const placeInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    lat: latSchema,
    lng: lngSchema,
    enter_radius_m: z.number().int().min(10).max(5000).default(100),
    approach_radius_m: z.number().int().min(10).max(20_000).default(500),
    dwell_seconds: z.number().int().min(0).max(86_400).default(120),
    icon: z.string().trim().max(64).default('mdi:cart'),
    color: hexColor.default('#2563eb'),
    active: z.boolean().default(true),
    notion_shop: z.string().trim().max(120).nullable().default(null),
    notion_categories: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    notion_min_items: z.number().int().min(1).max(1000).default(1),
    message_template: z.string().max(500).default('{count} items to buy'),
    group_by_category: z.boolean().default(false),
    notion_url: z.url().max(2000).nullable().default(null),
  })
  .refine((p) => p.approach_radius_m >= p.enter_radius_m, {
    message: 'approach_radius_m must be >= enter_radius_m',
    path: ['approach_radius_m'],
  });
export type PlaceInput = z.infer<typeof placeInputSchema>;

export const placeSchema = z.object({
  id: idSchema,
  name: z.string(),
  lat: latSchema,
  lng: lngSchema,
  enter_radius_m: z.number().int(),
  approach_radius_m: z.number().int(),
  dwell_seconds: z.number().int(),
  icon: z.string(),
  color: z.string(),
  active: z.boolean(),
  notion_shop: z.string().nullable(),
  notion_categories: z.array(z.string()),
  notion_min_items: z.number().int(),
  message_template: z.string(),
  group_by_category: z.boolean(),
  notion_url: z.string().nullable(),
  ha_zone_id: z.string().nullable(),
  ha_zone_entity_id: z.string().nullable(),
  ha_zone_synced_at: isoDate.nullable(),
  ha_zone_error: z.string().nullable(),
  created_at: isoDate,
  updated_at: isoDate,
});
export type Place = z.infer<typeof placeSchema>;

// ---------- Place groups ----------
export const placeGroupInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  place_ids: z.array(idSchema).max(500).default([]),
});
export type PlaceGroupInput = z.infer<typeof placeGroupInputSchema>;
export const placeGroupSchema = z.object({
  id: idSchema,
  name: z.string(),
  place_ids: z.array(idSchema),
  created_at: isoDate,
  updated_at: isoDate,
});
export type PlaceGroup = z.infer<typeof placeGroupSchema>;

// ---------- Rules ----------
export const ruleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    place_id: idSchema.nullable().default(null),
    place_group_id: idSchema.nullable().default(null),
    trigger: triggerSchema,
    recipient_ids: z.array(idSchema).max(100).default([]),
    window_start: timeHHMM.nullable().default(null),
    window_end: timeHHMM.nullable().default(null),
    days_of_week: z.array(z.number().int().min(0).max(6)).max(7).default([0, 1, 2, 3, 4, 5, 6]),
    cooldown_seconds: z
      .number()
      .int()
      .min(0)
      .max(7 * 86_400)
      .default(3600),
    max_per_day: z.number().int().min(0).max(1000).default(5),
    enabled: z.boolean().default(true),
  })
  .refine((r) => (r.place_id === null) !== (r.place_group_id === null), {
    message: 'exactly one of place_id or place_group_id is required',
    path: ['place_id'],
  })
  .refine((r) => (r.window_start === null) === (r.window_end === null), {
    message: 'window_start and window_end must be set together',
    path: ['window_end'],
  });
export type RuleInput = z.infer<typeof ruleInputSchema>;
export const ruleSchema = z.object({
  id: idSchema,
  name: z.string(),
  place_id: idSchema.nullable(),
  place_group_id: idSchema.nullable(),
  trigger: triggerSchema,
  recipient_ids: z.array(idSchema),
  window_start: z.string().nullable(),
  window_end: z.string().nullable(),
  days_of_week: z.array(z.number().int()),
  cooldown_seconds: z.number().int(),
  max_per_day: z.number().int(),
  enabled: z.boolean(),
  created_at: isoDate,
  updated_at: isoDate,
});
export type Rule = z.infer<typeof ruleSchema>;

// ---------- Channels & recipients ----------
export const homeAssistantChannelConfigInput = z.object({
  base_url: z.url().max(500),
  token: z.string().min(1).max(2000).optional(),
});
export const fcmChannelConfigInput = z.object({
  project_id: z.string().max(200).optional(),
  service_account_json: z.string().max(20_000).optional(),
});
export const channelInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: channelTypeSchema,
  config: z.union([homeAssistantChannelConfigInput, fcmChannelConfigInput]),
});
export type ChannelInput = z.infer<typeof channelInputSchema>;
export const channelSchema = z.object({
  id: idSchema,
  name: z.string(),
  type: channelTypeSchema,
  config: z.record(z.string(), z.unknown()),
  secret_set: z.boolean(),
  last_test_at: isoDate.nullable(),
  last_test_ok: z.boolean().nullable(),
  last_test_error: z.string().nullable(),
  created_at: isoDate,
  updated_at: isoDate,
});
export type Channel = z.infer<typeof channelSchema>;

export const recipientInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  person: personSchema,
  channel_id: idSchema,
  target: z.string().trim().min(1).max(200),
  active: z.boolean().default(true),
});
export type RecipientInput = z.infer<typeof recipientInputSchema>;
export const recipientSchema = z.object({
  id: idSchema,
  name: z.string(),
  person: z.string(),
  channel_id: idSchema,
  target: z.string(),
  active: z.boolean(),
  created_at: isoDate,
  updated_at: isoDate,
});
export type Recipient = z.infer<typeof recipientSchema>;

// ---------- Notion ----------
export const notionPropertyMappingSchema = z.object({
  title: z.string().trim().min(1).max(100).default('Name'),
  needed: z.string().trim().min(1).max(100).default('Needed'),
  needed_means_true: z.boolean().default(true),
  shop: z.string().trim().min(1).max(100).default('Shop'),
  category: z.string().trim().min(1).max(100).default('Category'),
});
export type NotionPropertyMapping = z.infer<typeof notionPropertyMappingSchema>;
export const DEFAULT_NOTION_MAPPING: NotionPropertyMapping = {
  title: 'Name',
  needed: 'Needed',
  needed_means_true: true,
  shop: 'Shop',
  category: 'Category',
};
export const notionConfigInputSchema = z.object({
  token: z.string().min(1).max(500).optional(),
  database_id: z.string().trim().min(1).max(100).nullable().default(null),
  mapping: notionPropertyMappingSchema.default(DEFAULT_NOTION_MAPPING),
  sync_interval_seconds: z.number().int().min(60).max(86_400).default(300),
  enabled: z.boolean().default(false),
});
export type NotionConfigInput = z.infer<typeof notionConfigInputSchema>;
export const notionConfigSchema = z.object({
  token_set: z.boolean(),
  database_id: z.string().nullable(),
  mapping: notionPropertyMappingSchema,
  sync_interval_seconds: z.number().int(),
  enabled: z.boolean(),
  last_sync_at: isoDate.nullable(),
  last_sync_ok: z.boolean().nullable(),
  last_sync_error: z.string().nullable(),
  item_count: z.number().int(),
  updated_at: isoDate.nullable(),
});
export type NotionConfig = z.infer<typeof notionConfigSchema>;

export const notionItemSchema = z.object({
  page_id: z.string(),
  name: z.string(),
  shop: z.string().nullable(),
  category: z.string().nullable(),
  needed: z.boolean(),
  url: z.string().nullable(),
  last_edited_at: isoDate.nullable(),
  synced_at: isoDate,
});
export type NotionItem = z.infer<typeof notionItemSchema>;

export const notionSchemaInfoSchema = z.object({
  database_title: z.string(),
  data_source_id: z.string(),
  properties: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      options: z.array(z.string()).optional(),
    }),
  ),
  shop_options: z.array(z.string()),
  category_options: z.array(z.string()),
});
export type NotionSchemaInfo = z.infer<typeof notionSchemaInfoSchema>;

export const notionConsistencySchema = z.object({
  shops_without_place: z.array(z.string()),
  places_with_missing_shop: z.array(
    z.object({ place_id: idSchema, name: z.string(), shop: z.string() }),
  ),
  checked_at: isoDate,
  error: z.string().nullable(),
});
export type NotionConsistency = z.infer<typeof notionConsistencySchema>;

// ---------- Location ingestion ----------
export const locationFixSchema = z.object({
  person: personSchema,
  lat: latSchema,
  lng: lngSchema,
  accuracy_m: accuracySchema.default(0),
  recorded_at: isoDate,
});
export type LocationFix = z.infer<typeof locationFixSchema>;
export const locationBodySchema = z.union([
  locationFixSchema,
  z.array(locationFixSchema).min(1).max(100),
]);

export const geofenceEventSchema = z
  .object({
    person: personSchema,
    /** Either the GeoReminder place id … */
    place_id: idSchema.optional(),
    /** … or the Home Assistant zone entity id (e.g. `zone.gr_lidl_titan`) or zone/place name. */
    zone: z.string().trim().min(1).max(200).optional(),
    transition: z.enum(['enter', 'exit']),
    recorded_at: isoDate,
    lat: latSchema.optional(),
    lng: lngSchema.optional(),
    accuracy_m: accuracySchema.optional(),
  })
  .refine((e) => !!e.place_id || !!e.zone, {
    message: 'place_id or zone is required',
    path: ['place_id'],
  });
export type GeofenceEvent = z.infer<typeof geofenceEventSchema>;
export const geofenceBodySchema = z.union([
  geofenceEventSchema,
  z.array(geofenceEventSchema).min(1).max(100),
]);

export const personLocationSchema = z.object({
  person: z.string(),
  lat: z.number(),
  lng: z.number(),
  accuracy_m: z.number().nullable(),
  recorded_at: isoDate,
  updated_at: isoDate,
});
export type PersonLocation = z.infer<typeof personLocationSchema>;

// ---------- Nearby ----------
export const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().positive().max(50_000).default(2000),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const nearbyPlaceSchema = placeSchema.extend({ distance_m: z.number() });

// ---------- Events ----------
export const ruleEventSchema = z.object({
  id: z.number().int(),
  created_at: isoDate,
  person: z.string(),
  place_id: idSchema.nullable(),
  place_name: z.string().nullable(),
  rule_id: idSchema.nullable(),
  rule_name: z.string().nullable(),
  trigger: triggerSchema.nullable(),
  outcome: eventOutcomeSchema,
  reason: z.string(),
  distance_m: z.number().nullable(),
  matched_items: z.array(z.string()),
  delivery: z.record(z.string(), z.unknown()).nullable(),
  source: z.string(),
});
export type RuleEvent = z.infer<typeof ruleEventSchema>;
export const eventsQuerySchema = z.object({
  person: personSchema.optional(),
  place: idSchema.optional(),
  rule: idSchema.optional(),
  outcome: eventOutcomeSchema.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before_id: z.coerce.number().int().positive().optional(),
});

// ---------- Misc ----------
export const okSchema = z.object({ ok: z.literal(true) });
export const errorSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});
export const ingestResultSchema = z.object({
  accepted: z.number().int(),
  ignored: z.number().int(),
  results: z.array(
    z.object({
      person: z.string(),
      status: z.enum(['accepted', 'ignored', 'rate_limited']),
      reason: z.string().optional(),
      notifications: z.number().int().optional(),
    }),
  ),
});
export type IngestResult = z.infer<typeof ingestResultSchema>;

/** Round a coordinate for logs / exposure (3 decimals ≈ 100 m). */
export const roundCoord = (v: number, decimals = 3): number => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

// ---------- Users / profiles ----------
export const ROLES = ['admin', 'member'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const usernameSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9_.-]+$/i, 'username must be letters, digits, _ . -');
export const passwordSchema = z.string().min(8).max(200);

export const userPreferencesSchema = z.object({
  /** UI theme applied at login ('system' keeps the OS/browser choice). */
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  language: z.enum(['en', 'fr', 'ro']).default('en'),
  /** Master switch: when false no rule notifies this user's person. */
  notifications_enabled: z.boolean().default(true),
  /** Free-form per-app settings (the calendar app can keep its own keys here). */
  apps: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: 'system',
  language: 'en',
  notifications_enabled: true,
  apps: {},
};

export const userSchema = z.object({
  id: idSchema,
  username: z.string(),
  display_name: z.string(),
  role: roleSchema,
  person: z.string().nullable(),
  preferences: userPreferencesSchema,
  active: z.boolean(),
  last_login_at: isoDate.nullable(),
  created_at: isoDate,
  updated_at: isoDate,
});
export type User = z.infer<typeof userSchema>;

/** Admin: create a user (password required) or update one (password optional = keep). */
export const userInputSchema = z.object({
  username: usernameSchema,
  display_name: z.string().trim().min(1).max(120),
  role: roleSchema.default('member'),
  person: personSchema.nullable().default(null),
  preferences: userPreferencesSchema.default(DEFAULT_USER_PREFERENCES),
  active: z.boolean().default(true),
  password: passwordSchema.optional(),
});
export type UserInput = z.infer<typeof userInputSchema>;

/** Self-service: what a user may change on their own profile. */
export const profileUpdateSchema = z.object({
  display_name: z.string().trim().min(1).max(120),
  preferences: userPreferencesSchema,
});
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const passwordChangeSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: passwordSchema,
});
