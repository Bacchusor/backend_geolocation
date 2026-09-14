import { z } from 'zod';
import type { App } from '../app.js';

export async function geocodeRoutes(app: App): Promise<void> {
  app.get(
    '/v1/geocode/search',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['places'],
        summary: 'Address search for the admin map (Nominatim, cached, 1 req/s upstream)',
        querystring: z.object({
          q: z.string().trim().min(2).max(200),
          limit: z.coerce.number().int().min(1).max(10).default(5),
        }),
        response: {
          200: z.object({
            items: z.array(
              z.object({
                display_name: z.string(),
                lat: z.number(),
                lng: z.number(),
                type: z.string(),
                importance: z.number(),
              }),
            ),
          }),
        },
      },
    },
    async (r) => ({ items: await app.deps.nominatim.search(r.query.q, r.query.limit) }),
  );
}
