import { describe, expect, it } from "vitest";
import { GeocodeService } from "../../src/application/geocode.js";
import { coordinates } from "../../src/domain/coordinates.js";
import { ProviderUnavailableError, ValidationError } from "../../src/domain/errors.js";
import { normaliseQuery } from "../../src/domain/geocoding.js";
import { MemoryCache } from "../../src/infrastructure/cache/memory-cache.js";
import { CircuitBreaker } from "../../src/infrastructure/geocoding/circuit-breaker.js";
import { ResilientGeocoder } from "../../src/infrastructure/geocoding/resilient-geocoder.js";
import { StubGeocoder } from "../helpers/in-memory.js";

const result = { label: "Paris", position: coordinates(48.8566, 2.3522), provider: "stub" };

describe("normaliseQuery", () => {
  it("trims, lowercases and collapses whitespace", () => {
    expect(normaliseQuery("  10   Downing\tStreet ")).toBe("10 downing street");
  });
});

describe("GeocodeService", () => {
  it("caches forward lookups by normalised query", async () => {
    const stub = new StubGeocoder(result);
    const svc = new GeocodeService(stub, new MemoryCache(), 60);
    await svc.forward("Paris");
    await svc.forward("  paris ");
    expect(stub.calls).toBe(1);
  });

  it("caches reverse lookups by coordinate rounded to ~1 m", async () => {
    const stub = new StubGeocoder(result);
    const svc = new GeocodeService(stub, new MemoryCache(), 60);
    await svc.reverse(48.8566141, 2.3522219);
    await svc.reverse(48.8566139, 2.3522221);
    expect(stub.calls).toBe(1);
    await svc.reverse(48.86, 2.36);
    expect(stub.calls).toBe(2);
  });

  it("caches null reverse results too", async () => {
    const stub = new StubGeocoder(result);
    stub.reverse = async () => {
      stub.calls += 1;
      return null;
    };
    const svc = new GeocodeService(stub, new MemoryCache(), 60);
    expect(await svc.reverse(0, 0)).toBeNull();
    expect(await svc.reverse(0, 0)).toBeNull();
    expect(stub.calls).toBe(1);
  });

  it("validates query length", async () => {
    const svc = new GeocodeService(new StubGeocoder(result), new MemoryCache(), 60);
    await expect(svc.forward("a")).rejects.toThrow(ValidationError);
    await expect(svc.forward("x".repeat(201))).rejects.toThrow(ValidationError);
  });
});

describe("MemoryCache", () => {
  it("expires entries and bounds size", async () => {
    const cache = new MemoryCache(2);
    await cache.set("a", 1, 0.01);
    await new Promise((r) => setTimeout(r, 20));
    expect(await cache.get("a")).toBeUndefined();
    await cache.set("b", 2, 60);
    await cache.set("c", 3, 60);
    await cache.set("d", 4, 60);
    expect(cache.size).toBe(2);
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("d")).toBe(4);
  });
});

describe("CircuitBreaker", () => {
  it("opens after N failures, then half-opens after the timeout", async () => {
    let t = 0;
    const cb = new CircuitBreaker("x", { failureThreshold: 2, resetTimeoutMs: 1000, now: () => t });
    const fail = () => Promise.reject(new Error("boom"));
    await expect(cb.call(fail)).rejects.toThrow("boom");
    expect(cb.state).toBe("closed");
    await expect(cb.call(fail)).rejects.toThrow("boom");
    expect(cb.state).toBe("open");
    await expect(cb.call(() => Promise.resolve(1))).rejects.toThrow(ProviderUnavailableError);
    t = 1000;
    expect(cb.state).toBe("half-open");
    expect(await cb.call(() => Promise.resolve(1))).toBe(1);
    expect(cb.state).toBe("closed");
  });

  it("re-opens immediately if the trial call fails", async () => {
    let t = 0;
    const cb = new CircuitBreaker("x", { failureThreshold: 1, resetTimeoutMs: 100, now: () => t });
    await expect(cb.call(() => Promise.reject(new Error("a")))).rejects.toThrow();
    t = 100;
    await expect(cb.call(() => Promise.reject(new Error("b")))).rejects.toThrow("b");
    expect(cb.state).toBe("open");
  });
});

describe("ResilientGeocoder", () => {
  it("wraps upstream errors as ProviderUnavailableError and trips the breaker", async () => {
    const stub = new StubGeocoder(result);
    stub.failWith = new Error("upstream responded 500");
    const geo = new ResilientGeocoder(stub, { failureThreshold: 2, resetTimeoutMs: 60_000 });
    await expect(geo.forward("paris", 1)).rejects.toThrow(ProviderUnavailableError);
    await expect(geo.forward("paris", 1)).rejects.toThrow(ProviderUnavailableError);
    await expect(geo.forward("paris", 1)).rejects.toThrow(/circuit open/);
    expect(stub.calls).toBe(2);
  });
});
