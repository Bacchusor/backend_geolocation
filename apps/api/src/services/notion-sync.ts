import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  DEFAULT_NOTION_MAPPING,
  notionPropertyMappingSchema,
  type NotionConfig,
  type NotionConfigInput,
  type NotionConsistency,
  type NotionItem,
  type NotionPropertyMapping,
  type NotionSchemaInfo,
  type Place,
} from '@georeminder/shared';
import type { Db } from '../db/client.js';
import { notionConfig, notionItems, places } from '../db/schema.js';
import { NotionError, NotionShoppingClient } from '../integrations/notion.js';
import type { SecretBox } from '../crypto.js';
import type { Logger } from '../logger.js';

type ConfigRow = typeof notionConfig.$inferSelect;

const TICK_MS = 30_000;

/**
 * Keeps a local copy of the "needed" shopping items so rule evaluation works when Notion is down.
 * Runs inside the API process on a simple timer (no queue/Redis needed at this scale).
 */
export class NotionService {
  private timer: NodeJS.Timeout | null = null;
  private syncing = false;

  constructor(
    private readonly db: Db,
    private readonly secrets: SecretBox,
    private readonly log: Logger,
  ) {}

  // ---------- config ----------

  private async loadRow(): Promise<ConfigRow | null> {
    const [row] = await this.db.select().from(notionConfig).where(eq(notionConfig.id, 1));
    return row ?? null;
  }

  private mappingOf(row: ConfigRow | null): NotionPropertyMapping {
    const parsed = notionPropertyMappingSchema.safeParse(row?.mapping ?? {});
    return parsed.success ? parsed.data : DEFAULT_NOTION_MAPPING;
  }

  async getConfig(): Promise<NotionConfig> {
    const row = await this.loadRow();
    const [cnt] = await this.db.select({ n: sql<number>`count(*)::int` }).from(notionItems);
    return {
      token_set: !!row?.token_enc,
      database_id: row?.database_id ?? null,
      mapping: this.mappingOf(row),
      sync_interval_seconds: row?.sync_interval_seconds ?? 300,
      enabled: row?.enabled ?? false,
      last_sync_at: row?.last_sync_at?.toISOString() ?? null,
      last_sync_ok: row?.last_sync_ok ?? null,
      last_sync_error: row?.last_sync_error ?? null,
      item_count: Number(cnt?.n ?? 0),
      updated_at: row?.updated_at?.toISOString() ?? null,
    };
  }

