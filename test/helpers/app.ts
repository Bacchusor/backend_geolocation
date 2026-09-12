import { FindNearby } from "../../src/application/find-nearby.js";
import { GeocodeService } from "../../src/application/geocode.js";
import { RecordGeofenceEvents } from "../../src/application/record-geofence-events.js";
import { UpdateLocation } from "../../src/application/update-location.js";
import { UserLocationData } from "../../src/application/user-data.js";
import { coordinates } from "../../src/domain/coordinates.js";
import { DEFAULT_FIX_POLICY } from "../../src/domain/location.js";
import { MemoryCache } from "../../src/infrastructure/cache/memory-cache.js";
import { ResilientGeocoder } from "../../src/infrastructure/geocoding/resilient-geocoder.js";
import { buildServer } from "../../src/http/server.js";
import {
  FakeClock,
  InMemoryGeofenceEventRepository,
  InMemoryLocationRepository,
  InMemoryPlaceRepository,
  StubGeocoder,
} from "./in-memory.js";
import { TEST_AUDIENCE, TEST_ISSUER, TEST_SECRET } from "./token.js";

/** Builds the full HTTP app on in-memory adapters. */
export async function buildTestApp() {
  const clock = new FakeClock(new Date("2026-09-12T10:00:00Z"));
  const locations = new InMemoryLocationRepository();
  const places = new InMemoryPlaceRepository([
    { id: "a", name: "Cafe A", position: coordinates(48.8566, 2.3522), metadata: {} },
    { id: "b", name: "Cafe B", position: coordinates(48.8600, 2.3600), metadata: { tag: "x" } },
    { id: "c", name: "Far away", position: coordinates(51.5074, -0.1278), metadata: {} },
  ]);
  const geofenceEvents = new InMemoryGeofenceEventRepository();
  const geocoder = new StubGeocoder({ label: "Paris, France", position: coordinates(48.8566, 2.3522), provider: "stub" });
  let healthy = true;

  const app = await buildServer(
    {
      updateLocation: new UpdateLocation(locations, DEFAULT_FIX_POLICY, clock),
      userData: new UserLocationData(locations, geofenceEvents),
      findNearby: new FindNearby(places, 50_000),
      geocode: new GeocodeService(new ResilientGeocoder(geocoder), new MemoryCache(), 60),
      recordEvents: new RecordGeofenceEvents(geofenceEvents),
      healthCheck: async () => healthy,
    },
    { auth: { issuer: TEST_ISSUER, audience: TEST_AUDIENCE, secret: TEST_SECRET }, logLevel: "silent" },
  );

  return { app, clock, locations, places, geofenceEvents, geocoder, setHealthy: (h: boolean) => (healthy = h) };
}
