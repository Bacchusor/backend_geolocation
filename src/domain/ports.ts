/**
 * Ports: interfaces the application layer depends on. Infrastructure provides
 * the adapters (Postgres, Nominatim, in-memory cache...). Tests use in-memory
 * implementations for unit tests and real PostGIS for integration tests.
 */
import type { Coordinates } from "./coordinates.js";
import type { GeofenceEvent } from "./geofence.js";
import type { GeocodeResult } from "./geocoding.js";
import type { LocationFix, UserLocation } from "./location.js";
import type { NearbyPlace } from "./place.js";

export interface LocationRepository {
  getCurrent(userId: string): Promise<UserLocation | null>;
  /** Replace the current position and append the fixes to history in one transaction. */
  saveCurrentAndHistory(userId: string, current: LocationFix, history: LocationFix[]): Promise<UserLocation>;
  /** Append fixes to history only (fixes that were valid but not the newest). */
  appendHistory(userId: string, fixes: LocationFix[]): Promise<void>;
  listHistory(userId: string, limit: number): Promise<LocationFix[]>;
  deleteAllForUser(userId: string): Promise<void>;
  purgeHistoryOlderThan(cutoff: Date): Promise<number>;
}

export interface PlaceRepository {
  findNearby(center: Coordinates, radiusM: number, limit: number, offset: number): Promise<NearbyPlace[]>;
}

export interface GeofenceEventRepository {
  saveMany(events: GeofenceEvent[]): Promise<void>;
  listForUser(userId: string, limit: number): Promise<GeofenceEvent[]>;
  deleteAllForUser(userId: string): Promise<void>;
}

export interface Geocoder {
  readonly name: string;
  forward(query: string, limit: number): Promise<GeocodeResult[]>;
  reverse(position: Coordinates): Promise<GeocodeResult | null>;
}

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
