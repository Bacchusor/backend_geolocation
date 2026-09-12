import type { Coordinates } from "../../domain/coordinates.js";
import { ProviderUnavailableError } from "../../domain/errors.js";
import type { GeocodeResult } from "../../domain/geocoding.js";
import type { Geocoder } from "../../domain/ports.js";
import { CircuitBreaker, type CircuitBreakerOptions } from "./circuit-breaker.js";

/** Wraps any Geocoder with a circuit breaker and normalises upstream failures. */
export class ResilientGeocoder implements Geocoder {
  readonly name: string;
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly inner: Geocoder,
    opts: CircuitBreakerOptions = { failureThreshold: 5, resetTimeoutMs: 30_000 },
  ) {
    this.name = inner.name;
    this.breaker = new CircuitBreaker(inner.name, opts);
  }

  forward(query: string, limit: number): Promise<GeocodeResult[]> {
    return this.guard(() => this.inner.forward(query, limit));
  }

  reverse(position: Coordinates): Promise<GeocodeResult | null> {
    return this.guard(() => this.inner.reverse(position));
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.breaker.call(fn);
    } catch (err) {
      if (err instanceof ProviderUnavailableError) throw err;
      throw new ProviderUnavailableError(`${this.name}: ${(err as Error).message}`);
    }
  }
}
