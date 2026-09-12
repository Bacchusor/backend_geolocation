import { type Coordinates, haversineDistanceM } from "./coordinates.js";
import { ValidationError } from "./errors.js";

/** A single position fix reported by a device. */
export interface LocationFix {
  readonly position: Coordinates;
  /** Horizontal accuracy radius in metres, if the device reported one. */
  readonly accuracyM: number | null;
  /** When the device captured the fix (client clock). */
  readonly recordedAt: Date;
}

/** The stored current position of a user. */
export interface UserLocation extends LocationFix {
  readonly userId: string;
  /** When the server last accepted a fix (server clock). */
  readonly updatedAt: Date;
}

export interface FixPolicy {
  /** Fixes recorded more than this many seconds before `now` are not accepted as current. */
  readonly maxFixAgeSeconds: number;
  /** Fixes recorded more than this many seconds after `now` are rejected (clock skew guard). */
  readonly maxFutureSkewSeconds: number;
  /** A fix implying a faster move than this from the previous position is rejected. */
  readonly maxSpeedMps: number;
  /** Fixes with worse (larger) accuracy than this are rejected. */
  readonly maxAcceptedAccuracyM: number;
}

export const DEFAULT_FIX_POLICY: FixPolicy = Object.freeze({
  maxFixAgeSeconds: 600,
  maxFutureSkewSeconds: 60,
  maxSpeedMps: 350,
  maxAcceptedAccuracyM: 500,
});

export function locationFix(input: {
  position: Coordinates;
  accuracyM?: number | null | undefined;
  recordedAt: Date;
}): LocationFix {
  if (Number.isNaN(input.recordedAt.getTime())) {
    throw new ValidationError("recordedAt must be a valid date");
  }
  const accuracyM = input.accuracyM ?? null;
  if (accuracyM !== null && !(Number.isFinite(accuracyM) && accuracyM >= 0)) {
    throw new ValidationError("accuracy must be a number >= 0");
  }
  return Object.freeze({ position: input.position, accuracyM, recordedAt: input.recordedAt });
}

export type FixVerdict =
  /** Fresh and plausible: may become the user's current position. */
  | { readonly verdict: "current" }
  /** Legitimate but not usable as current (stale or out of order): keep in history only. */
  | { readonly verdict: "history"; readonly reason: string }
  /** Not trustworthy (future timestamp, poor accuracy, teleportation): drop it. */
  | { readonly verdict: "reject"; readonly reason: string };

/**
 * Server-side plausibility rules. Client location is untrusted input: this is
 * the single place that decides what may become the user's current position,
 * what is merely archived, and what is discarded.
 */
export function evaluateFix(
  fix: LocationFix,
  previous: UserLocation | null,
  now: Date,
  policy: FixPolicy = DEFAULT_FIX_POLICY,
): FixVerdict {
  const ageSeconds = (now.getTime() - fix.recordedAt.getTime()) / 1000;
  if (-ageSeconds > policy.maxFutureSkewSeconds) {
    return { verdict: "reject", reason: "fix timestamp is in the future" };
  }
  if (fix.accuracyM !== null && fix.accuracyM > policy.maxAcceptedAccuracyM) {
    return { verdict: "reject", reason: `fix accuracy too poor (${fix.accuracyM}m)` };
  }
  if (ageSeconds > policy.maxFixAgeSeconds) {
    return { verdict: "history", reason: `fix is stale (${Math.round(ageSeconds)}s old)` };
  }
  if (previous) {
    const dtSeconds = (fix.recordedAt.getTime() - previous.recordedAt.getTime()) / 1000;
    if (dtSeconds <= 0) {
      return { verdict: "history", reason: "fix is older than the current position" };
    }
    const distanceM = haversineDistanceM(previous.position, fix.position);
    // Subtract both accuracy radii so GPS jitter on a stationary device is not
    // mistaken for teleportation.
    const tolerance = (previous.accuracyM ?? 0) + (fix.accuracyM ?? 0);
    const speed = Math.max(0, distanceM - tolerance) / dtSeconds;
    if (speed > policy.maxSpeedMps) {
      return { verdict: "reject", reason: `implausible speed (${Math.round(speed)} m/s)` };
    }
  }
  return { verdict: "current" };
}
