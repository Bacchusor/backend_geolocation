import { type Coordinates, coordinates } from "../domain/coordinates.js";
import { ValidationError } from "../domain/errors.js";
import type { NearbyPlace } from "../domain/place.js";
import type { PlaceRepository } from "../domain/ports.js";

export interface FindNearbyQuery {
  lat: number;
  lng: number;
  radiusM: number;
  limit?: number | undefined;
  offset?: number | undefined;
}

export class FindNearby {
  constructor(
    private readonly places: PlaceRepository,
    private readonly maxRadiusM: number,
    private readonly maxLimit = 50,
  ) {}

  async execute(q: FindNearbyQuery): Promise<{ center: Coordinates; radiusM: number; results: NearbyPlace[] }> {
    const center = coordinates(q.lat, q.lng);
    if (!(Number.isFinite(q.radiusM) && q.radiusM > 0 && q.radiusM <= this.maxRadiusM)) {
      throw new ValidationError(`radius must be > 0 and <= ${this.maxRadiusM} metres`);
    }
    const limit = Math.min(q.limit ?? 20, this.maxLimit);
    const offset = q.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1) throw new ValidationError("limit must be a positive integer");
    if (!Number.isInteger(offset) || offset < 0) throw new ValidationError("offset must be a non-negative integer");

    const results = await this.places.findNearby(center, q.radiusM, limit, offset);
    return { center, radiusM: q.radiusM, results };
  }
}
