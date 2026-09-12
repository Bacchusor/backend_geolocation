import { describe, expect, it } from "vitest";
import { coordinates, haversineDistanceM, roundCoordinates } from "../../src/domain/coordinates.js";
import { ValidationError } from "../../src/domain/errors.js";

describe("coordinates", () => {
  it("accepts the full valid range", () => {
    expect(coordinates(-90, -180)).toEqual({ lat: -90, lng: -180 });
    expect(coordinates(90, 180)).toEqual({ lat: 90, lng: 180 });
    expect(coordinates(0, 0)).toEqual({ lat: 0, lng: 0 });
  });

  it.each([
    [90.0001, 0],
    [-90.0001, 0],
    [0, 180.0001],
    [0, -180.0001],
    [Number.NaN, 0],
    [0, Number.POSITIVE_INFINITY],
  ])("rejects out-of-range or non-finite values (%s, %s)", (lat, lng) => {
    expect(() => coordinates(lat, lng)).toThrow(ValidationError);
  });

  it("is immutable", () => {
    const c = coordinates(1, 2);
    expect(() => {
      (c as { lat: number }).lat = 5;
    }).toThrow();
  });
});

describe("haversineDistanceM", () => {
  it("is zero for identical points", () => {
    const p = coordinates(48.8566, 2.3522);
    expect(haversineDistanceM(p, p)).toBe(0);
  });

  it("matches known distances within 0.5%", () => {
    const paris = coordinates(48.8566, 2.3522);
    const london = coordinates(51.5074, -0.1278);
    const d = haversineDistanceM(paris, london);
    expect(d).toBeGreaterThan(343_000);
    expect(d).toBeLessThan(345_000);
  });

  it("is symmetric", () => {
    const a = coordinates(-33.8688, 151.2093);
    const b = coordinates(35.6762, 139.6503);
    expect(haversineDistanceM(a, b)).toBeCloseTo(haversineDistanceM(b, a), 6);
  });

  it("handles the antimeridian", () => {
    const d = haversineDistanceM(coordinates(0, 179.9), coordinates(0, -179.9));
    expect(d).toBeLessThan(25_000);
  });
});

describe("roundCoordinates", () => {
  it("rounds to the requested precision", () => {
    expect(roundCoordinates(coordinates(48.856614, 2.352222), 3)).toEqual({ lat: 48.857, lng: 2.352 });
    expect(roundCoordinates(coordinates(48.856614, 2.352222), 5)).toEqual({ lat: 48.85661, lng: 2.35222 });
  });
});
