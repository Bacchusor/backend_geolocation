import { type Coordinates, coordinates, roundCoordinates } from "../domain/coordinates.js";
import { ValidationError } from "../domain/errors.js";
import { type GeocodeResult, normaliseQuery } from "../domain/geocoding.js";
import type { Cache, Geocoder } from "../domain/ports.js";

/**
 * Geocoding with a cache in front of the provider. Cache keys are the
 * normalised query (forward) or the coordinate rounded to 5 decimals ≈ 1 m
 * (reverse), so nearby taps and repeated searches never hit the provider twice.
 */
export class GeocodeService {
  constructor(
    private readonly geocoder: Geocoder,
    private readonly cache: Cache,
    private readonly ttlSeconds: number,
    private readonly maxQueryLength = 200,
  ) {}

  async forward(query: string, limit = 5): Promise<GeocodeResult[]> {
    const q = normaliseQuery(query);
    if (q.length < 2 || q.length > this.maxQueryLength) {
      throw new ValidationError(`q must be between 2 and ${this.maxQueryLength} characters`);
    }
    const key = `geocode:fwd:${limit}:${q}`;
    const cached = await this.cache.get<GeocodeResult[]>(key);
    if (cached) return cached;
    const results = await this.geocoder.forward(q, limit);
    await this.cache.set(key, results, this.ttlSeconds);
    return results;
  }

  async reverse(lat: number, lng: number): Promise<GeocodeResult | null> {
    const pos: Coordinates = roundCoordinates(coordinates(lat, lng), 5);
    const key = `geocode:rev:${pos.lat}:${pos.lng}`;
    const cached = await this.cache.get<GeocodeResult | null>(key);
    if (cached !== undefined) return cached;
    const result = await this.geocoder.reverse(pos);
    await this.cache.set(key, result, this.ttlSeconds);
    return result;
  }
}
