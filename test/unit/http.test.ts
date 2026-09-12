import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/app.js";
import { USER_A, USER_B, signToken } from "../helpers/token.js";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

describe("HTTP API", () => {
  let t: TestApp;
  let app: FastifyInstance;
  let auth: { authorization: string };

  beforeEach(async () => {
    t = await buildTestApp();
    app = t.app;
    auth = { authorization: `Bearer ${await signToken(USER_A)}` };
  });
  afterEach(async () => {
    await app.close();
  });

  const nowIso = () => t.clock.now().toISOString();
  const postLocation = (body: unknown, headers = auth) =>
    app.inject({ method: "POST", url: "/v1/location", headers, payload: body });

  describe("authentication", () => {
    it("rejects requests without a token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/nearby?lat=1&lng=1&radius=10" });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("UNAUTHORIZED");
    });

    it.each([
      ["wrong secret", { secret: "another-secret-that-is-also-long-enough-123456" }],
      ["wrong issuer", { issuer: "https://evil/" }],
      ["wrong audience", { audience: "other-api" }],
      ["expired", { expiresIn: "-5m" }],
    ])("rejects a token with %s", async (_label, overrides) => {
      const token = await signToken(USER_A, overrides);
      const res = await app.inject({ method: "GET", url: "/v1/location", headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(401);
    });

    it("rejects a subject that is not a UUID", async () => {
      const token = await signToken("admin");
      const res = await app.inject({ method: "GET", url: "/v1/location", headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(401);
    });

    it("leaves /healthz public", async () => {
      expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
      t.setHealthy(false);
      expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(503);
    });
  });

  describe("POST /v1/location", () => {
    it("upserts a single fix", async () => {
      const res = await postLocation({ lat: 48.8566, lng: 2.3522, accuracy: 12, timestamp: nowIso() });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ accepted: 1, rejected: [], current: { lat: 48.8566, lng: 2.3522, accuracy: 12 } });
    });

    it("accepts a batch, archives stale fixes and reports dropped ones", async () => {
      const stale = new Date(t.clock.now().getTime() - 3_600_000).toISOString();
      const res = await postLocation({
        fixes: [
          { lat: 48.8566, lng: 2.3522, timestamp: stale },
          { lat: 48.8567, lng: 2.3523, timestamp: nowIso() },
          { lat: 48.8567, lng: 2.3523, accuracy: 9999, timestamp: nowIso() },
        ],
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ accepted: 2, currentUpdated: true, current: { lat: 48.8567 } });
      expect(res.json().rejected).toEqual([{ index: 2, reason: expect.stringMatching(/accuracy/) }]);
    });

    it("keeps the previous position when the only fix is a teleport", async () => {
      await postLocation({ lat: 48.8566, lng: 2.3522, timestamp: nowIso() });
      t.clock.set(new Date(t.clock.now().getTime() + 60_000));
      const res = await postLocation({ lat: 51.5, lng: -0.12, timestamp: nowIso() });
      // Dropped fixes are reported in the body, not as an error, so the client can resync.
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ accepted: 0, currentUpdated: false, current: { lat: 48.8566 } });
      expect(res.json().rejected[0].reason).toMatch(/implausible/);
    });

    it.each([
      [{ lat: 91, lng: 0, timestamp: "2026-09-12T10:00:00Z" }],
      [{ lat: 0, lng: -181, timestamp: "2026-09-12T10:00:00Z" }],
      [{ lat: 0, lng: 0, accuracy: -1, timestamp: "2026-09-12T10:00:00Z" }],
      [{ lat: 0, lng: 0, timestamp: "yesterday" }],
      [{ lat: "0", lng: 0, timestamp: "2026-09-12T10:00:00Z" }],
      [{ fixes: [] }],
      [{}],
    ])("validates the body %j", async (body) => {
      const res = await postLocation(body);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("ignores any user id in the body and uses the token subject", async () => {
      await postLocation({ userId: USER_B, lat: 48.8566, lng: 2.3522, timestamp: nowIso() });
      expect(t.locations.current.has(USER_A)).toBe(true);
      expect(t.locations.current.has(USER_B)).toBe(false);
    });

    it("rate limits per user", async () => {
      let last = 200;
      for (let i = 0; i < 13; i++) {
        last = (await postLocation({ lat: 48.8566, lng: 2.3522, timestamp: nowIso() })).statusCode;
      }
      expect(last).toBe(429);
      const other = { authorization: `Bearer ${await signToken(USER_B)}` };
      expect((await postLocation({ lat: 48.8566, lng: 2.3522, timestamp: nowIso() }, other)).statusCode).toBe(200);
    });
  });

  describe("GET /v1/location and DELETE /v1/location", () => {
    it("returns 404 before any fix, then the current position", async () => {
      expect((await app.inject({ method: "GET", url: "/v1/location", headers: auth })).statusCode).toBe(404);
      await postLocation({ lat: 48.8566, lng: 2.3522, timestamp: nowIso() });
      const res = await app.inject({ method: "GET", url: "/v1/location", headers: auth });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ lat: 48.8566, lng: 2.3522 });
    });

    it("exports and deletes only the caller's data", async () => {
      await postLocation({ lat: 48.8566, lng: 2.3522, timestamp: nowIso() });
      const otherAuth = { authorization: `Bearer ${await signToken(USER_B)}` };
      await postLocation({ lat: 40.7, lng: -74.0, timestamp: nowIso() }, otherAuth);

      const exp = await app.inject({ method: "GET", url: "/v1/location/export", headers: auth });
      expect(exp.statusCode).toBe(200);
      expect(exp.json().userId).toBe(USER_A);
      expect(exp.json().history).toHaveLength(1);

      const del = await app.inject({ method: "DELETE", url: "/v1/location", headers: auth });
      expect(del.statusCode).toBe(204);
      expect((await app.inject({ method: "GET", url: "/v1/location", headers: auth })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/v1/location", headers: otherAuth })).statusCode).toBe(200);
    });
  });

  describe("GET /v1/nearby", () => {
    it("returns places within the radius sorted by distance", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/nearby?lat=48.8566&lng=2.3522&radius=5000", headers: auth });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.map((r: { id: string }) => r.id)).toEqual(["a", "b"]);
      expect(body.results[0].distance).toBe(0);
      expect(body.results[1].distance).toBeGreaterThan(0);
    });

    it("paginates", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/nearby?lat=48.8566&lng=2.3522&radius=5000&limit=1&offset=1", headers: auth });
      expect(res.json().results.map((r: { id: string }) => r.id)).toEqual(["b"]);
    });

    it.each(["radius=0", "radius=-5", "radius=abc", "lat=95&radius=10", "limit=0", "limit=51"])(
      "rejects bad query %s",
      async (q) => {
        const res = await app.inject({ method: "GET", url: `/v1/nearby?lat=48&lng=2&radius=100&${q}`, headers: auth });
        expect(res.statusCode).toBe(400);
      },
    );

    it("caps the radius server-side", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/nearby?lat=48&lng=2&radius=999999", headers: auth });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/radius/);
    });
  });

  describe("geocoding", () => {
    it("forward geocodes and caches", async () => {
      const r1 = await app.inject({ method: "GET", url: "/v1/geocode?q=Paris", headers: auth });
      const r2 = await app.inject({ method: "GET", url: "/v1/geocode?q=paris", headers: auth });
      expect(r1.statusCode).toBe(200);
      expect(r1.json().results[0]).toMatchObject({ label: "Paris, France", lat: 48.8566, lng: 2.3522 });
      expect(r2.json()).toEqual(r1.json());
      expect(t.geocoder.calls).toBe(1);
    });

    it("reverse geocodes", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/reverse?lat=48.8566&lng=2.3522", headers: auth });
      expect(res.statusCode).toBe(200);
      expect(res.json().label).toBe("Paris, France");
    });

    it("returns 503 when the provider is down, without leaking details", async () => {
      t.geocoder.failWith = new Error("upstream responded 500");
      const res = await app.inject({ method: "GET", url: "/v1/geocode?q=Lyon", headers: auth });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("PROVIDER_UNAVAILABLE");
    });
  });

  describe("POST /v1/geofence/events", () => {
    it("stores events attributed to the caller", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/geofence/events",
        headers: auth,
        payload: { events: [{ geofenceId: "office", type: "enter", occurredAt: nowIso(), lat: 48.85, lng: 2.35 }, { geofenceId: "office", type: "exit", occurredAt: nowIso() }] },
      });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ stored: 2 });
      expect(t.geofenceEvents.events.every((e) => e.userId === USER_A)).toBe(true);
      expect(t.geofenceEvents.events[1]?.position).toBeNull();
    });

    it("validates event type", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/geofence/events",
        headers: auth,
        payload: { events: [{ geofenceId: "office", type: "dwell", occurredAt: nowIso() }] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("hardening", () => {
    it("sets security headers", async () => {
      const res = await app.inject({ method: "GET", url: "/healthz" });
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBeDefined();
    });

    it("rejects oversized bodies", async () => {
      const res = await postLocation({ lat: 0, lng: 0, timestamp: nowIso(), pad: "x".repeat(70 * 1024) });
      expect(res.statusCode).toBe(413);
    });

    it("does not leak internal errors", async () => {
      t.places.findNearby = async () => {
        throw new Error("relation places does not exist");
      };
      const res = await app.inject({ method: "GET", url: "/v1/nearby?lat=48&lng=2&radius=100", headers: auth });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "internal error" } });
    });
  });
});
