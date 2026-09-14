import WebSocket from 'ws';

export interface HaZone {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  icon?: string | null;
  passive?: boolean;
}

export interface HaZoneInput {
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  icon?: string;
  passive?: boolean;
}

export interface HaNotifyPayload {
  title?: string;
  message: string;
  data?: Record<string, unknown>;
}

export class HaError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'HaError';
  }
}

/** Home Assistant slugify (approximation of homeassistant.util.slugify for ASCII/Latin names). */
export function haSlugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Thin Home Assistant client: REST for notifications/services, WebSocket for zone management
 * (zones are a config collection; the REST states API cannot create persistent zones).
 */
export class HomeAssistantClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 10_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async rest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HaError(
        `HA ${init.method ?? 'GET'} ${path} -> ${res.status} ${text.slice(0, 200)}`,
        res.status,
      );
    }
    const ct = res.headers.get('content-type') ?? '';
    return (ct.includes('json') ? await res.json() : await res.text()) as T;
  }

  /** GET /api/ returns {"message": "API running."} when the token is valid. */
  async test(): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
    try {
      const r = await this.rest<{ message: string }>('/api/');
      return { ok: true, message: r.message };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** notify.* services available (mobile_app_<phone> for Companion app devices). */
  async listNotifyServices(): Promise<string[]> {
    const domains =
      await this.rest<Array<{ domain: string; services: Record<string, unknown> }>>(
        '/api/services',
      );
    const notify = domains.find((d) => d.domain === 'notify');
    return notify ? Object.keys(notify.services).sort() : [];
  }

  async notify(service: string, payload: HaNotifyPayload): Promise<void> {
    const svc = service.replace(/^notify\./, '');
    await this.rest(`/api/services/notify/${encodeURIComponent(svc)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // ---------- Zones over WebSocket ----------

  private async ws<T>(commands: Array<Record<string, unknown>>): Promise<T[]> {
    const url = this.baseUrl.replace(/^http/, 'ws') + '/api/websocket';
    return new Promise<T[]>((resolve, reject) => {
      const socket = new WebSocket(url, { handshakeTimeout: this.timeoutMs });
      const results: T[] = [];
      let nextId = 1;
      let idx = 0;
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new HaError('HA websocket timeout'));
      }, this.timeoutMs * 2);
      const finish = (err?: Error) => {
        clearTimeout(timer);
        socket.close();
        if (err) reject(err);
        else resolve(results);
      };
      const sendNext = () => {
        const cmd = commands[idx];
        if (!cmd) return finish();
        socket.send(JSON.stringify({ id: nextId++, ...cmd }));
      };
      socket.on('error', (e) => finish(new HaError(`HA websocket error: ${e.message}`)));
      socket.on('message', (raw) => {
        let msg: {
          type: string;
          success?: boolean;
          result?: T;
          error?: { code: string; message: string };
        };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return finish(new HaError('HA websocket: invalid JSON'));
        }
        switch (msg.type) {
          case 'auth_required':
            socket.send(JSON.stringify({ type: 'auth', access_token: this.token }));
            break;
          case 'auth_ok':
            sendNext();
            break;
          case 'auth_invalid':
            finish(new HaError('HA websocket: auth invalid', 401));
            break;
          case 'result':
            if (msg.success) {
              results.push(msg.result as T);
              idx += 1;
              sendNext();
            } else {
              finish(
                new HaError(
                  `HA ${String(commands[idx]?.type)}: ${msg.error?.code} ${msg.error?.message}`,
                ),
              );
            }
            break;
          default:
            break;
        }
      });
    });
  }

  async listZones(): Promise<HaZone[]> {
    const [zones] = await this.ws<HaZone[]>([{ type: 'zone/list' }]);
    return zones ?? [];
  }

  async createZone(input: HaZoneInput): Promise<HaZone> {
    const [zone] = await this.ws<HaZone>([{ type: 'zone/create', ...input }]);
    if (!zone) throw new HaError('zone/create returned nothing');
    return zone;
  }

  async updateZone(zoneId: string, input: HaZoneInput): Promise<HaZone> {
    const [zone] = await this.ws<HaZone>([{ type: 'zone/update', zone_id: zoneId, ...input }]);
    if (!zone) throw new HaError('zone/update returned nothing');
    return zone;
  }

  async deleteZone(zoneId: string): Promise<void> {
    await this.ws([{ type: 'zone/delete', zone_id: zoneId }]);
  }
}
