import type { Coordinates } from "./coordinates.js";

export type GeofenceEventType = "enter" | "exit";

/** An enter/exit event detected on the device by the OS geofencing API. */
export interface GeofenceEvent {
  readonly userId: string;
  readonly geofenceId: string;
  readonly type: GeofenceEventType;
  readonly occurredAt: Date;
  /** Position at the time of the transition, if the device attached one. */
  readonly position: Coordinates | null;
}
