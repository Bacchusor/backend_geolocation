import type { FastifyPluginAsync } from "fastify";
import { coordinates } from "../../domain/coordinates.js";
import type { GeofenceEvent } from "../../domain/geofence.js";
import type { RecordGeofenceEvents } from "../../application/record-geofence-events.js";
import { geofenceEventsBody } from "../schemas.js";

export const geofenceRoutes: FastifyPluginAsync<{ recordEvents: RecordGeofenceEvents }> = async (app, deps) => {
  app.post(
    "/geofence/events",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = geofenceEventsBody.parse(request.body);
      const events: GeofenceEvent[] = body.events.map((e) => ({
        userId: request.user.id,
        geofenceId: e.geofenceId,
        type: e.type,
        occurredAt: e.occurredAt,
        position: e.lat !== undefined && e.lng !== undefined ? coordinates(e.lat, e.lng) : null,
      }));
      const result = await deps.recordEvents.execute(events);
      return reply.status(202).send(result);
    },
  );
};
