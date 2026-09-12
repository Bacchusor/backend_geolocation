import { ValidationError } from "./errors.js";

/** WGS84 point in decimal degrees. Immutable and always valid once constructed. */
export interface Coordinates {
  readonly lat: number;
  readonly lng: number;
}

export function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function coordinates(lat: number, lng: number): Coordinates {
  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) {
    throw new ValidationError("lat must be a finite number in [-90, 90]");
  }
  if (!isFiniteNumber(lng) || lng < -180 || lng > 180) {
    throw new ValidationError("lng must be a finite number in [-180, 180]");
  }
  return Object.freeze({ lat, lng });
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres (haversine). Good enough for plausibility checks. */
export function haversineDistanceM(a: Coordinates, b: Coordinates): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Round to a fixed number of decimals. Used for cache keys (5 decimals ≈ 1 m)
 * and for reducing precision before exposing positions (3 decimals ≈ 100 m).
 */
export function roundCoordinates(c: Coordinates, decimals: number): Coordinates {
  const f = 10 ** decimals;
  return Object.freeze({
    lat: Math.round(c.lat * f) / f,
    lng: Math.round(c.lng * f) / f,
  });
}
