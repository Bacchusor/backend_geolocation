/**
 * Runs against a real PostGIS container (testcontainers). Skipped automatically
 * when Docker is not available so unit tests still run everywhere.
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { coordinates } from "../../src/domain/coordinates.js";
import { locationFix } from "../../src/domain/location.js";
import { migrateDown, migrateUp } from "../../src/infrastructure/db/migrate.js";
import { PostgresGeofenceEventRepository } from "../../src/infrastructure/db/postgres-geofence-event-repository.js";
import { PostgresLocationRepository } from "../../src/infrastructure/db/postgres-location-repository.js";
import { PostgresPlaceRepository } from "../../src/infrastructure/db/postgres-place-repository.js";

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MIGRATIONS = path.resolve(process.cwd(), "migrations");

describe.skipIf(!dockerAvailable())("PostGIS repositories", () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let locations: PostgresLocationRepository;
  let places: PostgresPlaceRepository;
  let geofence: PostgresGeofenceEventRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgis/postgis:16-3.4").start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await migrateUp(pool, MIGRATIONS);
    locations = new PostgresLocationRepository(pool);
    places = new PostgresPlaceRepository(pool);
    geofence = new PostgresGeofenceEventRepository(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE user_locations, location_history, places, geofence_events");
  });

  it("migrations are idempotent and reversible", async () => {
    expect(await migrateUp(pool, MIGRATIONS)).toEqual([]);
    expect(await migrateDown(pool, MIGRATIONS)).toBe("001_init");
    expect(await migrateUp(pool, MIGRATIONS)).toEqual(["001_init"]);
  });

  describe("locations", () => {
    it("upserts current position and appends history atomically", async () => {
      const f1 = locationFix({ position: coordinates(48.8566, 2.3522), accuracyM: 10, recordedAt: new Date("2026-09-12T10:00:00Z") });
      const f2 = locationFix({ position: coordinates(48.8570, 2.3530), accuracyM: null, recordedAt: new Date("2026-09-12T10:00:30Z") });

      const saved1 = await locations.saveCurrentAndHistory(USER, f1, [f1]);
      expect(saved1.position).toEqual(f1.position);
      const saved2 = await locations.saveCurrentAndHistory(USER, f2, [f2]);
      expect(saved2.position.lat).toBeCloseTo(48.857, 6);
      expect(saved2.accuracyM).toBeNull();
      expect(saved2.updatedAt.getTime()).toBeGreaterThanOrEqual(saved1.updatedAt.getTime());

      const current = await locations.getCurrent(USER);
      expect(current?.recordedAt.toISOString()).toBe("2026-09-12T10:00:30.000Z");
      expect(await locations.listHistory(USER, 10)).toHaveLength(2);
      expect((await pool.query("SELECT count(*) FROM user_locations")).rows[0].count).toBe("1");
    });

    it("preserves coordinate precision (lng before lat)", async () => {
      const f = locationFix({ position: coordinates(-33.8688197, 151.2092955), recordedAt: new Date() });
      const saved = await locations.saveCurrentAndHistory(USER, f, []);
      expect(saved.position.lat).toBeCloseTo(-33.8688197, 7);
      expect(saved.position.lng).toBeCloseTo(151.2092955, 7);
    });

    it("deletes only one user's data", async () => {
      const f = locationFix({ position: coordinates(1, 1), recordedAt: new Date() });
      await locations.saveCurrentAndHistory(USER, f, [f]);
      await locations.saveCurrentAndHistory(OTHER, f, [f]);
      await locations.deleteAllForUser(USER);
      expect(await locations.getCurrent(USER)).toBeNull();
      expect(await locations.listHistory(USER, 10)).toHaveLength(0);
      expect(await locations.getCurrent(OTHER)).not.toBeNull();
    });

    it("purges history older than the cutoff", async () => {
      const old = locationFix({ position: coordinates(1, 1), recordedAt: new Date("2026-01-01T00:00:00Z") });
      const recent = locationFix({ position: coordinates(1, 1), recordedAt: new Date("2026-09-10T00:00:00Z") });
      await locations.appendHistory(USER, [old, recent]);
      expect(await locations.purgeHistoryOlderThan(new Date("2026-08-13T00:00:00Z"))).toBe(1);
      expect(await locations.listHistory(USER, 10)).toHaveLength(1);
    });
  });

  describe("places.findNearby", () => {
    beforeEach(async () => {
      await pool.query(
        `INSERT INTO places (name, position, metadata) VALUES
         ('Notre-Dame', ST_SetSRID(ST_MakePoint(2.3499, 48.8530), 4326)::geography, '{"kind":"church"}'),
         ('Louvre',     ST_SetSRID(ST_MakePoint(2.3376, 48.8606), 4326)::geography, '{}'),
         ('Eiffel',     ST_SetSRID(ST_MakePoint(2.2945, 48.8584), 4326)::geography, '{}'),
         ('London Eye', ST_SetSRID(ST_MakePoint(-0.1196, 51.5033), 4326)::geography, '{}')`,
      );
    });

    it("returns places within radius ordered by distance, with metres", async () => {
      const center = coordinates(48.8566, 2.3522); // Paris centre
      const res = await places.findNearby(center, 2000, 10, 0);
      expect(res.map((p) => p.name)).toEqual(["Notre-Dame", "Louvre"]);
      expect(res[0]!.distanceM).toBeGreaterThan(400);
      expect(res[0]!.distanceM).toBeLessThan(450);
      expect(res[0]!.metadata).toEqual({ kind: "church" });
    });

    it("respects radius, limit and offset", async () => {
      const center = coordinates(48.8566, 2.3522);
      expect((await places.findNearby(center, 6000, 10, 0)).map((p) => p.name)).toEqual(["Notre-Dame", "Louvre", "Eiffel"]);
      expect((await places.findNearby(center, 6000, 1, 1)).map((p) => p.name)).toEqual(["Louvre"]);
      expect(await places.findNearby(center, 100, 10, 0)).toEqual([]);
    });

    it("uses the GiST index", async () => {
      // Force the planner to consider the index even on a tiny table.
      await pool.query("SET enable_seqscan = off");
      const plan = await pool.query(
        `EXPLAIN SELECT id FROM places
         WHERE ST_DWithin(position, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`,
        [2.3522, 48.8566, 2000],
      );
      await pool.query("RESET enable_seqscan");
      const text = plan.rows.map((r: { "QUERY PLAN": string }) => r["QUERY PLAN"]).join("\n");
      expect(text).toMatch(/places_position_idx/);
    });
  });

  describe("geofence events", () => {
    it("stores events with optional position and scopes reads/deletes by user", async () => {
      await geofence.saveMany([
        { userId: USER, geofenceId: "home", type: "enter", occurredAt: new Date("2026-09-12T08:00:00Z"), position: coordinates(48.85, 2.35) },
        { userId: USER, geofenceId: "home", type: "exit", occurredAt: new Date("2026-09-12T09:00:00Z"), position: null },
        { userId: OTHER, geofenceId: "work", type: "enter", occurredAt: new Date("2026-09-12T09:30:00Z"), position: null },
      ]);
      const mine = await geofence.listForUser(USER, 10);
      expect(mine.map((e) => e.type)).toEqual(["exit", "enter"]);
      expect(mine[1]!.position).toEqual({ lat: 48.85, lng: 2.35 });
      expect(mine[0]!.position).toBeNull();

      await geofence.deleteAllForUser(USER);
      expect(await geofence.listForUser(USER, 10)).toHaveLength(0);
      expect(await geofence.listForUser(OTHER, 10)).toHaveLength(1);
    });
  });
});
