import { asc, eq, sql } from 'drizzle-orm';
import type { PersonLocation } from '@georeminder/shared';
import type { Db } from '../db/client.js';
import { personLocations, placeStates } from '../db/schema.js';
import { geoPoint } from '../db/geo.js';

export interface CurrentLocation {
  person: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  recorded_at: Date;
}

export async function getCurrentLocation(db: Db, person: string): Promise<CurrentLocation | null> {
  const [row] = await db.select().from(personLocations).where(eq(personLocations.person, person));
  if (!row) return null;
  return {
    person: row.person,
    lat: row.position.lat,
    lng: row.position.lng,
    accuracy_m: row.accuracy_m,
    recorded_at: row.recorded_at,
  };
}

export async function upsertCurrentLocation(
  db: Db,
  fix: { person: string; lat: number; lng: number; accuracy_m: number; recorded_at: Date },
): Promise<void> {
  await db
    .insert(personLocations)
    .values({
      person: fix.person,
      position: { lat: fix.lat, lng: fix.lng },
      accuracy_m: fix.accuracy_m,
      recorded_at: fix.recorded_at,
    })
    .onConflictDoUpdate({
      target: personLocations.person,
      set: {
        position: geoPoint(fix.lat, fix.lng),
        accuracy_m: fix.accuracy_m,
        recorded_at: fix.recorded_at,
        updated_at: new Date(),
      },
    });
}

/** Admin listing: coordinates reduced to 3 decimals (~100 m) — this is enough to see who is where. */
export async function listCurrentLocations(db: Db, decimals = 3): Promise<PersonLocation[]> {
  const f = 10 ** decimals;
  const rows = await db.select().from(personLocations).orderBy(asc(personLocations.person));
  return rows.map((r) => ({
    person: r.person,
    lat: Math.round(r.position.lat * f) / f,
    lng: Math.round(r.position.lng * f) / f,
    accuracy_m: r.accuracy_m,
    recorded_at: r.recorded_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  }));
}

/** GDPR-style erase: current position + geofence states (events are removed by the caller). */
export async function deletePersonLocation(db: Db, person: string): Promise<void> {
  await db.delete(placeStates).where(eq(placeStates.person, person));
  await db.delete(personLocations).where(eq(personLocations.person, person));
}

export async function countPersons(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(personLocations);
  return Number(row?.n ?? 0);
}