  async saveConfig(input: NotionConfigInput): Promise<NotionConfig> {
    const existing = await this.loadRow();
    const values = {
      database_id: input.database_id,
      // data source is re-resolved when the database id changes
      data_source_id:
        existing?.database_id === input.database_id ? (existing?.data_source_id ?? null) : null,
      mapping: input.mapping,
      sync_interval_seconds: input.sync_interval_seconds,
      enabled: input.enabled,
      updated_at: new Date(),
      ...(input.token ? { token_enc: this.secrets.encrypt(input.token) } : {}),
    };
    await this.db
      .insert(notionConfig)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: notionConfig.id, set: values });
    return this.getConfig();
  }

  private clientFor(row: ConfigRow | null): NotionShoppingClient {
    if (!row?.token_enc) throw new NotionError('Notion integration token is not configured');
    return new NotionShoppingClient(this.secrets.decrypt(row.token_enc));
  }

  private async dataSourceId(row: ConfigRow, client: NotionShoppingClient): Promise<string> {
    if (row.data_source_id) return row.data_source_id;
    if (!row.database_id) throw new NotionError('Notion database id is not configured');
    const { data_source_id } = await client.resolveDataSource(row.database_id);
    await this.db.update(notionConfig).set({ data_source_id }).where(eq(notionConfig.id, 1));
    return data_source_id;
  }

  // ---------- operations ----------

  async testConnection(): Promise<{
    ok: boolean;
    error?: string;
    user?: string;
    database_title?: string;
  }> {
    try {
      const row = await this.loadRow();
      const client = this.clientFor(row);
      const me = await client.whoAmI();
      if (!row?.database_id) return { ok: true, user: me.name };
      const { database_title } = await client.resolveDataSource(row.database_id);
      return { ok: true, user: me.name, database_title };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async getSchema(): Promise<NotionSchemaInfo> {
    const row = await this.loadRow();
    if (!row?.database_id) throw new NotionError('Notion database id is not configured');
    const client = this.clientFor(row);
    return client.getSchema(row.database_id, this.mappingOf(row));
  }

  async syncNow(): Promise<{ ok: boolean; items: number; error?: string }> {
    if (this.syncing) return { ok: false, items: 0, error: 'sync already running' };
    this.syncing = true;
    const started = new Date();
    try {
      const row = await this.loadRow();
      const client = this.clientFor(row);
      const dsId = await this.dataSourceId(row!, client);
      const mapping = this.mappingOf(row);
      const items = await client.fetchNeededItems(dsId, mapping);
      await this.db.transaction(async (tx) => {
        const ids = items.map((i) => i.page_id);
        if (ids.length) await tx.delete(notionItems).where(notInArray(notionItems.page_id, ids));
        else await tx.delete(notionItems);
        for (const it of items) {
          const values = {
            name: it.name,
            shop: it.shop,
            category: it.category,
            shops: it.shops,
            categories: it.categories,
            needed: it.needed,
            url: it.url,
            last_edited_at: it.last_edited_at ? new Date(it.last_edited_at) : null,
            synced_at: started,
          };
          await tx
            .insert(notionItems)
            .values({ page_id: it.page_id, ...values })
            .onConflictDoUpdate({ target: notionItems.page_id, set: values });
        }
        await tx
          .update(notionConfig)
          .set({ last_sync_at: started, last_sync_ok: true, last_sync_error: null })
          .where(eq(notionConfig.id, 1));
      });
      this.log.info({ items: items.length, ms: Date.now() - started.getTime() }, 'notion sync ok');
      return { ok: true, items: items.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn({ err: message }, 'notion sync failed (cached items kept)');
      await this.db
        .update(notionConfig)
        .set({ last_sync_at: started, last_sync_ok: false, last_sync_error: message.slice(0, 500) })
        .where(eq(notionConfig.id, 1))
        .catch(() => undefined);
      return { ok: false, items: 0, error: message };
    } finally {
      this.syncing = false;
    }
  }

  async listItems(): Promise<NotionItem[]> {
    const rows = await this.db
      .select()
      .from(notionItems)
      .orderBy(asc(notionItems.shop), asc(notionItems.category), asc(notionItems.name));
    return rows.map(rowToItem);
  }

  /** Cached items relevant to a place: needed, same shop, optionally restricted to categories. */
  async itemsForPlace(
    place: Pick<Place, 'notion_shop' | 'notion_categories'>,
  ): Promise<NotionItem[]> {
    if (!place.notion_shop) return [];
    // An item may belong to several shops / categories (Notion multi-select): match any of them.
    const conds = [
      eq(notionItems.needed, true),
      sql`EXISTS (SELECT 1 FROM unnest(${notionItems.shops}) s WHERE lower(s) = lower(${place.notion_shop}))`,
    ];
    if (place.notion_categories.length) {
      const wanted = place.notion_categories.map((c) => c.toLowerCase());
      conds.push(
        sql`EXISTS (SELECT 1 FROM unnest(${notionItems.categories}) c WHERE ${inArray(sql`lower(c)`, wanted)})`,
      );
    }
    const rows = await this.db
      .select()
      .from(notionItems)
      .where(and(...conds))
      .orderBy(asc(notionItems.category), asc(notionItems.name));
    return rows.map(rowToItem);
  }

  async consistency(): Promise<NotionConsistency> {
    const checked_at = new Date().toISOString();
    const placeRows = await this.db
      .select({ id: places.id, name: places.name, shop: places.notion_shop })
      .from(places);
    try {
      const schema = await this.getSchema();
      const options = new Set(schema.shop_options.map((o) => o.toLowerCase()));
      const bound = new Set(
        placeRows.map((p) => p.shop?.toLowerCase()).filter((s): s is string => !!s),
      );
      return {
        shops_without_place: schema.shop_options.filter((o) => !bound.has(o.toLowerCase())),
        places_with_missing_shop: placeRows
          .filter((p) => p.shop && !options.has(p.shop.toLowerCase()))
          .map((p) => ({ place_id: p.id, name: p.name, shop: p.shop! })),
        checked_at,
        error: null,
      };
    } catch (err) {
      // Fall back to the cached items' shop values when Notion is unreachable.
      const cached = (
        await this.db.execute(
          sql`SELECT DISTINCT s AS shop FROM ${notionItems}, unnest(${notionItems.shops}) s`,
        )
      ).rows as Array<{ shop: string }>;
      const shops = cached.map((c) => c.shop).filter((s): s is string => !!s);
      const bound = new Set(
        placeRows.map((p) => p.shop?.toLowerCase()).filter((s): s is string => !!s),
      );
      // The cache only knows the shops of *needed* items, not the option list, so "missing option"
      // cannot be judged here; only report cached shops that have no place yet.
      return {
        shops_without_place: shops.filter((s) => !bound.has(s.toLowerCase())),
        places_with_missing_shop: [],
        checked_at,
        error: `Notion unreachable (${err instanceof Error ? err.message : String(err)}). Rules keep using the cached items.`,
      };
    }
  }

  // ---------- scheduler ----------

  start(): void {
    if (this.timer) return;
    const tick = async () => {
      try {
        const row = await this.loadRow();
        if (!row?.enabled || !row.token_enc || !row.database_id) return;
        const due =
          !row.last_sync_at ||
          Date.now() - row.last_sync_at.getTime() >= row.sync_interval_seconds * 1000;
        if (due) await this.syncNow();
      } catch (err) {
        this.log.error({ err }, 'notion scheduler tick failed');
      }
    };
    this.timer = setInterval(tick, TICK_MS);
    this.timer.unref();
    void tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

const rowToItem = (r: typeof notionItems.$inferSelect): NotionItem => ({
  page_id: r.page_id,
  name: r.name,
  shop: r.shop,
  category: r.category,
  shops: r.shops,
  categories: r.categories,
  needed: r.needed,
  url: r.url,
  last_edited_at: r.last_edited_at?.toISOString() ?? null,
  synced_at: r.synced_at.toISOString(),
});
