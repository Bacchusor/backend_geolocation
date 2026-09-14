export interface GeocodeResult {
  display_name: string;
  lat: number;
  lng: number;
  type: string;
  importance: number;
}

/**
 * Nominatim forward geocoding used by the admin map's address search.
 * Respects the usage policy: identifying User-Agent, max 1 request/second, results cached.
 */
export class NominatimClient {
  private lastRequestAt = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly cache = new Map<string, { at: number; results: GeocodeResult[] }>();

  constructor(
    private readonly baseUrl: string,
    private readonly userAgent: string,
    private readonly cacheTtlMs = 24 * 3_600_000,
  ) {}

  async search(query: string, limit = 5): Promise<GeocodeResult[]> {
    const key = `${query.trim().toLowerCase()}|${limit}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.cacheTtlMs) return hit.results;
    const results = await this.throttled(async () => {
      const url = new URL('/search', this.baseUrl);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('q', query);
      url.searchParams.set('limit', String(limit));
      const res = await fetch(url, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Nominatim ${res.status}`);
      const rows = (await res.json()) as Array<{
        display_name: string;
        lat: string;
        lon: string;
        type: string;
        importance?: number;
      }>;
      return rows.map((r) => ({
        display_name: r.display_name,
        lat: Number(r.lat),
        lng: Number(r.lon),
        type: r.type,
        importance: r.importance ?? 0,
      }));
    });
    this.cache.set(key, { at: Date.now(), results });
    if (this.cache.size > 1000) this.cache.delete(this.cache.keys().next().value as string);
    return results;
  }

  private throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = Math.max(0, this.lastRequestAt + 1100 - Date.now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
      return fn();
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
