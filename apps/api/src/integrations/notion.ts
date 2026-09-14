import { Client } from '@notionhq/client';
import type { NotionPropertyMapping, NotionSchemaInfo } from '@georeminder/shared';

/** Notion API 2025-09-03: databases contain data sources; schema and queries live on the data source. */
const NOTION_VERSION = '2025-09-03';

export interface NotionNeededItem {
  page_id: string;
  name: string;
  shop: string | null;
  category: string | null;
  needed: boolean;
  url: string | null;
  last_edited_at: string | null;
}

interface DatabaseResponse {
  id: string;
  title?: Array<{ plain_text: string }>;
  data_sources?: Array<{ id: string; name: string }>;
}
interface DataSourceResponse {
  id: string;
  properties: Record<
    string,
    { id: string; type: string; select?: { options: Array<{ name: string }> } }
  >;
}
interface PageResponse {
  id: string;
  url?: string;
  last_edited_time?: string;
  properties: Record<string, PropertyValue>;
}
type PropertyValue =
  | { type: 'title'; title: Array<{ plain_text: string }> }
  | { type: 'checkbox'; checkbox: boolean }
  | { type: 'select'; select: { name: string } | null }
  | { type: 'status'; status: { name: string } | null }
  | { type: 'multi_select'; multi_select: Array<{ name: string }> }
  | { type: 'rich_text'; rich_text: Array<{ plain_text: string }> }
  | { type: string };
interface QueryResponse {
  results: PageResponse[];
  has_more: boolean;
  next_cursor: string | null;
}

export class NotionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotionError';
  }
}

export function normalizeDatabaseId(raw: string): string {
  const m = raw.trim().match(/([0-9a-fA-F]{32})/);
  if (m?.[1]) {
    const h = m[1].toLowerCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return raw.trim();
}

export class NotionShoppingClient {
  private readonly client: Client;

  constructor(token: string, timeoutMs = 15_000) {
    this.client = new Client({ auth: token, notionVersion: NOTION_VERSION, timeoutMs });
  }

  private request<T extends object>(
    path: string,
    method: 'get' | 'post' | 'patch',
    body?: Record<string, unknown>,
  ): Promise<T> {
    return this.client.request<T>({ path, method, body }) as Promise<T>;
  }

  async whoAmI(): Promise<{ name: string; type: string }> {
    const me = await this.request<{ name?: string; type?: string }>('users/me', 'get');
    return { name: me.name ?? 'integration', type: me.type ?? 'bot' };
  }

  /** Resolve database -> first data source id (or the id itself if it already is a data source). */
  async resolveDataSource(
    databaseId: string,
  ): Promise<{ data_source_id: string; database_title: string }> {
    const id = normalizeDatabaseId(databaseId);
    try {
      const db = await this.request<DatabaseResponse>(`databases/${id}`, 'get');
      const ds = db.data_sources?.[0];
      if (!ds) throw new NotionError('database has no data sources');
      return {
        data_source_id: ds.id,
        database_title: db.title?.map((t) => t.plain_text).join('') ?? '',
      };
    } catch (err) {
      // Maybe the user pasted a data source id directly.
      const ds = await this.request<DataSourceResponse & { title?: Array<{ plain_text: string }> }>(
        `data_sources/${id}`,
        'get',
      ).catch(() => null);
      if (ds)
        return {
          data_source_id: ds.id,
          database_title: ds.title?.map((t) => t.plain_text).join('') ?? '',
        };
      throw err;
    }
  }

  async getSchema(databaseId: string, mapping: NotionPropertyMapping): Promise<NotionSchemaInfo> {
    const { data_source_id, database_title } = await this.resolveDataSource(databaseId);
    const ds = await this.request<DataSourceResponse>(`data_sources/${data_source_id}`, 'get');
    const properties = Object.entries(ds.properties).map(([name, p]) => ({
      name,
      type: p.type,
      ...(p.select ? { options: p.select.options.map((o) => o.name) } : {}),
    }));
    const options = (prop: string) => properties.find((p) => p.name === prop)?.options ?? [];
    return {
      database_title,
      data_source_id,
      properties,
      shop_options: options(mapping.shop),
      category_options: options(mapping.category),
    };
  }

  /** All items whose "needed" checkbox matches the configured convention. */
  async fetchNeededItems(
    dataSourceId: string,
    mapping: NotionPropertyMapping,
  ): Promise<NotionNeededItem[]> {
    const items: NotionNeededItem[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.request<QueryResponse>(`data_sources/${dataSourceId}/query`, 'post', {
        filter: { property: mapping.needed, checkbox: { equals: mapping.needed_means_true } },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      for (const page of res.results) {
        const item = pageToItem(page, mapping);
        if (item) items.push(item);
      }
      cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined;
    } while (cursor);
    return items;
  }
}

function plainText(v: PropertyValue | undefined): string | null {
  if (!v) return null;
  if (v.type === 'title')
    return (
      (v as { title: Array<{ plain_text: string }> }).title.map((t) => t.plain_text).join('') ||
      null
    );
  if (v.type === 'rich_text')
    return (
      (v as { rich_text: Array<{ plain_text: string }> }).rich_text
        .map((t) => t.plain_text)
        .join('') || null
    );
  if (v.type === 'select') return (v as { select: { name: string } | null }).select?.name ?? null;
  if (v.type === 'status') return (v as { status: { name: string } | null }).status?.name ?? null;
  if (v.type === 'multi_select')
    return (
      (v as { multi_select: Array<{ name: string }> }).multi_select.map((o) => o.name).join(', ') ||
      null
    );
  return null;
}

export function pageToItem(
  page: PageResponse,
  mapping: NotionPropertyMapping,
): NotionNeededItem | null {
  const name = plainText(page.properties[mapping.title]);
  if (!name) return null;
  const neededProp = page.properties[mapping.needed];
  const neededRaw =
    neededProp && neededProp.type === 'checkbox'
      ? (neededProp as { checkbox: boolean }).checkbox
      : mapping.needed_means_true;
  return {
    page_id: page.id,
    name,
    shop: plainText(page.properties[mapping.shop]),
    category: plainText(page.properties[mapping.category]),
    needed: neededRaw === mapping.needed_means_true,
    url: page.url ?? null,
    last_edited_at: page.last_edited_time ?? null,
  };
}
