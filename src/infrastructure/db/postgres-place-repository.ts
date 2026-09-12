import { type Coordinates, coordinates } from "../../domain/coordinates.js";
import type { NearbyPlace } from "../../domain/place.js";
import type { PlaceRepository } from "../../domain/ports.js";
import type { DbPool } from "./pool.js";

interface PlaceRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  metadata: Record<string, unknown>;
  distance_m: number;
}

export class PostgresPlaceRepository implements PlaceRepository {
  constructor(private readonly pool: DbPool) {}

  /**
   * ST_DWithin in WHERE uses the GiST index; ST_Distance is only computed for
   * the candidate rows to order them. Longitude comes first in ST_MakePoint.
   */
  async findNearby(center: Coordinates, radiusM: number, limit: number, offset: number): Promise<NearbyPlace[]> {
    const res = await this.pool.query<PlaceRow>(
      `SELECT id, name, metadata,
              ST_Y(position::geometry) AS lat,
              ST_X(position::geometry) AS lng,
              ST_Distance(position, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m
       FROM places
       WHERE ST_DWithin(position, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
       ORDER BY distance_m ASC, id ASC
       LIMIT $4 OFFSET $5`,
      [center.lng, center.lat, radiusM, limit, offset],
    );
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      position: coordinates(r.lat, r.lng),
      metadata: r.metadata,
      distanceM: Math.round(Number(r.distance_m) * 10) / 10,
    }));
  }
}
