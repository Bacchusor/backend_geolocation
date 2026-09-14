import { z } from 'zod';
import { errorSchema, loginSchema, okSchema } from '@georeminder/shared';
import type { App } from '../app.js';
import { SESSION_COOKIE } from '../auth.js';

export async function authRoutes(app: App): Promise<void> {
  const { config } = app.deps;
  const cookieOpts = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.COOKIE_SECURE,
    path: '/',
  };

  app.post(
    '/v1/auth/login',
    {
      config: { auth: 'public', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        summary: 'Admin login (sets an httpOnly session cookie)',
        body: loginSchema,
        response: {
          200: z.object({ ok: z.literal(true), username: z.string() }),
          401: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const { username, password } = request.body;
      if (!app.sessions.checkCredentials(username, password)) {
        return reply.code(401).send({ error: 'unauthorized', message: 'invalid credentials' });
      }
      const token = await app.sessions.issue(username);
      reply.setCookie(SESSION_COOKIE, token, { ...cookieOpts, maxAge: app.sessions.maxAgeSeconds });
      return { ok: true as const, username };
    },
  );

  app.post(
    '/v1/auth/logout',
    { config: { auth: 'public' }, schema: { tags: ['auth'], response: { 200: okSchema } } },
    async (_request, reply) => {
      reply.clearCookie(SESSION_COOKIE, cookieOpts);
      return { ok: true as const };
    },
  );

  app.get(
    '/v1/auth/me',
    {
      config: { auth: 'any' },
      schema: {
        tags: ['auth'],
        response: {
          200: z.object({ kind: z.enum(['api_key', 'session']), username: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const auth = request.auth!;
      return { kind: auth.kind, username: auth.kind === 'session' ? auth.username : null };
    },
  );
}
