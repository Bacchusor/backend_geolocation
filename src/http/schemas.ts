import { z } from "zod";

export const latSchema = z.number().finite().min(-90).max(90);
export const lngSchema = z.number().finite().min(-180).max(180);
export const isoDateSchema = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));

export const fixSchema = z.object({
  lat: latSchema,
  lng: lngSchema,
  accuracy: z.number().finite().min(0).optional(),
  timestamp: isoDateSchema,
});

/** POST /v1/location accepts a single fix or a batch. */
export const updateLocationBody = z.union([
  fixSchema,
  z.object({ fixes: z.array(fixSchema).min(1).max(100) }),
]);

export const nearbyQuery = z.object({
  lat: z.coerce.number().pipe(latSchema),
  lng: z.coerce.number().pipe(lngSchema),
  radius: z.coerce.number().positive(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const geocodeQuery = z.object({
  q: z.string().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(10).optional(),
});

export const reverseQuery = z.object({
  lat: z.coerce.number().pipe(latSchema),
  lng: z.coerce.number().pipe(lngSchema),
});

export const geofenceEventsBody = z.object({
  events: z
    .array(
      z.object({
        geofenceId: z.string().min(1).max(128),
        type: z.enum(["enter", "exit"]),
        occurredAt: isoDateSchema,
        lat: latSchema.optional(),
        lng: lngSchema.optional(),
      }),
    )
    .min(1)
    .max(100),
});
