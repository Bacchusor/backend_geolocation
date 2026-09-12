/**
 * Composition root: wires configuration → infrastructure → use cases → HTTP.
 * This is the only file that knows about every layer.
 */
import { FindNearby } from "./application/find-nearby.js";
import { GeocodeService } from "./application/geocode.js";
import { RecordGeofenceEvents } from "./application/record-geofence-events.js";
import { UpdateLocation } from "./application/update-location.js";
import { UserLocationData } from "./application/user-data.js";
import type { Config } from "./config.js";
import { DEFAULT_FIX_POLICY } from "./domain/location.js";
import { type Geocoder, systemClock } from "./domain/ports.js";
import { MemoryCache } from "./infrastructure/cache/memory-cache.js";
import { type DbPool, createPool } from "./infrastructure/db/pool.js";
import { PostgresGeofenceEventRepository } from "./infrastructure/db/postgres-geofence-event-repository.js";
import { PostgresLocationRepository } from "./infrastructure/db/postgres-location-repository.js";
import { PostgresPlaceRepository } from "./infrastructure/db/postgres-place-repository.js";
import { MapboxGeocoder } from "./infrastructure/geocoding/mapbox-geocoder.js";
import { NominatimGeocoder } from "./infrastructure/geocoding/nominatim-geocoder.js";
import { ResilientGeocoder } from "./infrastructure/geocoding/resilient-geocoder.js";
import { type ServerDeps, buildServer } from "./http/server.js";

function createGeocoder(config: Config): Geocoder {
  const provider =
    config.GEOCODER_PROVIDER === "mapbox"
      ? new MapboxGeocoder(config.MAPBOX_ACCESS_TOKEN!)
      : new NominatimGeocoder(config.NOMINATIM_USER_AGENT);
  return new ResilientGeocoder(provider);
}

export function createDeps(config: Config, pool: DbPool): ServerDeps {
  const locations = new PostgresLocationRepository(pool);
  const places = new PostgresPlaceRepository(pool);
  const geofenceEvents = new PostgresGeofenceEventRepository(pool);

  const policy = {
    ...DEFAULT_FIX_POLICY,
    maxFixAgeSeconds: config.MAX_FIX_AGE_SECONDS,
    maxSpeedMps: config.MAX_SPEED_MPS,
    maxAcceptedAccuracyM: config.MAX_ACCEPTED_ACCURACY_M,
  };

  return {
    updateLocation: new UpdateLocation(locations, policy, systemClock),
    userData: new UserLocationData(locations, geofenceEvents),
    findNearby: new FindNearby(places, config.MAX_NEARBY_RADIUS_M),
    geocode: new GeocodeService(createGeocoder(config), new MemoryCache(), config.GEOCODE_CACHE_TTL_SECONDS),
    recordEvents: new RecordGeofenceEvents(geofenceEvents),
    healthCheck: async () => {
      await pool.query("SELECT 1");
      return true;
    },
  };
}

export async function createApp(config: Config) {
  const pool = createPool(config.DATABASE_URL, config.DATABASE_SSL);
  const app = await buildServer(createDeps(config, pool), {
    auth: {
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      secret: config.JWT_SECRET,
      jwksUrl: config.JWT_JWKS_URL,
    },
    logLevel: config.LOG_LEVEL,
    trustProxy: config.TRUST_PROXY,
  });
  app.addHook("onClose", async () => {
    await pool.end();
  });
  return app;
}
