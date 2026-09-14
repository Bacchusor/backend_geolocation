import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { safeEqual } from '../crypto.js';
import type { Config } from '../config.js';

export type AuthMode = 'public' | 'any' | 'session';
export type AuthContext = { kind: 'api_key' } | { kind: 'session'; username: string };

declare module 'fastify' {
  interface FastifyContextConfig {
    auth?: AuthMode;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export const SESSION_COOKIE = 'gr_session';

export class SessionService {
  private readonly key: Uint8Array;
  constructor(
    private readonly config: Pick<
      Config,
      'JWT_SECRET' | 'SESSION_TTL_HOURS' | 'ADMIN_USERNAME' | 'ADMIN_PASSWORD'
    >,
  ) {
    this.key = new TextEncoder().encode(config.JWT_SECRET);
  }

  checkCredentials(username: string, password: string): boolean {
    return (
      safeEqual(username, this.config.ADMIN_USERNAME) &&
      safeEqual(password, this.config.ADMIN_PASSWORD)
    );
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

/** API key (machine clients) via `x-api-key` or `Authorization: Bearer`, session via httpOnly cookie. */
export function registerAuth(
  app: FastifyInstance,
  config: Pick<Config, 'API_KEY'>,
  sessions: SessionService,
): void {
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url.startsWith('/docs')) return; // OpenAPI document and Swagger UI are public (no secrets inside)
    const mode: AuthMode = request.routeOptions.config.auth ?? 'any';
    request.auth = await resolveAuth(request, config.API_KEY, sessions);
    if (mode === 'public') return;
    if (!request.auth)
      return reply.code(401).send({ error: 'unauthorized', message: 'authentication required' });
    if (mode === 'session' && request.auth.kind !== 'session') {
      return reply.code(403).send({ error: 'forbidden', message: 'admin session required' });
    }
  });
}

async function resolveAuth(
  request: FastifyRequest,
  apiKey: string,
  sessions: SessionService,
): Promise<AuthContext | null> {
  const headerKey = request.headers['x-api-key'];
  const bearer = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const presented = (typeof headerKey === 'string' ? headerKey : undefined) ?? bearer;
  if (presented && safeEqual(presented, apiKey)) return { kind: 'api_key' };
  const cookie = request.cookies?.[SESSION_COOKIE];
  if (cookie) {
    const username = await sessions.verify(cookie);
    if (username) return { kind: 'session', username };
  }
  return null;
}
