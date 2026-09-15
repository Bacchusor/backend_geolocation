import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import type { Db } from '../db/client.js';
import type { SecretBox } from '../crypto.js';
import type { Evaluator } from '../services/evaluation.js';
import type { NotionService } from '../services/notion-sync.js';
import type { ZoneSync } from '../services/ha-zones.js';
import type { ChannelFactory } from '../services/channels.js';
import type { NominatimClient } from '../integrations/nominatim.js';
import { ConflictError, NotFoundError } from '../services/repos.js';
import { HaError } from '../integrations/home-assistant.js';
import { NotionError } from '../integrations/notion.js';
import { isNotionClientError } from '@notionhq/client';
import { registerAuth, SessionService } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { locationRoutes } from './routes/location.js';
import { placeRoutes } from './routes/places.js';
import { groupRoutes } from './routes/groups.js';
import { ruleRoutes } from './routes/rules.js';
import { recipientRoutes } from './routes/recipients.js';
import { channelRoutes } from './routes/channels.js';
import { notionRoutes } from './routes/notion.js';
import { eventRoutes } from './routes/events.js';
import { geocodeRoutes } from './routes/geocode.js';
import { haRoutes } from './routes/ha.js';
import { userRoutes } from './routes/users.js';
import { ForbiddenError } from '../services/users.js';

export interface AppDeps {
  config: Config;
  log: Logger;
  db: Db;
  secrets: SecretBox;
  evaluator: Evaluator;
  notion: NotionService;
  zones: ZoneSync;
  channels: ChannelFactory;
  nominatim: NominatimClient;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
    sessions: SessionService;
  }
}

export type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  ZodTypeProvider
>;

export async function buildApp(deps: AppDeps): Promise<App> {
  const { config, log } = deps;
  const app = Fastify({
    loggerInstance: log,
    trustProxy: true,
    bodyLimit: 256 * 1024,
    disableRequestLogging: config.LOG_LEVEL !== 'debug' && config.LOG_LEVEL !== 'trace',
  }).withTypeProvider<ZodTypeProvider>() as unknown as App;

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);
  const sessions = new SessionService(config);
  app.decorate('sessions', sessions);

  await app.register(sensible);
  await app.register(cookie);
  await app.register(cors, {
    origin: config.CORS_ORIGINS.length ? config.CORS_ORIGINS : false,
    credentials: true,
  });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    allowList: (req) => req.url.startsWith('/v1/health') || req.url.startsWith('/v1/ready'),
  });
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'GeoReminder API',
        description:
          'Geolocation rules service: places, rules, Notion-backed reminders, Home Assistant delivery.',
        version: '0.1.0',
      },
      servers: [{ url: config.PUBLIC_API_URL }],
      components: {
        securitySchemes: {
          apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
          session: { type: 'apiKey', in: 'cookie', name: 'gr_session' },
        },
      },
      security: [{ apiKey: [] }, { session: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  registerAuth(app, config, sessions, deps.db);

  app.setErrorHandler((err, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: 'validation',
        message: 'request validation failed',
        details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
      });
    }
    if (isResponseSerializationError(err)) {
      request.log.error({ err }, 'response serialization failed');
      return reply.code(500).send({ error: 'internal', message: 'response serialization failed' });
    }
    if (err instanceof NotFoundError)
      return reply.code(404).send({ error: 'not_found', message: err.message });
    if (err instanceof ConflictError)
      return reply.code(409).send({ error: 'conflict', message: err.message });
    if (err instanceof ForbiddenError)
      return reply.code(403).send({ error: 'forbidden', message: err.message });
    if (err instanceof HaError || err instanceof NotionError || isNotionClientError(err)) {
      return reply.code(502).send({ error: 'upstream', message: (err as Error).message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({
        error: (err as { code?: string }).code ?? 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    request.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal', message: 'internal server error' });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(locationRoutes);
  await app.register(placeRoutes);
  await app.register(groupRoutes);
  await app.register(ruleRoutes);
  await app.register(recipientRoutes);
  await app.register(channelRoutes);
  await app.register(notionRoutes);
  await app.register(eventRoutes);
  await app.register(geocodeRoutes);
  await app.register(haRoutes);
  await app.register(userRoutes);

  return app;
}
