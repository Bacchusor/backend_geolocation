import type { GeofenceEvent } from "../domain/geofence.js";
import type { LocationFix, UserLocation } from "../domain/location.js";
import type { GeofenceEventRepository, LocationRepository } from "../domain/ports.js";

export interface UserLocationExport {
  current: UserLocation | null;
  history: LocationFix[];
  geofenceEvents: GeofenceEvent[];
}

/** GDPR Art. 15 (access/export) and Art. 17 (erasure) for a user's location data. */
export class UserLocationData {
  constructor(
    private readonly locations: LocationRepository,
    private readonly geofenceEvents: GeofenceEventRepository,
    private readonly exportLimit = 10_000,
  ) {}

  async exportAll(userId: string): Promise<UserLocationExport> {
    const [current, history, geofenceEvents] = await Promise.all([
      this.locations.getCurrent(userId),
      this.locations.listHistory(userId, this.exportLimit),
      this.geofenceEvents.listForUser(userId, this.exportLimit),
    ]);
    return { current, history, geofenceEvents };
  }

  async deleteAll(userId: string): Promise<void> {
    await this.locations.deleteAllForUser(userId);
    await this.geofenceEvents.deleteAllForUser(userId);
  }
}
