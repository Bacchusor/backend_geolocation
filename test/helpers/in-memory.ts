import type { Coordinates } from "../../src/domain/coordinates.js";
import { haversineDistanceM } from "../../src/domain/coordinates.js";
import type { GeofenceEvent } from "../../src/domain/geofence.js";
import type { GeocodeResult } from "../../src/domain/geocoding.js";
import type { LocationFix, UserLocation } from "../../src/domain/location.js";
import type { NearbyPlace, Place } from "../../src/domain/place.js";
import type { Clock, Geocoder, GeofenceEventRepository, LocationRepository, PlaceRepository } from "../../src/domain/ports.js";

export class FakeClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(d: Date): void {
    this.current = d;
  }
}

export class InMemoryLocationRepository implements LocationRepository {
  current = new Map<string, UserLocation>();
  history = new Map<string, LocationFix[]>();

  async getCurrent(userId: string): Promise<UserLocation | null> {
    return this.current.get(userId) ?? null;
  }
  async saveCurrentAndHistory(userId: string, current: LocationFix, history: LocationFix[]): Promise<UserLocation> {
    const saved: UserLocation = { userId, ...current, updatedAt: new Date() };
    this.current.set(userId, saved);
    await this.appendHistory(userId, history);
    return saved;
  }
  async appendHistory(userId: string, fixes: LocationFix[]): Promise<void> {
    this.history.set(userId, [...(this.history.get(userId) ?? []), ...fixes]);
  }
  async listHistory(userId: string, limit: number): Promise<LocationFix[]> {
    return [...(this.history.get(userId) ?? [])]
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
      .slice(0, limit);
  }
  async deleteAllForUser(userId: string): Promise<void> {
    this.current.delete(userId);
    this.history.delete(userId);
  }
  async purgeHistoryOlderThan(cutoff: Date): Promise<number> {
    let deleted = 0;
    for (const [uid, fixes] of this.history) {
      const kept = fixes.filter((f) => f.recordedAt >= cutoff);
      deleted += fixes.length - kept.length;
      this.history.set(uid, kept);
    }
    return deleted;
  }
}

export class InMemoryPlaceRepository implements PlaceRepository {
  constructor(public places: Place[] = []) {}
  async findNearby(center: Coordinates, radiusM: number, limit: number, offset: number): Promise<NearbyPlace[]> {
    return this.places
      .map((p) => ({ ...p, distanceM: haversineDistanceM(center, p.position) }))
      .filter((p) => p.distanceM <= radiusM)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(offset, offset + limit);
  }
}

export class InMemoryGeofenceEventRepository implements GeofenceEventRepository {
  events: GeofenceEvent[] = [];
  async saveMany(events: GeofenceEvent[]): Promise<void> {
    this.events.push(...events);
  }
  async listForUser(userId: string, limit: number): Promise<GeofenceEvent[]> {
    return this.events.filter((e) => e.userId === userId).slice(0, limit);
  }
  async deleteAllForUser(userId: string): Promise<void> {
    this.events = this.events.filter((e) => e.userId !== userId);
  }
}

export class StubGeocoder implements Geocoder {
  readonly name = "stub";
  calls = 0;
  failWith: Error | null = null;
  constructor(private readonly result: GeocodeResult) {}
  async forward(): Promise<GeocodeResult[]> {
    this.calls += 1;
    if (this.failWith) throw this.failWith;
    return [this.result];
  }
  async reverse(): Promise<GeocodeResult | null> {
    this.calls += 1;
    if (this.failWith) throw this.failWith;
    return this.result;
  }
}
