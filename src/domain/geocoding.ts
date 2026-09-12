import type { Coordinates } from "./coordinates.js";

export interface GeocodeResult {
  readonly label: string;
  readonly position: Coordinates;
  /** Provider that produced the result, for attribution and debugging. */
  readonly provider: string;
}

/** Normalise a free-text query so equivalent inputs share a cache key. */
export function normaliseQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}
