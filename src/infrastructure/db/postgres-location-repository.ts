import { coordinates } from "../../domain/coordinates.js";
import type { LocationFix, UserLocation } from "../../domain/location.js";
import type { LocationRepository } from "../../domain/ports.js";
import type { DbPool } from "./pool.js";

interface LocationRow {
  user_id: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  recorded_at: Date;
  updated_at: Date;
}

const CURRENT_COLUMNS =
  "user_id, ST_Y(position::geometry) AS lat, ST_X(position::geometry) AS lng, accuracy_m, recorded_at, updated_at";

function toUserLocation(r: LocationRow): UserLocation {
  return {
    userId: r.user_id,
    position: coordinates(r.lat, r.lng),
    accuracyM: r.accuracy_m,
    recordedAt: r.recorded_at,
    updatedAt: r.updated_at,
  };
}

/** Bulk insert into location_history using unnest so a batch is one round-trip. */
async function insertHistory(
  q: { query: DbPool["query"] },
  userId: string,
  fixes: LocationFix[],
): Promise<void> {
  if (fixes.length === 0) return;
  await q.query(
    `INSERT INTO location_history (user_id, position, accuracy_m, recorded_at)
     SELECT $1::uuid, ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, acc, rec
     FROM unnest($2::float8[], $3::float8[], $4::real[], $5::timestamptz[]) AS t(lng, lat, acc, rec)`,
    [
      userId,
      fixes.map((f) => f.position.lng),
      fixes.map((f) => f.position.lat),
      fixes.map((f) => f.accuracyM),
      fixes.map((f) => f.recordedAt),
    ],
  );
}

export class PostgresLocationRepository implements LocationRepository {
  constructor(private readonly pool: DbPool) {}

  async getCurrent(userId: string): Promise<UserLocation | null> {
    const res = await this.pool.query<LocationRow>(
      `SELECT ${CURRENT_COLUMNS} FROM user_locations WHERE user_id = $1`,
      [userId],
    );
    const row = res.rows[0];
    return row ? toUserLocation(row) : null;
  }

  async saveCurrentAndHistory(userId: string, current: LocationFix, history: LocationFix[]): Promise<UserLocation> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query<LocationRow>(
        `INSERT INTO user_locations (user_id, position, accuracy_m, recorded_at, updated_at)
         VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5, now())
         ON CONFLICT (user_id) DO UPDATE
           SET position = EXCLUDED.position,
               accuracy_m = EXCLUDED.accuracy_m,
               recorded_at = EXCLUDED.recorded_at,
               updated_at = now()
         RETURNING ${CURRENT_COLUMNS}`,
        [userId, current.position.lng, current.position.lat, current.accuracyM, current.recordedAt],
      );
      await insertHistory(client, userId, history);
      await client.query("COMMIT");
      return toUserLocation(res.rows[0]!);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async appendHistory(userId: string, fixes: LocationFix[]): Promise<void> {
    await insertHistory(this.pool, userId, fixes);
  }

  async listHistory(userId: string, limit: number): Promise<LocationFix[]> {
    const res = await this.pool.query<Omit<LocationRow, "user_id" | "updated_at">>(
      `SELECT ST_Y(position::geometry) AS lat, ST_X(position::geometry) AS lng, accuracy_m, recorded_at
       FROM location_history WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT $2`,
      [userId, limit],
    );
    return res.rows.map((r) => ({
      position: coordinates(r.lat, r.lng),
      accuracyM: r.accuracy_m,
      recordedAt: r.recorded_at,
    }));
  }

  async deleteAllForUser(userId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM location_history WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM user_locations WHERE user_id = $1", [userId]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async purgeHistoryOlderThan(cutoff: Date): Promise<number> {
    const res = await this.pool.query("DELETE FROM location_history WHERE recorded_at < $1", [cutoff]);
    return res.rowCount ?? 0;
  }
}
