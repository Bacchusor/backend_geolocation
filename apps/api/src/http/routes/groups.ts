import { z } from 'zod';
import { idSchema, okSchema, placeGroupInputSchema, placeGroupSchema } from '@georeminder/shared';
import type { App } from '../app.js';
import {
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  updateGroup,
} from '../../services/repos.js';

const params = z.object({ id: idSchema });

export async function groupRoutes(app: App): Promise<void> {
  const { db } = app.deps;
  app.get(
    '/v1/place-groups',
    {
      schema: {
        tags: ['places'],
        response: { 200: z.object({ items: z.array(placeGroupSchema) }) },
      },
    },
    async () => ({
      items: await listGroups(db),
    }),
  );
  app.get(
    '/v1/place-groups/:id',
    { schema: { tags: ['places'], params, response: { 200: placeGroupSchema } } },
    async (r) => getGroup(db, r.params.id),
  );
  app.post(
    '/v1/place-groups',
    {
      schema: {
        tags: ['places'],
        body: placeGroupInputSchema,
        response: { 201: placeGroupSchema },
      },
    },
    async (r, reply) => reply.code(201).send(await createGroup(db, r.body)),
  );
  app.put(
    '/v1/place-groups/:id',
    {
      schema: {
        tags: ['places'],
        params,
        body: placeGroupInputSchema,
        response: { 200: placeGroupSchema },
      },
    },
    async (r) => updateGroup(db, r.params.id, r.body),
  );
  app.delete(
    '/v1/place-groups/:id',
    { schema: { tags: ['places'], params, response: { 200: okSchema } } },
    async (r) => {
      await deleteGroup(db, r.params.id);
      return { ok: true as const };
    },
  );
}
