import type { Coordinates } from "./coordinates.js";

export interface Place {
  readonly id: string;
  readonly name: string;
  readonly position: Coordinates;
  readonly metadata: Record<string, unknown>;
}

export interface NearbyPlace extends Place {
  readonly distanceM: number;
}
