import { ValidationError } from "../domain/errors.js";
import type { GeofenceEvent } from "../domain/geofence.js";
import type { GeofenceEventRepository } from "../domain/ports.js";

/**
 * Stores enter/exit transitions detected on-device. The server does not
 * evaluate geofences itself (OS-level geofencing is far cheaper on battery);
 * it only records what the device reports, attributed to the authenticated user.
 */
export class RecordGeofenceEvents {
  constructor(
    private readonly events: GeofenceEventRepository,
    private readonly maxBatchSize = 100,
  ) {}

  async execute(events: GeofenceEvent[]): Promise<{ stored: number }> {
    if (events.length === 0) throw new ValidationError("at least one event is required");
    if (events.length > this.maxBatchSize) {
      throw new ValidationError(`at most ${this.maxBatchSize} events per request`);
    }
    await this.events.saveMany(events);
    return { stored: events.length };
  }
}
