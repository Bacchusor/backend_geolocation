import type { FastifyPluginAsync } from "fastify";
import type { GeocodeService } from "../../application/geocode.js";
import { geocodeQuery, reverseQuery } from "../schemas.js";

export const geocodeRoutes: FastifyPluginAsync<{ geocode: GeocodeService }> = async (app, deps) => {
  const rateLimit = { max: 30, timeWindow: "1 minute" };

  app.get("/geocode", { config: { rateLimit } }, async (request) => {
    const q = geocodeQuery.parse(request.query);
    const results = await deps.geocode.forward(q.q, q.limit ?? 5);
    return {
      results: results.map((r) => ({ label: r.label, lat: r.position.lat, lng: r.position.lng, provider: r.provider })),
    };
  });

  app.get("/reverse", { config: { rateLimit } }, async (request, reply) => {
    const q = reverseQuery.parse(request.query);
    const r = await deps.geocode.reverse(q.lat, q.lng);
    if (!r) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "no address at this position" } });
    return { label: r.label, lat: r.position.lat, lng: r.position.lng, provider: r.provider };
  });
};
