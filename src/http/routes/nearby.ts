import type { FastifyPluginAsync } from "fastify";
import type { FindNearby } from "../../application/find-nearby.js";
import { nearbyQuery } from "../schemas.js";

export const nearbyRoutes: FastifyPluginAsync<{ findNearby: FindNearby }> = async (app, deps) => {
  app.get(
    "/nearby",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request) => {
      const q = nearbyQuery.parse(request.query);
      const { center, radiusM, results } = await deps.findNearby.execute({
        lat: q.lat,
        lng: q.lng,
        radiusM: q.radius,
        limit: q.limit,
        offset: q.offset,
      });
      return {
        center,
        radius: radiusM,
        limit: q.limit ?? 20,
        offset: q.offset ?? 0,
        results: results.map((p) => ({
          id: p.id,
          name: p.name,
          lat: p.position.lat,
          lng: p.position.lng,
          distance: p.distanceM,
          metadata: p.metadata,
        })),
      };
    },
  );
};
