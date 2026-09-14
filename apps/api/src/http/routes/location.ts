import { z } from 'zod';
import {
  geofenceBodySchema,
  ingestResultSchema,
  locationBodySchema,
  nearbyPlaceSchema,
  nearbyQuerySchema,
  okSchema,
  personLocationSchema,
  personSchema,
} from '@georeminder/shared';
import type { App } from '../app.js';
import { deletePersonLocation, listCurrentLocations } from '../../services/locations.js';
import { deletePersonEvents } from '../../services/events.js';
import { nearbyPlaces } from '../../services/repos.js';

export async function locationRoutes(app: App): Promise<void> {
  const { evaluator, db } = app.deps;

  app.post(
    '/v1/location',
    {
      schema: {
        tags: ['location'],
        summary: 'Report one or more position fixes for a person and evaluate the rules',
        description:
          'Accepts a single fix or a batch (max 100). Out-of-order fixes are sorted; fixes older than the stored current position, ' +
          'implausible jumps and stale fixes are ignored. Throttled to one accepted request per person per LOCATION_MIN_INTERVAL_SECONDS.',
        body: locationBodySchema,
        response: { 200: ingestResultSchema },
      },
    },
    async (request) => {
      const fixes = Array.isArray(request.body) ? request.body : [request.body];
      const results = await evaluator.processBatch(fixes, 'location');
      return {
        accepted: results.filter((r) => r.status === 'accepted').length,
        ignored: results.filter((r) => r.status !== 'accepted').length,
        results,
      };
    },
  );

  app.post(
    '/v1/geofence/events',
    {
      schema: {
        tags: ['location'],
        summary: 'Zone enter/exit events reported by the device (Home Assistant zone triggers)',
        body: geofenceBodySchema,
        response: { 200: ingestResultSchema },
      },
    },
    async (request) => {
      const events = Array.isArray(request.body) ? request.body : [request.body];
      const results = [];
      for (const ev of events) results.push(await evaluator.processGeofenceEvent(ev));
      return {
        accepted: results.filter((r) => r.status === 'accepted').length,
        ignored: results.filter((r) => r.status !== 'accepted').length,
        results,
      };
    },
  );

  app.get(
    '/v1/nearby',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['places'],
        summary: 'Places within a radius, sorted by distance',
        querystring: nearbyQuerySchema,
        response: { 200: z.object({ items: z.array(nearbyPlaceSchema) }) },
      },
    },
    async (request) => {
      const { lat, lng, radius, limit } = request.query;
      return { items: await nearbyPlaces(db, lat, lng, radius, limit) };
    },
  );

  app.get(
    '/v1/persons',
    {
      schema: {
        tags: ['location'],
        summary: 'Current position per person (rounded to ~100 m)',
        response: { 200: z.object({ items: z.array(personLocationSchema) }) },
      },
    },
    async () => ({ items: await listCurrentLocations(db) }),
  );

  app.delete(
    '/v1/location',
    {
      schema: {
        tags: ['location'],
        summary: "Delete a person's location data (current position, geofence state and event log)",
        querystring: z.object({ person: personSchema }),
        response: { 200: z.object({ ok: z.literal(true), events_deleted: z.number().int() }) },
      },
    },
    async (request) => {
      const { person } = request.query;
      await deletePersonLocation(db, person);
      const events_deleted = await deletePersonEvents(db, person);
      request.log.info({ person }, 'person location data deleted');
      return { ok: true as const, events_deleted };
    },
  );

  app.get(
    '/v1/location/ping',
    { config: { auth: 'any' }, schema: { hide: true, response: { 200: okSchema } } },
    async () => ({ ok: true as const }),
  );
}
