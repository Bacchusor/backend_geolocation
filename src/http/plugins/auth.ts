import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { type JWTPayload, createRemoteJWKSet, jwtVerify } from "jose";

export interface AuthOptions {
  issuer: string;
  audience: string;
  /** HS256 shared secret (development / single-tenant). */
  secret?: string | undefined;
  /** JWKS endpoint of the identity provider (production). */
  jwksUrl?: string | undefined;
}

export interface AuthUser {
  id: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class UnauthorizedError extends Error {
  statusCode = 401;
  code = "UNAUTHORIZED";
}

/**
 * Verifies a Bearer JWT and exposes `request.user`. The user id is always the
 * token's `sub` claim: clients can never choose which user they write for.
 */
const authPlugin: FastifyPluginAsync<AuthOptions> = async (app, opts) => {
  const key = opts.jwksUrl
    ? createRemoteJWKSet(new URL(opts.jwksUrl))
    : new TextEncoder().encode(opts.secret);
  const algorithms = opts.jwksUrl ? ["RS256", "ES256"] : ["HS256"];

  // Declared with a placeholder so V8 keeps a stable request shape; always set by `authenticate`.
  app.decorateRequest("user", null as unknown as AuthUser);
  app.decorate("authenticate", async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedError("missing bearer token");
    const token = header.slice("Bearer ".length).trim();

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, key, {
        issuer: opts.issuer,
        audience: opts.audience,
        algorithms,
        clockTolerance: 30,
      }));
    } catch {
      throw new UnauthorizedError("invalid token");
    }
    if (typeof payload.sub !== "string" || !UUID_RE.test(payload.sub)) {
      throw new UnauthorizedError("token subject must be a user UUID");
    }
    request.user = { id: payload.sub };
  });
};

export default fp(authPlugin, { name: "auth" });
