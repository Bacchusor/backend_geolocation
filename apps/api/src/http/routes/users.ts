import { z } from 'zod';
import {
  idSchema,
  okSchema,
  passwordChangeSchema,
  profileUpdateSchema,
  userInputSchema,
  userSchema,
} from '@georeminder/shared';
import type { App } from '../app.js';
import type { AuthContext } from '../auth.js';
import {
  changePassword,
  createUser,
  deleteUser,
  getUserRow,
  listUsers,
  rowToUser,
  updateProfile,
  updateUser,
} from '../../services/users.js';

const params = z.object({ id: idSchema });

export async function userRoutes(app: App): Promise<void> {
  const { db } = app.deps;

  // ---- administrator: manage profiles ----
  app.get(
    '/v1/users',
    {
      config: { auth: 'admin' },
      schema: {
        tags: ['users'],
        summary: 'List profiles (admin)',
        response: { 200: z.object({ items: z.array(userSchema) }) },
      },
    },
    async () => ({ items: await listUsers(db) }),
  );
  app.get(
    '/v1/users/:id',
    {
      config: { auth: 'admin' },
      schema: { tags: ['users'], params, response: { 200: userSchema } },
    },
    async (r) => rowToUser(await getUserRow(db, r.params.id)),
  );
  app.post(
    '/v1/users',
    {
      config: { auth: 'admin' },
      schema: {
        tags: ['users'],
        summary: 'Create a profile (admin)',
        body: userInputSchema,
        response: { 201: userSchema },
      },
    },
    async (r, reply) => reply.code(201).send(await createUser(db, r.body)),
  );
  app.put(
    '/v1/users/:id',
    {
      config: { auth: 'admin' },
      schema: {
        tags: ['users'],
        summary: 'Update a profile (admin; omit password to keep it)',
        params,
        body: userInputSchema,
        response: { 200: userSchema },
      },
    },
    async (r) => updateUser(db, r.params.id, r.body, actorId(r.auth)),
  );
  app.delete(
    '/v1/users/:id',
    { config: { auth: 'admin' }, schema: { tags: ['users'], params, response: { 200: okSchema } } },
    async (r) => {
      await deleteUser(db, r.params.id, actorId(r.auth));
      return { ok: true as const };
    },
  );

  // ---- self-service: my profile ----
  app.get(
    '/v1/me',
    {
      config: { auth: 'session' },
      schema: { tags: ['users'], summary: 'My profile', response: { 200: userSchema } },
    },
    async (r) => rowToUser(await getUserRow(db, sessionId(r.auth))),
  );
  app.put(
    '/v1/me',
    {
      config: { auth: 'session', allowMember: true },
      schema: {
        tags: ['users'],
        summary: 'Update my display name and preferences',
        body: profileUpdateSchema,
        response: { 200: userSchema },
      },
    },
    async (r) => updateProfile(db, sessionId(r.auth), r.body),
  );
  app.put(
    '/v1/me/password',
    {
      config: { auth: 'session', allowMember: true, rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags: ['users'],
        summary: 'Change my password',
        body: passwordChangeSchema,
        response: { 200: okSchema },
      },
    },
    async (r) => {
      await changePassword(db, sessionId(r.auth), r.body.current_password, r.body.new_password);
      return { ok: true as const };
    },
  );
}

function actorId(auth: AuthContext | null): string {
  return auth?.kind === 'session' ? auth.user_id : 'api-key';
}
function sessionId(auth: AuthContext | null): string {
  if (auth?.kind !== 'session') throw new Error('session required');
  return auth.user_id;
}
