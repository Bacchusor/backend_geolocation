import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { EventOutcome, RuleEvent, Trigger } from '@georeminder/shared';
import type { Db } from '../db/client.js';
import { ruleEvents } from '../db/schema.js';

export interface NewEvent {
  person: string;
  place_id?: string | null;
  place_name?: string | null;
  rule_id?: string | null;
  rule_name?: string | null;
  trigger?: Trigger | null;
  outcome: EventOutcome;
  reason: string;
  distance_m?: number | null;
  matched_items?: string[];
  delivery?: Record<string, unknown> | null;
  source: string;
  created_at?: Date;
}

export async function logEvent(db: Db, e: NewEvent): Promise<number> {
  const [row] = await db
    .insert(ruleEvents)
    .values({
      person: e.person,
      place_id: e.place_id ?? null,
      place_name: e.place_name ?? null,
      rule_id: e.rule_id ?? null,
      rule_name: e.rule_name ?? null,
      trigger: e.trigger ?? null,
      outcome: e.outcome,
      reason: e.reason,
      distance_m: e.distance_m ?? null,
      matched_items: e.matched_items ?? [],
      delivery: e.delivery ?? null,
      source: e.source,
      ...(e.created_at ? { created_at: e.created_at } : {}),
    })
    .returning({ id: ruleEvents.id });
  return row!.id;
}

export interface EventsQuery {
  person?: string;
  place?: string;
  rule?: string;
  outcome?: EventOutcome;
  from?: string;
  to?: string;
  limit: number;
  before_id?: number;
}

const rowToEvent = (r: typeof ruleEvents.$inferSelect): RuleEvent => ({
  id: r.id,
  created_at: r.created_at.toISOString(),
  person: r.person,
  place_id: r.place_id,
  place_name: r.place_name,
  rule_id: r.rule_id,
  rule_name: r.rule_name,
  trigger: r.trigger as Trigger | null,
  outcome: r.outcome as EventOutcome,
  reason: r.reason,
  distance_m: r.distance_m,
  matched_items: (r.matched_items as string[]) ?? [],
  delivery: (r.delivery as Record<string, unknown> | null) ?? null,
  source: r.source,
});

export async function queryEvents(
  db: Db,
  q: EventsQuery,
): Promise<{ items: RuleEvent[]; next_before_id: number | null }> {
  const conds = [
    q.person ? eq(ruleEvents.person, q.person) : undefined,
    q.place ? eq(ruleEvents.place_id, q.place) : undefined,
    q.rule ? eq(ruleEvents.rule_id, q.rule) : undefined,
    q.outcome ? eq(ruleEvents.outcome, q.outcome) : undefined,
    q.from ? gte(ruleEvents.created_at, new Date(q.from)) : undefined,
    q.to ? lte(ruleEvents.created_at, new Date(q.to)) : undefined,
    q.before_id ? lt(ruleEvents.id, q.before_id) : undefined,
  ].filter((c): c is NonNullable<typeof c> => !!c);
  const rows = await db
    .select()
    .from(ruleEvents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(ruleEvents.id))
    .limit(q.limit + 1);
  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  return {
    items: page.map(rowToEvent),
    next_before_id: hasMore ? page[page.length - 1]!.id : null,
  };
}

/** Most recent successful notification for (rule, person), used for cooldown. */
export async function lastNotifiedAt(db: Db, ruleId: string, person: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: ruleEvents.created_at })
    .from(ruleEvents)
    .where(
      and(
        eq(ruleEvents.rule_id, ruleId),
        eq(ruleEvents.person, person),
        eq(ruleEvents.outcome, 'notified'),
      ),
    )
    .orderBy(desc(ruleEvents.created_at))
    .limit(1);
  return row?.at ?? null;
}

export async function countNotifiedSince(
  db: Db,
  ruleId: string,
  person: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ruleEvents)
    .where(
      and(
        eq(ruleEvents.rule_id, ruleId),
        eq(ruleEvents.person, person),
        eq(ruleEvents.outcome, 'notified'),
        gte(ruleEvents.created_at, since),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function purgeEvents(db: Db, olderThanDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const rows = await db
    .delete(ruleEvents)
    .where(lt(ruleEvents.created_at, cutoff))
    .returning({ id: ruleEvents.id });
  return rows.length;
}

export async function deletePersonEvents(db: Db, person: string): Promise<number> {
  const rows = await db
    .delete(ruleEvents)
    .where(eq(ruleEvents.person, person))
    .returning({ id: ruleEvents.id });
  return rows.length;
}
