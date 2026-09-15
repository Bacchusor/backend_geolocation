import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@georeminder/shared';
import { safeEqual } from '../crypto.js';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { findUserByUsername } from '../services/users.js';

/**
 * public  – no auth
 * any     – API key or any active session; write methods (POST/PUT/DELETE/PATCH) additionally need
 *           an admin session or the API key unless the route sets `allowMember: true`
 * session – any active session (no API key)
 * admin   – admin session or API key
 */
export type AuthMode = 'public' | 'any' | 'session' | 'admin';
export type AuthContext =
  | { kind: 'api_key'; role: 'admin' }
  | { kind: 'session'; role: Role; username: string; user_id: string };

declare module 'fastify' {
  interface FastifyContextConfig {
    auth?: AuthMode;
    allowMember?: boolean;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export const SESSION_COOKIE = 'gr_session';

export class SessionService {
  private readonly key: Uint8Array;
  constructor(private readonly config: Pick<Config, 'JWT_SECRET' | 'SESSION_TTL_HOURS'>) {
    this.key = new TextEncoder().encode(config.JWT_SECRET);
  }

  async issue(username: string): Promise<string> {
    return new SignJWT({ sub: username })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('georeminder')
      .setExpirationTime(`${this.config.SESSION_TTL_HOURS}h`)
      .sign(this.key);
  }

  async verify(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: 'georeminder' });
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  get maxAgeSeconds(): number {
    return this.config.SESSION_TTL_HOURS * 3600;
  }
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** API key (machine clients) via `x-api-key` or `Authorization: Bearer`; session via httpOnly cookie backed by the users table. */
export function registerAuth(
  app: FastifyInstance,
  config: Pick<Config, 'API_KEY'>,
  sessions: SessionService,
  db: Db,
): void {
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url.startsWith('/docs')) return; // OpenAPI document and Swagger UI are public (no secrets inside)
    const mode: AuthMode = request.routeOptions.config.auth ?? 'any';
    request.auth = await resolveAuth(request, config.API_KEY, sessions, db);
    if (mode === 'public') return;
    const auth = request.auth;
    if (!auth)
      return reply.code(401).send({ error: 'unauthorized', message: 'authentication required' });
    if (mode === 'session' && auth.kind !== 'session') {
      return reply.code(403).send({ error: 'forbidden', message: 'a user session is required' });
    }
    const needsAdmin =
      mode === 'admin' ||
      (mode === 'any' &&
        WRITE_METHODS.has(request.method) &&
        !request.routeOptions.config.allowMember);
    if (needsAdmin && auth.role !== 'admin') {
      return reply.code(403).send({ error: 'forbidden', message: 'administrator role required' });
    }
  });
}

async function resolveAuth(
  request: FastifyRequest,
  apiKey: string,
  sessions: SessionService,
  db: Db,
): Promise<AuthContext | null> {
  const headerKey = request.headers['x-api-key'];
  const bearer = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const presented = (typeof headerKey === 'string' ? headerKey : undefined) ?? bearer;
  if (presented && safeEqual(presented, apiKey)) return { kind: 'api_key', role: 'admin' };
  const cookie = request.cookies?.[SESSION_COOKIE];
  if (cookie) {
    const username = await sessions.verify(cookie);
    if (username) {
      // Load the account on every request so role changes and deactivation apply immediately.
      const user = await findUserByUsername(db, username);
      if (user && user.active) {
        return {
          kind: 'session',
          role: user.role as Role,
          username: user.username,
          user_id: user.id,
        };
      }
    }
  }
  return null;
}
