import { coordinates } from "../../domain/coordinates.js";
import type { GeofenceEvent, GeofenceEventType } from "../../domain/geofence.js";
import type { GeofenceEventRepository } from "../../domain/ports.js";
import type { DbPool } from "./pool.js";

interface EventRow {
  user_id: string;
  geofence_id: string;
  event_type: GeofenceEventType;
  occurred_at: Date;
  lat: number | null;
  lng: number | null;
}

export class PostgresGeofenceEventRepository implements GeofenceEventRepository {
  constructor(private readonly pool: DbPool) {}

  async saveMany(events: GeofenceEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.pool.query(
      `INSERT INTO geofence_events (user_id, geofence_id, event_type, occurred_at, position)
       SELECT uid, gid, typ, occ,
              CASE WHEN lng IS NULL THEN NULL
                   ELSE ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography END
       FROM unnest($1::uuid[], $2::text[], $3::text[], $4::timestamptz[], $5::float8[], $6::float8[])
            AS t(uid, gid, typ, occ, lng, lat)`,
      [
        events.map((e) => e.userId),
        events.map((e) => e.geofenceId),
        events.map((e) => e.type),
        events.map((e) => e.occurredAt),
        events.map((e) => e.position?.lng ?? null),
        events.map((e) => e.position?.lat ?? null),
      ],
    );
  }

  async listForUser(userId: string, limit: number): Promise<GeofenceEvent[]> {
    const res = await this.pool.query<EventRow>(
      `SELECT user_id, geofence_id, event_type, occurred_at,
              ST_Y(position::geometry) AS lat, ST_X(position::geometry) AS lng
       FROM geofence_events WHERE user_id = $1 ORDER BY occurred_at DESC LIMIT $2`,
      [userId, limit],
    );
    return res.rows.map((r) => ({
      userId: r.user_id,
      geofenceId: r.geofence_id,
      type: r.event_type,
      occurredAt: r.occurred_at,
      position: r.lat !== null && r.lng !== null ? coordinates(r.lat, r.lng) : null,
    }));
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.pool.query("DELETE FROM geofence_events WHERE user_id = $1", [userId]);
  }
}
