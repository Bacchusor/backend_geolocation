import { z } from 'zod';
import {
  idSchema,
  notionItemSchema,
  okSchema,
  placeInputSchema,
  placeSchema,
} from '@georeminder/shared';
import type { App } from '../app.js';
import {
  createPlace,
  deletePlace,
  getPlace,
  listPlaces,
  updatePlace,
} from '../../services/repos.js';

const params = z.object({ id: idSchema });

export async function placeRoutes(app: App): Promise<void> {
  const { db, zones, notion, evaluator } = app.deps;

  app.get(
    '/v1/places',
    { schema: { tags: ['places'], response: { 200: z.object({ items: z.array(placeSchema) }) } } },
    async () => ({
      items: await listPlaces(db),
    }),
  );

  app.get(
    '/v1/places/:id',
    { schema: { tags: ['places'], params, response: { 200: placeSchema } } },
    async (request) => getPlace(db, request.params.id),
  );

  app.post(
    '/v1/places',
    {
      schema: {
        tags: ['places'],
        summary: 'Create a place (also creates the Home Assistant zone)',
        body: placeInputSchema,
        response: { 201: placeSchema },
      },
    },
    async (request, reply) => {
      const place = await createPlace(db, request.body);
      const synced = await zones.syncPlace(place);
      return reply.code(201).send(synced);
    },
  );

  app.put(
    '/v1/places/:id',
    {
      schema: {
        tags: ['places'],
        summary: 'Update a place (re-syncs the Home Assistant zone)',
        params,
        body: placeInputSchema,
        response: { 200: placeSchema },
      },
    },
    async (request) => {
      const before = await getPlace(db, request.params.id);
      const place = await updatePlace(db, request.params.id, request.body);
      const moved =
        before.lat !== place.lat ||
        before.lng !== place.lng ||
        before.enter_radius_m !== place.enter_radius_m ||
        before.approach_radius_m !== place.approach_radius_m;
      if (moved || !place.active) await evaluator.resetPlaceStates(place.id);
      return zones.syncPlace(place);
    },
  );

  app.delete(
    '/v1/places/:id',
    { schema: { tags: ['places'], params, response: { 200: okSchema } } },
    async (request) => {
      const place = await deletePlace(db, request.params.id);
      await zones.removePlace(place);
      return { ok: true as const };
    },
  );

  app.get(
    '/v1/places/:id/items',
    {
      schema: {
        tags: ['places'],
        summary: 'Cached Notion items that would be included for this place',
        params,
        response: { 200: z.object({ items: z.array(notionItemSchema) }) },
      },
    },
    async (request) => {
      const place = await getPlace(db, request.params.id);
      return { items: await notion.itemsForPlace(place) };
    },
  );

  app.post(
    '/v1/places/:id/zone-sync',
    {
      schema: {
        tags: ['places'],
        summary: 'Force a Home Assistant zone sync for this place',
        params,
        response: { 200: placeSchema },
      },
    },
    async (request) => zones.syncPlace(await getPlace(db, request.params.id)),
  );
}
