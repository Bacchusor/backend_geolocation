import { z } from 'zod';
import { idSchema, okSchema, recipientInputSchema, recipientSchema } from '@georeminder/shared';
import type { App } from '../app.js';
import {
  createRecipient,
  deleteRecipient,
  listRecipients,
  updateRecipient,
} from '../../services/repos.js';

const params = z.object({ id: idSchema });

export async function recipientRoutes(app: App): Promise<void> {
  const { db } = app.deps;
  app.get(
    '/v1/recipients',
    {
      schema: {
        tags: ['recipients'],
        response: { 200: z.object({ items: z.array(recipientSchema) }) },
      },
    },
    async () => ({
      items: await listRecipients(db),
    }),
  );
  app.post(
    '/v1/recipients',
    {
      schema: {
        tags: ['recipients'],
        body: recipientInputSchema,
        response: { 201: recipientSchema },
      },
    },
    async (r, reply) => reply.code(201).send(await createRecipient(db, r.body)),
  );
  app.put(
    '/v1/recipients/:id',
    {
      schema: {
        tags: ['recipients'],
        params,
        body: recipientInputSchema,
        response: { 200: recipientSchema },
      },
    },
    async (r) => updateRecipient(db, r.params.id, r.body),
  );
  app.delete(
    '/v1/recipients/:id',
    { schema: { tags: ['recipients'], params, response: { 200: okSchema } } },
    async (r) => {
      await deleteRecipient(db, r.params.id);
      return { ok: true as const };
    },
  );
}
