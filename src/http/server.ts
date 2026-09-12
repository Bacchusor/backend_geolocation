import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import type { FindNearby } from "../application/find-nearby.js";
import type { GeocodeService } from "../application/geocode.js";
import type { RecordGeofenceEvents } from "../application/record-geofence-events.js";
import type { UpdateLocation } from "../application/update-location.js";
import type { UserLocationData } from "../application/user-data.js";
import { errorHandler } from "./errors.js";
import authPlugin, { type AuthOptions } from "./plugins/auth.js";
import { geocodeRoutes } from "./routes/geocode.js";
import { geofenceRoutes } from "./routes/geofence.js";
import { locationRoutes } from "./routes/location.js";
import { nearbyRoutes } from "./routes/nearby.js";

export interface ServerDeps {
  updateLocation: UpdateLocation;
  userData: UserLocationData;
  findNearby: FindNearby;
  geocode: GeocodeService;
  recordEvents: RecordGeofenceEvents;
  healthCheck: () => Promise<boolean>;
}

declare module "fastify" {
  interface FastifyContextConfig {
    /** Skip authentication for this route. */
    public?: boolean;
  }
}

export interface ServerOptions {
  auth: AuthOptions;
  logLevel?: string | undefined;
  trustProxy?: boolean | undefined;
}

/**
 * Builds the Fastify app with all use cases injected. No I/O happens here, so
 * tests can build the app with in-memory adapters and use `app.inject()`.
 */
export async function buildServer(deps: ServerDeps, opts: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: opts.logLevel ?? "info",
      // Never log query strings or bodies: they contain raw coordinates.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, path: req.url.split("?")[0] }),
      },
      redact: ["req.headers.authorization"],
    },
    trustProxy: opts.trustProxy ?? false,
    bodyLimit: 64 * 1024,
    genReqId: () => randomUUID(),
  });

  await app.register(helmet, { global: true });

  // Authenticate every route unless it opts out with `config.public`. This runs
  // before the rate limiter so limits are keyed per user, not per IP.
  await app.register(authPlugin, opts.auth);
  app.addHook("onRequest", async (request) => {
    if (request.routeOptions.config.public) return;
    await app.authenticate(request);
  });

  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
    // Authenticated requests are limited per user, anonymous ones per IP.
    keyGenerator: (req) => req.user?.id ?? req.ip,
  });
  app.setErrorHandler(errorHandler);

  app.get("/healthz", { config: { public: true, rateLimit: false } }, async (_req, reply) => {
    const ok = await deps.healthCheck().catch(() => false);
    return reply.status(ok ? 200 : 503).send({ status: ok ? "ok" : "degraded" });
  });

  await app.register(
    async (v1) => {
      await v1.register(locationRoutes, { updateLocation: deps.updateLocation, userData: deps.userData });
      await v1.register(nearbyRoutes, { findNearby: deps.findNearby });
      await v1.register(geocodeRoutes, { geocode: deps.geocode });
      await v1.register(geofenceRoutes, { recordEvents: deps.recordEvents });
    },
    { prefix: "/v1" },
  );

  return app;
}
