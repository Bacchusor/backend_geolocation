import type {
  Channel,
  ChannelInput,
  NotionConfig,
  NotionConfigInput,
  NotionConsistency,
  NotionItem,
  NotionSchemaInfo,
  PersonLocation,
  Place,
  PlaceGroup,
  PlaceGroupInput,
  PlaceInput,
  Recipient,
  RecipientInput,
  Rule,
  RuleEvent,
  RuleInput,
} from '@georeminder/shared';

/** The admin is served behind nginx which proxies /api -> API container (Vite dev does the same). */
const BASE = '/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith('/v1/auth/')) {
    window.dispatchEvent(new CustomEvent('gr:unauthorized'));
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = data as { message?: string; details?: unknown } | null;
    throw new ApiError(res.status, err?.message ?? `HTTP ${res.status}`, err?.details);
  }
  return data as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body);
const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body);
const del = <T>(path: string) => request<T>('DELETE', path);

type List<T> = { items: T[] };

export const api = {
  auth: {
    login: (username: string, password: string) =>
      post<{ ok: true; username: string }>('/v1/auth/login', { username, password }),
    logout: () => post<{ ok: true }>('/v1/auth/logout'),
    me: () => get<{ kind: 'api_key' | 'session'; username: string | null }>('/v1/auth/me'),
  },
  places: {
    list: () => get<List<Place>>('/v1/places'),
    create: (input: PlaceInput) => post<Place>('/v1/places', input),
    update: (id: string, input: PlaceInput) => put<Place>(`/v1/places/${id}`, input),
    remove: (id: string) => del<{ ok: true }>(`/v1/places/${id}`),
    items: (id: string) => get<List<NotionItem>>(`/v1/places/${id}/items`),
    zoneSync: (id: string) => post<Place>(`/v1/places/${id}/zone-sync`),
  },
  groups: {
    list: () => get<List<PlaceGroup>>('/v1/place-groups'),
    create: (input: PlaceGroupInput) => post<PlaceGroup>('/v1/place-groups', input),
    update: (id: string, input: PlaceGroupInput) =>
      put<PlaceGroup>(`/v1/place-groups/${id}`, input),
    remove: (id: string) => del<{ ok: true }>(`/v1/place-groups/${id}`),
  },
  rules: {
    list: () => get<List<Rule>>('/v1/rules'),
    create: (input: RuleInput) => post<Rule>('/v1/rules', input),
    update: (id: string, input: RuleInput) => put<Rule>(`/v1/rules/${id}`, input),
    remove: (id: string) => del<{ ok: true }>(`/v1/rules/${id}`),
  },
  recipients: {
    list: () => get<List<Recipient>>('/v1/recipients'),
    create: (input: RecipientInput) => post<Recipient>('/v1/recipients', input),
    update: (id: string, input: RecipientInput) => put<Recipient>(`/v1/recipients/${id}`, input),
    remove: (id: string) => del<{ ok: true }>(`/v1/recipients/${id}`),
  },
  channels: {
    list: () => get<List<Channel>>('/v1/channels'),
    create: (input: ChannelInput) => post<Channel>('/v1/channels', input),
    update: (id: string, input: ChannelInput) => put<Channel>(`/v1/channels/${id}`, input),
    remove: (id: string) => del<{ ok: true }>(`/v1/channels/${id}`),
    test: (id: string) =>
      post<{ ok: boolean; message?: string; error?: string }>(`/v1/channels/${id}/test`),
    targets: (id: string) => get<List<string>>(`/v1/channels/${id}/targets`),
    sendTest: (id: string, target: string) =>
      post<{ ok: boolean; error?: string }>(`/v1/channels/${id}/send-test`, { target }),
  },
  notion: {
    config: () => get<NotionConfig>('/v1/notion/config'),
    save: (input: NotionConfigInput) => put<NotionConfig>('/v1/notion/config', input),
    test: () =>
      post<{ ok: boolean; user?: string; database_title?: string; error?: string }>(
        '/v1/notion/test',
      ),
    schema: () => get<NotionSchemaInfo>('/v1/notion/schema'),
    sync: () => post<{ ok: boolean; items: number; error?: string }>('/v1/notion/sync'),
    items: () => get<List<NotionItem>>('/v1/notion/items'),
    consistency: () => get<NotionConsistency>('/v1/notion/consistency'),
  },
  events: {
    list: (params: Record<string, string | number | undefined>) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params))
        if (v !== undefined && v !== '') qs.set(k, String(v));
      return get<{ items: RuleEvent[]; next_before_id: number | null }>(
        `/v1/events?${qs.toString()}`,
      );
    },
  },
  persons: {
    list: () => get<List<PersonLocation>>('/v1/persons'),
    erase: (person: string) =>
      del<{ ok: true; events_deleted: number }>(
        `/v1/location?person=${encodeURIComponent(person)}`,
      ),
  },
  geocode: (q: string) =>
    get<List<{ display_name: string; lat: number; lng: number }>>(
      `/v1/geocode/search?q=${encodeURIComponent(q)}`,
    ),
  ha: {
    syncZones: () =>
      post<{
        synced: number;
        removed: number;
        errors: Array<{ place_id: string; error: string }>;
        warning: string | null;
      }>('/v1/ha/zones/sync'),
  },
};
