import { z } from 'zod';
import {
  notionConfigInputSchema,
  notionConfigSchema,
  notionConsistencySchema,
  notionItemSchema,
  notionSchemaInfoSchema,
} from '@georeminder/shared';
import type { App } from '../app.js';

export async function notionRoutes(app: App): Promise<void> {
  const { notion } = app.deps;

  app.get(
    '/v1/notion/config',
    { schema: { tags: ['notion'], response: { 200: notionConfigSchema } } },
    async () => notion.getConfig(),
  );

  app.put(
    '/v1/notion/config',
    {
      schema: {
        tags: ['notion'],
        summary: 'Save Notion settings (token encrypted at rest; omit to keep)',
        body: notionConfigInputSchema,
        response: { 200: notionConfigSchema },
      },
    },
    async (r) => notion.saveConfig(r.body),
  );

  app.post(
    '/v1/notion/test',
    {
      schema: {
        tags: ['notion'],
        summary: 'Test the Notion token and database access',
        response: {
          200: z.object({
            ok: z.boolean(),
            user: z.string().optional(),
            database_title: z.string().optional(),
            error: z.string().optional(),
          }),
        },
      },
    },
    async () => notion.testConnection(),
  );

  app.get(
    '/v1/notion/schema',
    {
      schema: {
        tags: ['notion'],
        summary: 'Live database schema: properties and Shop/Category select options',
        response: { 200: notionSchemaInfoSchema },
      },
    },
    async () => notion.getSchema(),
  );

  app.post(
    '/v1/notion/sync',
    {
      schema: {
        tags: ['notion'],
        summary: 'Trigger a manual sync of needed items',
        response: {
          200: z.object({ ok: z.boolean(), items: z.number().int(), error: z.string().optional() }),
        },
      },
    },
    async () => notion.syncNow(),
  );

  app.get(
    '/v1/notion/items',
    {
      schema: {
        tags: ['notion'],
        summary: 'Cached needed items',
        response: { 200: z.object({ items: z.array(notionItemSchema) }) },
      },
    },
    async () => ({
      items: await notion.listItems(),
    }),
  );

  app.get(
    '/v1/notion/consistency',
    {
      schema: {
        tags: ['notion'],
        summary: 'Shop options without a place / places bound to a missing option',
        response: { 200: notionConsistencySchema },
      },
    },
    async () => notion.consistency(),
  );
}
