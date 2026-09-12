import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  JWT_SECRET: "x".repeat(32),
  JWT_ISSUER: "https://issuer/",
  JWT_AUDIENCE: "api",
};

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig(base);
    expect(c.PORT).toBe(3000);
    expect(c.MAX_NEARBY_RADIUS_M).toBe(50_000);
    expect(c.HISTORY_RETENTION_DAYS).toBe(30);
    expect(c.GEOCODER_PROVIDER).toBe("nominatim");
  });

  it("requires a JWT verification key", () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: undefined })).toThrow(/JWT_SECRET or JWT_JWKS_URL/);
  });

  it("rejects short secrets", () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: "short" })).toThrow(/JWT_SECRET/);
  });

  it("requires a Mapbox token when Mapbox is selected", () => {
    expect(() => loadConfig({ ...base, GEOCODER_PROVIDER: "mapbox" })).toThrow(/MAPBOX_ACCESS_TOKEN/);
  });
});
