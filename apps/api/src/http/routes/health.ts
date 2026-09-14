import { z } from 'zod';
import type { App } from '../app.js';
import { checkDb } from '../../db/client.js';

const started = Date.now();

export async function healthRoutes(app: App): Promise<void> {
  app.get(
    '/v1/health',
    {
      config: { auth: 'public' },
      schema: {
        tags: ['ops'],
        summary: 'Liveness',
        response: {
          200: z.object({ status: z.literal('ok'), uptime_s: z.number(), version: z.string() }),
        },
      },
    },
    async () => ({
      status: 'ok' as const,
      uptime_s: Math.round((Date.now() - started) / 1000),
      version: process.env.APP_VERSION ?? 'dev',
    }),
  );

  app.get(
    '/v1/ready',
    {
      config: { auth: 'public' },
      schema: {
        tags: ['ops'],
        summary: 'Readiness (database + PostGIS reachable)',
        response: {
          200: z.object({ status: z.literal('ready'), postgis: z.string().optional() }),
          503: z.object({ status: z.literal('not_ready'), error: z.string().optional() }),
        },
      },
    },
    async (_request, reply) => {
      const db = await checkDb(app.deps.db);
      if (!db.ok) return reply.code(503).send({ status: 'not_ready' as const, error: db.error });
      return { status: 'ready' as const, postgis: db.postgis };
    },
  );
}
