import { asc, eq, sql } from 'drizzle-orm';
import {
  DEFAULT_USER_PREFERENCES,
  userPreferencesSchema,
  type ProfileUpdate,
  type Role,
  type User,
  type UserInput,
  type UserPreferences,
} from '@georeminder/shared';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { ConflictError, NotFoundError } from './repos.js';
import type { Logger } from '../logger.js';

type UserRow = typeof users.$inferSelect;

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export function parsePreferences(raw: unknown): UserPreferences {
  const parsed = userPreferencesSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_USER_PREFERENCES;
}

export const rowToUser = (r: UserRow): User => ({
  id: r.id,
  username: r.username,
  display_name: r.display_name,
  role: r.role as Role,
  person: r.person,
  preferences: parsePreferences(r.preferences),
  active: r.active,
  last_login_at: r.last_login_at?.toISOString() ?? null,
  created_at: r.created_at.toISOString(),
  updated_at: r.updated_at.toISOString(),
});

export async function listUsers(db: Db): Promise<User[]> {
  return (await db.select().from(users).orderBy(asc(users.username))).map(rowToUser);
}

export async function getUserRow(db: Db, id: string): Promise<UserRow> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  if (!row) throw new NotFoundError('user', id);
  return row;
}

export async function findUserByUsername(db: Db, username: string): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`);
  return row ?? null;
}

async function assertUsernameFree(db: Db, username: string, exceptId?: string) {
  const existing = await findUserByUsername(db, username);
  if (existing && existing.id !== exceptId)
    throw new ConflictError(`username "${username}" is already taken`);
}

export async function createUser(db: Db, input: UserInput): Promise<User> {
  if (!input.password) throw new ConflictError('password is required for a new user');
  await assertUsernameFree(db, input.username);
  const [row] = await db
    .insert(users)
    .values({
      username: input.username,
      display_name: input.display_name,
      role: input.role,
      person: input.person,
      preferences: input.preferences,
      active: input.active,
      password_hash: await hashPassword(input.password),
    })
    .returning();
  return rowToUser(row!);
}

export async function updateUser(
  db: Db,
  id: string,
  input: UserInput,
  actorId: string,
): Promise<User> {
  const current = await getUserRow(db, id);
  await assertUsernameFree(db, input.username, id);
  if (current.role === 'admin' && (input.role !== 'admin' || !input.active)) {
    await assertNotLastAdmin(db, id, 'demote or deactivate');
  }
  if (id === actorId && input.role !== 'admin')
    throw new ForbiddenError('you cannot remove your own admin role');
  const [row] = await db
    .update(users)
    .set({
      username: input.username,
      display_name: input.display_name,
      role: input.role,
      person: input.person,
      preferences: input.preferences,
      active: input.active,
      ...(input.password ? { password_hash: await hashPassword(input.password) } : {}),
      updated_at: new Date(),
    })
    .where(eq(users.id, id))
    .returning();
  return rowToUser(row!);
}

export async function deleteUser(db: Db, id: string, actorId: string): Promise<void> {
  if (id === actorId) throw new ForbiddenError('you cannot delete your own account');
  const current = await getUserRow(db, id);
  if (current.role === 'admin') await assertNotLastAdmin(db, id, 'delete');
  await db.delete(users).where(eq(users.id, id));
}

async function assertNotLastAdmin(db: Db, id: string, action: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(sql`${users.role} = 'admin' AND ${users.active} = true AND ${users.id} <> ${id}`);
  if (Number(row?.n ?? 0) === 0)
    throw new ForbiddenError(`cannot ${action} the last active administrator`);
}

export async function updateProfile(db: Db, id: string, input: ProfileUpdate): Promise<User> {
  const [row] = await db
    .update(users)
    .set({
      display_name: input.display_name,
      preferences: input.preferences,
      updated_at: new Date(),
    })
    .where(eq(users.id, id))
    .returning();
  if (!row) throw new NotFoundError('user', id);
  return rowToUser(row);
}

export async function changePassword(
  db: Db,
  id: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const row = await getUserRow(db, id);
  if (!(await verifyPassword(currentPassword, row.password_hash)))
    throw new ForbiddenError('current password is incorrect');
  await db
    .update(users)
    .set({ password_hash: await hashPassword(newPassword), updated_at: new Date() })
    .where(eq(users.id, id));
}

/** Login: returns the user when the credentials match an active account. */
export async function authenticate(
  db: Db,
  username: string,
  password: string,
): Promise<User | null> {
  const row = await findUserByUsername(db, username);
  if (!row || !row.active) return null;
  if (!(await verifyPassword(password, row.password_hash))) return null;
  await db.update(users).set({ last_login_at: new Date() }).where(eq(users.id, row.id));
  return rowToUser(row);
}

/** First start: create the administrator from ADMIN_USERNAME / ADMIN_PASSWORD when no user exists. */
export async function ensureBootstrapAdmin(
  db: Db,
  username: string,
  password: string,
  log?: Logger,
): Promise<void> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  if (Number(row?.n ?? 0) > 0) return;
  await db.insert(users).values({
    username,
    display_name: 'Administrator',
    role: 'admin',
    password_hash: await hashPassword(password),
    preferences: DEFAULT_USER_PREFERENCES,
  });
  log?.info({ username }, 'created bootstrap administrator from ADMIN_USERNAME/ADMIN_PASSWORD');
}

/** Preference check used by the evaluator: false when a linked user switched notifications off. */
export async function notificationsEnabledFor(
  db: Db,
  person: string,
): Promise<{ enabled: boolean; user?: string }> {
  const rows = await db.select().from(users).where(eq(users.person, person));
  const off = rows.find(
    (r) => r.active && parsePreferences(r.preferences).notifications_enabled === false,
  );
  return off ? { enabled: false, user: off.username } : { enabled: true };
}
