import { describe, expect, it } from "vitest";
import { coordinates } from "../../src/domain/coordinates.js";
import { ValidationError } from "../../src/domain/errors.js";
import { DEFAULT_FIX_POLICY, type UserLocation, evaluateFix, locationFix } from "../../src/domain/location.js";

const now = new Date("2026-09-12T10:00:00Z");
const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);
const paris = coordinates(48.8566, 2.3522);
const london = coordinates(51.5074, -0.1278);

const previous: UserLocation = {
  userId: "u",
  position: paris,
  accuracyM: 10,
  recordedAt: secondsAgo(120),
  updatedAt: secondsAgo(120),
};

describe("locationFix", () => {
  it("rejects invalid dates and negative accuracy", () => {
    expect(() => locationFix({ position: paris, recordedAt: new Date("nope") })).toThrow(ValidationError);
    expect(() => locationFix({ position: paris, accuracyM: -1, recordedAt: now })).toThrow(ValidationError);
  });
  it("normalises missing accuracy to null", () => {
    expect(locationFix({ position: paris, recordedAt: now }).accuracyM).toBeNull();
  });
});

describe("evaluateFix", () => {
  it("promotes a fresh, nearby fix", () => {
    const fix = locationFix({ position: coordinates(48.857, 2.353), accuracyM: 15, recordedAt: secondsAgo(5) });
    expect(evaluateFix(fix, previous, now)).toEqual({ verdict: "current" });
  });

  it("promotes the first fix when there is no previous position", () => {
    const fix = locationFix({ position: london, recordedAt: secondsAgo(5) });
    expect(evaluateFix(fix, null, now)).toEqual({ verdict: "current" });
  });

  it("archives a stale fix in history only", () => {
    const fix = locationFix({ position: paris, recordedAt: secondsAgo(DEFAULT_FIX_POLICY.maxFixAgeSeconds + 1) });
    expect(evaluateFix(fix, null, now)).toMatchObject({ verdict: "history", reason: expect.stringMatching(/stale/) });
  });

  it("rejects a fix from the future beyond clock skew", () => {
    const fix = locationFix({ position: paris, recordedAt: secondsAgo(-120) });
    expect(evaluateFix(fix, null, now)).toMatchObject({ verdict: "reject", reason: expect.stringMatching(/future/) });
  });

  it("tolerates small clock skew", () => {
    const fix = locationFix({ position: paris, recordedAt: secondsAgo(-20) });
    expect(evaluateFix(fix, null, now)).toEqual({ verdict: "current" });
  });

  it("rejects poor accuracy", () => {
    const fix = locationFix({ position: paris, accuracyM: 5000, recordedAt: secondsAgo(1) });
    expect(evaluateFix(fix, null, now)).toMatchObject({ verdict: "reject", reason: expect.stringMatching(/accuracy/) });
  });

  it("archives a fix older than the current position", () => {
    const fix = locationFix({ position: paris, recordedAt: secondsAgo(300) });
    expect(evaluateFix(fix, previous, now)).toMatchObject({ verdict: "history", reason: expect.stringMatching(/older/) });
  });

  it("rejects teleportation (Paris to London in 2 minutes)", () => {
    const fix = locationFix({ position: london, accuracyM: 10, recordedAt: secondsAgo(1) });
    expect(evaluateFix(fix, previous, now)).toMatchObject({ verdict: "reject", reason: expect.stringMatching(/implausible speed/) });
  });

  it("does not treat GPS jitter on a stationary device as movement", () => {
    // 80 m jump in 1 s would be 80 m/s, but both fixes have 50 m accuracy.
    const jittery: UserLocation = { ...previous, accuracyM: 50, recordedAt: secondsAgo(2) };
    const fix = locationFix({ position: coordinates(48.8573, 2.3522), accuracyM: 50, recordedAt: secondsAgo(1) });
    expect(evaluateFix(fix, jittery, now, { ...DEFAULT_FIX_POLICY, maxSpeedMps: 60 })).toEqual({ verdict: "current" });
  });

  it("honours a custom policy", () => {
    const fix = locationFix({ position: paris, recordedAt: secondsAgo(30) });
    expect(evaluateFix(fix, null, now, { ...DEFAULT_FIX_POLICY, maxFixAgeSeconds: 10 }).verdict).toBe("history");
  });
});
