import { z } from 'zod';
import type { App } from '../app.js';

export async function haRoutes(app: App): Promise<void> {
  const { zones } = app.deps;

  app.post(
    '/v1/ha/zones/sync',
    {
      schema: {
        tags: ['home-assistant'],
        summary:
          'Sync all active places to Home Assistant zones (removes zones of inactive places)',
        response: {
          200: z.object({
            synced: z.number().int(),
            removed: z.number().int(),
            errors: z.array(z.object({ place_id: z.string(), error: z.string() })),
            warning: z.string().nullable(),
          }),
        },
      },
    },
    async () => zones.syncAll(),
  );

  app.get(
    '/v1/ha/zones',
    {
      schema: {
        tags: ['home-assistant'],
        summary: 'Zones currently defined in Home Assistant',
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                latitude: z.number(),
                longitude: z.number(),
                radius: z.number(),
                icon: z.string().nullable().optional(),
                passive: z.boolean().optional(),
              }),
            ),
          }),
        },
      },
    },
    async () => ({ items: await zones.listZones() }),
  );
}
