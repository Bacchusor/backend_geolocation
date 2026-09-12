import type { FastifyPluginAsync } from "fastify";
import { coordinates } from "../../domain/coordinates.js";
import { locationFix } from "../../domain/location.js";
import type { UpdateLocation } from "../../application/update-location.js";
import type { UserLocationData } from "../../application/user-data.js";
import { updateLocationBody } from "../schemas.js";

export interface LocationRouteDeps {
  updateLocation: UpdateLocation;
  userData: UserLocationData;
}

export const locationRoutes: FastifyPluginAsync<LocationRouteDeps> = async (app, deps) => {
  app.post(
    "/location",
    { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = updateLocationBody.parse(request.body);
      const raw = "fixes" in body ? body.fixes : [body];
      const fixes = raw.map((f) =>
        locationFix({ position: coordinates(f.lat, f.lng), accuracyM: f.accuracy, recordedAt: f.timestamp }),
      );
      const result = await deps.updateLocation.execute(request.user.id, fixes);
      return reply.status(200).send({
        accepted: result.accepted,
        rejected: result.rejected,
        currentUpdated: result.currentUpdated,
        current: result.current && {
          lat: result.current.position.lat,
          lng: result.current.position.lng,
          accuracy: result.current.accuracyM,
          recordedAt: result.current.recordedAt.toISOString(),
          updatedAt: result.current.updatedAt.toISOString(),
        },
      });
    },
  );

  app.get("/location", async (request, reply) => {
    const data = await deps.userData.exportAll(request.user.id);
    if (!data.current) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "no current position" } });
    return {
      lat: data.current.position.lat,
      lng: data.current.position.lng,
      accuracy: data.current.accuracyM,
      recordedAt: data.current.recordedAt.toISOString(),
      updatedAt: data.current.updatedAt.toISOString(),
    };
  });

  /** GDPR Art. 15: export everything stored for the caller. */
  app.get(
    "/location/export",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (request) => {
      const data = await deps.userData.exportAll(request.user.id);
      return {
        userId: request.user.id,
        exportedAt: new Date().toISOString(),
        current: data.current && {
          lat: data.current.position.lat,
          lng: data.current.position.lng,
          accuracy: data.current.accuracyM,
          recordedAt: data.current.recordedAt.toISOString(),
        },
        history: data.history.map((h) => ({
          lat: h.position.lat,
          lng: h.position.lng,
          accuracy: h.accuracyM,
          recordedAt: h.recordedAt.toISOString(),
        })),
        geofenceEvents: data.geofenceEvents.map((e) => ({
          geofenceId: e.geofenceId,
          type: e.type,
          occurredAt: e.occurredAt.toISOString(),
          lat: e.position?.lat ?? null,
          lng: e.position?.lng ?? null,
        })),
      };
    },
  );

  /** GDPR Art. 17: erase everything stored for the caller. */
  app.delete("/location", async (request, reply) => {
    await deps.userData.deleteAll(request.user.id);
    return reply.status(204).send();
  });
};
