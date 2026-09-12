import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const schema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default("0.0.0.0"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    TRUST_PROXY: bool,

    DATABASE_URL: z.string().url(),
    DATABASE_SSL: bool,

    JWT_SECRET: z.string().min(32).optional(),
    JWT_JWKS_URL: z.string().url().optional(),
    JWT_ISSUER: z.string().min(1),
    JWT_AUDIENCE: z.string().min(1),

    GEOCODER_PROVIDER: z.enum(["nominatim", "mapbox"]).default("nominatim"),
    MAPBOX_ACCESS_TOKEN: z.string().optional(),
    NOMINATIM_USER_AGENT: z.string().default("backend-geolocation/0.1"),
    GEOCODE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(30 * 86_400),

    MAX_NEARBY_RADIUS_M: z.coerce.number().positive().default(50_000),
    MAX_FIX_AGE_SECONDS: z.coerce.number().positive().default(600),
    MAX_SPEED_MPS: z.coerce.number().positive().default(350),
    MAX_ACCEPTED_ACCURACY_M: z.coerce.number().positive().default(500),
    HISTORY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  })
  .refine((c) => c.JWT_SECRET || c.JWT_JWKS_URL, {
    message: "either JWT_SECRET or JWT_JWKS_URL must be set",
  })
  .refine((c) => c.GEOCODER_PROVIDER !== "mapbox" || c.MAPBOX_ACCESS_TOKEN, {
    message: "MAPBOX_ACCESS_TOKEN is required when GEOCODER_PROVIDER=mapbox",
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}
