const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres (haversine). Good enough for velocity checks. */
export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface PrevFix {
  lat: number;
  lng: number;
  recorded_at: Date;
}
export interface NewFix {
  lat: number;
  lng: number;
  accuracy_m: number;
  recorded_at: Date;
}
export interface PlausibilityOptions {
  maxSpeedMps: number;
  maxFixAgeHours: number;
  now: Date;
  /** Jumps after a gap longer than this are accepted (e.g. a flight with the phone off). */
  velocityWindowSeconds?: number;
}

export type PlausibilityResult = { ok: true } | { ok: false; reason: string };

/**
 * Reject stale, future, out-of-order and physically implausible fixes.
 * Out-of-order fixes (older than the stored current position) are ignored: they are useful for
 * history but must not drive geofence state backwards.
 */
export function checkPlausibility(
  prev: PrevFix | null,
  fix: NewFix,
  opts: PlausibilityOptions,
): PlausibilityResult {
  const ageMs = opts.now.getTime() - fix.recorded_at.getTime();
  if (ageMs < -5 * 60_000) return { ok: false, reason: 'recorded_at is in the future' };
  if (ageMs > opts.maxFixAgeHours * 3_600_000)
    return { ok: false, reason: `fix older than ${opts.maxFixAgeHours}h` };
  if (!prev) return { ok: true };
  const dtMs = fix.recorded_at.getTime() - prev.recorded_at.getTime();
  if (dtMs < 0) return { ok: false, reason: 'out of order: older than current position' };
  const windowMs = (opts.velocityWindowSeconds ?? 3600) * 1000;
  if (dtMs >= windowMs) return { ok: true };
  const dist = haversineM(prev.lat, prev.lng, fix.lat, fix.lng);
  // Allow for reported accuracy on both ends before judging speed.
  const effective = Math.max(0, dist - fix.accuracy_m);
  const speed = effective / Math.max(dtMs / 1000, 1);
  if (speed > opts.maxSpeedMps)
    return { ok: false, reason: `implausible jump: ${Math.round(speed)} m/s` };
  return { ok: true };
}
