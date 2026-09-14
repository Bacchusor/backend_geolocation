import { z } from 'zod';
import { channelInputSchema, channelSchema, idSchema, okSchema } from '@georeminder/shared';
import type { App } from '../app.js';
import {
  createChannel,
  deleteChannel,
  getChannelRow,
  listChannels,
  recordChannelTest,
  rowToChannel,
  updateChannel,
} from '../../services/repos.js';

const params = z.object({ id: idSchema });

export async function channelRoutes(app: App): Promise<void> {
  const { db, secrets, channels } = app.deps;

  app.get(
    '/v1/channels',
    {
      schema: {
        tags: ['channels'],
        response: { 200: z.object({ items: z.array(channelSchema) }) },
      },
    },
    async () => ({
      items: await listChannels(db),
    }),
  );
  app.get(
    '/v1/channels/:id',
    { schema: { tags: ['channels'], params, response: { 200: channelSchema } } },
    async (r) => rowToChannel(await getChannelRow(db, r.params.id)),
  );
  app.post(
    '/v1/channels',
    {
      schema: {
        tags: ['channels'],
        summary: 'Create a channel (secrets are encrypted at rest and never returned)',
        body: channelInputSchema,
        response: { 201: channelSchema },
      },
    },
    async (r, reply) => reply.code(201).send(await createChannel(db, r.body, secrets)),
  );
  app.put(
    '/v1/channels/:id',
    {
      schema: {
        tags: ['channels'],
        summary: 'Update a channel (omit the token to keep the stored one)',
        params,
        body: channelInputSchema,
        response: { 200: channelSchema },
      },
    },
    async (r) => updateChannel(db, r.params.id, r.body, secrets),
  );
  app.delete(
    '/v1/channels/:id',
    { schema: { tags: ['channels'], params, response: { 200: okSchema } } },
    async (r) => {
      await deleteChannel(db, r.params.id);
      return { ok: true as const };
    },
  );

  app.post(
    '/v1/channels/:id/test',
    {
      schema: {
        tags: ['channels'],
        summary: 'Test the connection (Home Assistant: GET /api/)',
        params,
        response: {
          200: z.object({
            ok: z.boolean(),
            message: z.string().optional(),
            error: z.string().optional(),
          }),
        },
      },
    },
    async (r) => {
      const row = await getChannelRow(db, r.params.id);
      const result = await channels.build(row).test();
      await recordChannelTest(db, row.id, result.ok, result.ok ? null : (result.error ?? 'failed'));
      return result;
    },
  );

  app.get(
    '/v1/channels/:id/targets',
    {
      schema: {
        tags: ['channels'],
        summary: 'Discover valid targets (Home Assistant: notify.* services)',
        params,
        response: { 200: z.object({ items: z.array(z.string()) }) },
      },
    },
    async (r) => {
      const channel = channels.build(await getChannelRow(db, r.params.id));
      return { items: channel.listTargets ? await channel.listTargets() : [] };
    },
  );

  app.post(
    '/v1/channels/:id/send-test',
    {
      schema: {
        tags: ['channels'],
        summary: 'Send a test notification to a target',
        params,
        body: z.object({
          target: z.string().min(1),
          message: z.string().min(1).max(500).default('GeoReminder test notification'),
        }),
        response: { 200: z.object({ ok: z.boolean(), error: z.string().optional() }) },
      },
    },
    async (r) => {
      const channel = channels.build(await getChannelRow(db, r.params.id));
      const res = await channel.send(r.body.target, {
        title: 'GeoReminder',
        message: r.body.message,
      });
      return { ok: res.ok, ...(res.error ? { error: res.error } : {}) };
    },
  );
}
