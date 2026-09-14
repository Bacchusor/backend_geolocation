import { z } from 'zod';
import { idSchema, okSchema, ruleInputSchema, ruleSchema } from '@georeminder/shared';
import type { App } from '../app.js';
import { createRule, deleteRule, getRule, listRules, updateRule } from '../../services/repos.js';

const params = z.object({ id: idSchema });

export async function ruleRoutes(app: App): Promise<void> {
  const { db } = app.deps;
  app.get(
    '/v1/rules',
    { schema: { tags: ['rules'], response: { 200: z.object({ items: z.array(ruleSchema) }) } } },
    async () => ({
      items: await listRules(db),
    }),
  );
  app.get(
    '/v1/rules/:id',
    { schema: { tags: ['rules'], params, response: { 200: ruleSchema } } },
    async (r) => getRule(db, r.params.id),
  );
  app.post(
    '/v1/rules',
    { schema: { tags: ['rules'], body: ruleInputSchema, response: { 201: ruleSchema } } },
    async (r, reply) => reply.code(201).send(await createRule(db, r.body)),
  );
  app.put(
    '/v1/rules/:id',
    { schema: { tags: ['rules'], params, body: ruleInputSchema, response: { 200: ruleSchema } } },
    async (r) => updateRule(db, r.params.id, r.body),
  );
  app.delete(
    '/v1/rules/:id',
    { schema: { tags: ['rules'], params, response: { 200: okSchema } } },
    async (r) => {
      await deleteRule(db, r.params.id);
      return { ok: true as const };
    },
  );
}
