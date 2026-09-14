import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: bool,
  TZ: z.string().default('Europe/Bucharest'),

  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  RUN_MIGRATIONS: z
    .string()
    .optional()
    .transform((v) => v === undefined || v === '1' || v === 'true'),

  API_KEY: z.string().min(16, 'API_KEY must be at least 16 characters'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(8, 'ADMIN_PASSWORD must be at least 8 characters'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(24 * 7),
  COOKIE_SECURE: bool,
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  PUBLIC_API_URL: z.string().default('http://localhost:3000'),

  HA_URL: z.string().default(''),
  HA_TOKEN: z.string().default(''),
  HA_ZONE_SYNC: z
    .string()
    .optional()
    .transform((v) => v === undefined || v === '1' || v === 'true'),
  HA_ZONE_PREFIX: z.string().default('GR '),
  HA_ZONE_WARN_LIMIT: z.coerce.number().int().min(1).default(20),

  NOMINATIM_URL: z.string().default('https://nominatim.openstreetmap.org'),
  NOMINATIM_USER_AGENT: z.string().default('GeoReminder/0.1 (self-hosted)'),

  LOCATION_MIN_INTERVAL_SECONDS: z.coerce.number().min(0).default(5),
  MAX_SPEED_MPS: z.coerce.number().positive().default(100),
  MAX_FIX_AGE_HOURS: z.coerce.number().positive().default(24),
  EXIT_HYSTERESIS_FACTOR: z.coerce.number().min(1).max(3).default(1.25),

  EVENT_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  RETENTION_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(60),
  NOTION_SYNC_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === undefined || v === '1' || v === 'true'),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}
