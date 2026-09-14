import { z } from 'zod';
import { eventsQuerySchema, ruleEventSchema } from '@georeminder/shared';
import type { App } from '../app.js';
import { queryEvents } from '../../services/events.js';

export async function eventRoutes(app: App): Promise<void> {
  app.get(
    '/v1/events',
    {
      schema: {
        tags: ['events'],
        summary: 'Evaluation / notification log (newest first, cursor = before_id)',
        querystring: eventsQuerySchema,
        response: {
          200: z.object({
            items: z.array(ruleEventSchema),
            next_before_id: z.number().int().nullable(),
          }),
        },
      },
    },
    async (r) => queryEvents(app.deps.db, r.query),
  );
}
