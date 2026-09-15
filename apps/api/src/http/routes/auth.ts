import { z } from 'zod';
import { errorSchema, loginSchema, okSchema, userSchema } from '@georeminder/shared';
import type { App } from '../app.js';
import { SESSION_COOKIE } from '../auth.js';
import { authenticate, getUserRow, rowToUser } from '../../services/users.js';

export async function authRoutes(app: App): Promise<void> {
  const { config, db } = app.deps;
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
        summary: 'Login (sets an httpOnly session cookie)',
        body: loginSchema,
        response: { 200: z.object({ ok: z.literal(true), user: userSchema }), 401: errorSchema },
      },
    },
    async (request, reply) => {
      const { username, password } = request.body;
      const user = await authenticate(db, username, password);
      if (!user)
        return reply.code(401).send({ error: 'unauthorized', message: 'invalid credentials' });
      const token = await app.sessions.issue(user.username);
      reply.setCookie(SESSION_COOKIE, token, { ...cookieOpts, maxAge: app.sessions.maxAgeSeconds });
      return { ok: true as const, user };
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
        summary: 'Who am I (API key or session) with the profile for sessions',
        response: {
          200: z.object({
            kind: z.enum(['api_key', 'session']),
            role: z.enum(['admin', 'member']),
            user: userSchema.nullable(),
          }),
        },
      },
    },
    async (request) => {
      const auth = request.auth!;
      if (auth.kind === 'api_key')
        return { kind: 'api_key' as const, role: 'admin' as const, user: null };
      return {
        kind: 'session' as const,
        role: auth.role,
        user: rowToUser(await getUserRow(db, auth.user_id)),
      };
    },
  );
}
