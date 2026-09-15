import { eq, sql } from 'drizzle-orm';
import {
  roundCoord,
  type GeofenceEvent,
  type LocationFix,
  type Place,
  type Trigger,
} from '@georeminder/shared';
import type { Db } from '../db/client.js';
import { placeStates, places } from '../db/schema.js';
import { geoPoint } from '../db/geo.js';
import {
  EMPTY_STATE,
  forceTransition,
  stepPlaceState,
  type PlaceState,
  type StepResult,
} from '../domain/geofence.js';
import { checkPlausibility } from '../domain/plausibility.js';
import { isWithinWindow, startOfLocalDay } from '../domain/time-window.js';
import { renderMessage } from '../domain/template.js';
import { countNotifiedSince, lastNotifiedAt, logEvent } from './events.js';
import { getCurrentLocation, upsertCurrentLocation } from './locations.js';
import {
  findPlaceByZone,
  getPlace,
  rowToPlace,
  rulesForPlace,
  type ApplicableRule,
} from './repos.js';
import type { NotionService } from './notion-sync.js';
import type { ChannelFactory, DeliveryResult } from './channels.js';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';

export interface EvaluationDeps {
  db: Db;
  config: Pick<
    Config,
    | 'TZ'
    | 'MAX_SPEED_MPS'
    | 'MAX_FIX_AGE_HOURS'
    | 'EXIT_HYSTERESIS_FACTOR'
    | 'LOCATION_MIN_INTERVAL_SECONDS'
  >;
  log: Logger;
  notion: NotionService;
  channels: ChannelFactory;
  now?: () => Date;
}

export interface FixResult {
  person: string;
  status: 'accepted' | 'ignored' | 'rate_limited';
  reason?: string;
  notifications: number;
}

interface Candidate {
  place: Place;
  distance_m: number;
}

/**
 * Turns location fixes / zone events into geofence transitions, applies the rules and notifies.
 * One evaluation = a handful of indexed queries; it is well within the 200 ms budget at 50 places.
 */
export class Evaluator {
  private readonly lastAccepted = new Map<string, number>();
  private readonly now: () => Date;

  constructor(private readonly deps: EvaluationDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Per-person throttle for POST /v1/location (batches count once per person). */
  private rateLimited(person: string): boolean {
    const min = this.deps.config.LOCATION_MIN_INTERVAL_SECONDS * 1000;
    if (min <= 0) return false;
    const last = this.lastAccepted.get(person) ?? 0;
    const t = Date.now();
    if (t - last < min) return true;
    this.lastAccepted.set(person, t);
    return false;
  }

  async processBatch(fixes: LocationFix[], source = 'location'): Promise<FixResult[]> {
    // Out-of-order batches: evaluate oldest first so state transitions happen in the right order.
    const sorted = [...fixes].sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
    const throttled = new Set<string>();
    for (const person of new Set(sorted.map((f) => f.person)))
      if (this.rateLimited(person)) throttled.add(person);
    const results: FixResult[] = [];
    for (const fix of sorted) {
      if (throttled.has(fix.person)) {
        results.push({
          person: fix.person,
          status: 'rate_limited',
          reason: 'too many location updates',
          notifications: 0,
        });
        continue;
      }
      results.push(await this.processFix(fix, source));
    }
    return results;
  }

  async processFix(fix: LocationFix, source = 'location'): Promise<FixResult> {
    const { db, config, log } = this.deps;
    const now = this.now();
    const recordedAt = new Date(fix.recorded_at);
    const prev = await getCurrentLocation(db, fix.person);
    const check = checkPlausibility(
      prev ? { lat: prev.lat, lng: prev.lng, recorded_at: prev.recorded_at } : null,
      { lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy_m, recorded_at: recordedAt },
      { maxSpeedMps: config.MAX_SPEED_MPS, maxFixAgeHours: config.MAX_FIX_AGE_HOURS, now },
    );
    if (!check.ok) {
      await logEvent(db, {
        person: fix.person,
        outcome: 'ignored',
        reason: check.reason,
        source,
        created_at: now,
      });
      log.info({ person: fix.person, reason: check.reason }, 'fix ignored');
      return { person: fix.person, status: 'ignored', reason: check.reason, notifications: 0 };
    }
    await upsertCurrentLocation(db, { ...fix, recorded_at: recordedAt });
    log.debug(
      {
        person: fix.person,
        lat: roundCoord(fix.lat),
        lng: roundCoord(fix.lng),
        acc: Math.round(fix.accuracy_m),
      },
      'fix accepted',
    );

    const candidates = await this.candidates(fix.person, fix.lat, fix.lng);
    let notifications = 0;
    for (const c of candidates) {
      const prevState = await this.loadState(fix.person, c.place.id);
      const step = stepPlaceState(
        c.place,
        prevState,
        c.distance_m,
        fix.accuracy_m,
        now,
        config.EXIT_HYSTERESIS_FACTOR,
      );
      notifications += await this.applyStep(fix.person, c.place, c.distance_m, step, now, source);
    }
    return { person: fix.person, status: 'accepted', notifications };
  }

  async processGeofenceEvent(ev: GeofenceEvent): Promise<FixResult> {
    const { db, log } = this.deps;
    const now = this.now();
    const place = ev.place_id
      ? await getPlace(db, ev.place_id).catch(() => null)
      : await findPlaceByZone(db, ev.zone!);
    if (!place) {
      const reason = `unknown place ${ev.place_id ?? ev.zone}`;
      await logEvent(db, {
        person: ev.person,
        outcome: 'ignored',
        reason,
        source: 'geofence',
        created_at: now,
      });
      return { person: ev.person, status: 'ignored', reason, notifications: 0 };
    }
    if (ev.lat !== undefined && ev.lng !== undefined) {
      await upsertCurrentLocation(db, {
        person: ev.person,
        lat: ev.lat,
        lng: ev.lng,
        accuracy_m: ev.accuracy_m ?? 0,
        recorded_at: new Date(ev.recorded_at),
      }).catch((err) => log.warn({ err }, 'could not store position from zone event'));
    }
    const prevState = await this.loadState(ev.person, place.id);
    const step = forceTransition(prevState, ev.transition, now);
    const distance = ev.transition === 'enter' ? 0 : null;
    const notifications = await this.applyStep(ev.person, place, distance, step, now, 'geofence');
    return { person: ev.person, status: 'accepted', notifications };
  }

  // ---------- internals ----------

  /** Active places within reach of the fix, plus places the person is currently inside (for exits). */
  private async candidates(person: string, lat: number, lng: number): Promise<Candidate[]> {
    const pt = geoPoint(lat, lng);
    const h = this.deps.config.EXIT_HYSTERESIS_FACTOR;
    const rows = await this.deps.db
      .select({
        row: places,
        distance_m: sql<number>`ST_Distance(${places.position}, ${pt})`.as('distance_m'),
      })
      .from(places)
      .where(
        sql`${places.active} = true AND (
          ST_DWithin(${places.position}, ${pt}, ${places.approach_radius_m} * ${h}::float8)
          OR ${places.id} IN (SELECT ${placeStates.place_id} FROM ${placeStates}
                              WHERE ${placeStates.person} = ${person} AND (${placeStates.in_approach} OR ${placeStates.in_enter}))
        )`,
      )
      .orderBy(sql`distance_m`);
    return rows.map((r) => ({ place: rowToPlace(r.row), distance_m: Number(r.distance_m) }));
  }

  private async loadState(person: string, placeId: string): Promise<PlaceState> {
    const [row] = await this.deps.db
      .select()
      .from(placeStates)
      .where(sql`${placeStates.person} = ${person} AND ${placeStates.place_id} = ${placeId}`);
    return row
      ? {
          in_approach: row.in_approach,
          in_enter: row.in_enter,
          entered_at: row.entered_at,
          dwell_notified: row.dwell_notified,
        }
      : EMPTY_STATE;
  }

  private async saveState(
    person: string,
    placeId: string,
    state: PlaceState,
    distance: number | null,
  ): Promise<void> {
    const values = { ...state, last_distance_m: distance, updated_at: new Date() };
    await this.deps.db
      .insert(placeStates)
      .values({ person, place_id: placeId, ...values })
      .onConflictDoUpdate({ target: [placeStates.person, placeStates.place_id], set: values });
  }

  private async applyStep(
    person: string,
    place: Place,
    distance: number | null,
    step: StepResult,
    now: Date,
    source: string,
  ): Promise<number> {
    await this.saveState(person, place.id, step.next, distance);
    let notifications = 0;
    for (const trigger of step.transitions) {
      notifications += await this.handleTransition(person, place, trigger, distance, now, source);
    }
    return notifications;
  }

  private async handleTransition(
    person: string,
    place: Place,
    trigger: Trigger,
    distance: number | null,
    now: Date,
    source: string,
  ): Promise<number> {
    const { db, log } = this.deps;
    const rules = await rulesForPlace(db, place.id, trigger);
    const base = {
      person,
      place_id: place.id,
      place_name: place.name,
      trigger,
      distance_m: distance,
      source,
      created_at: now,
    };
    if (rules.length === 0) {
      await logEvent(db, {
        ...base,
        outcome: 'transition',
        reason: `${trigger} (no enabled ${trigger} rule for this place)`,
      });
      return 0;
    }
    let sent = 0;
    for (const rule of rules) {
      const outcome = await this.evaluateRule(person, place, rule, now);
      await logEvent(db, { ...base, rule_id: rule.id, rule_name: rule.name, ...outcome });
      if (outcome.outcome === 'notified') sent += 1;
      log.info(
        {
          person,
          place: place.name,
          rule: rule.name,
          trigger,
          outcome: outcome.outcome,
          reason: outcome.reason,
        },
        'rule evaluated',
      );
    }
    return sent;
  }

  private async evaluateRule(
    person: string,
    place: Place,
    rule: ApplicableRule,
    now: Date,
  ): Promise<{
    outcome: 'notified' | 'skipped' | 'failed';
    reason: string;
    matched_items: string[];
    delivery: Record<string, unknown> | null;
  }> {
    const { db, config, notion, channels } = this.deps;
    const skip = (reason: string) => ({
      outcome: 'skipped' as const,
      reason,
      matched_items: [],
      delivery: null,
    });

    const targets = rule.recipients.filter((r) => r.active && r.person === person);
    if (targets.length === 0)
      return skip(`no active recipient for person "${person}" on this rule`);

    const window = isWithinWindow(rule, now, config.TZ);
    if (!window.ok) return skip(window.reason ?? 'outside time window');

    if (rule.cooldown_seconds > 0) {
      const last = await lastNotifiedAt(db, rule.id, person);
      if (last && now.getTime() - last.getTime() < rule.cooldown_seconds * 1000) {
        const left = Math.ceil(
          (rule.cooldown_seconds * 1000 - (now.getTime() - last.getTime())) / 1000,
        );
        return skip(
          `cooldown: last notification ${Math.round((now.getTime() - last.getTime()) / 1000)} s ago (${left} s left)`,
        );
      }
    }
    if (rule.max_per_day > 0) {
      const today = await countNotifiedSince(db, rule.id, person, startOfLocalDay(now, config.TZ));
      if (today >= rule.max_per_day)
        return skip(`daily cap reached (${today}/${rule.max_per_day})`);
    }

    let items: Awaited<ReturnType<NotionService['itemsForPlace']>> = [];
    let notionNote = '';
    if (place.notion_shop) {
      items = await notion.itemsForPlace(place);
      const cfg = await notion.getConfig();
      if (cfg.last_sync_ok === false)
        notionNote = ` (Notion cache stale: last sync failed ${cfg.last_sync_at ?? ''})`;
      if (items.length < place.notion_min_items) {
        return skip(
          `only ${items.length} item(s) for shop "${place.notion_shop}" (min ${place.notion_min_items})${notionNote}`,
        );
      }
    }

    const message = renderMessage(place.message_template, {
      count: items.length,
      shop: place.notion_shop ?? place.name,
      place: place.name,
      person,
      items: items.map((i) => ({ name: i.name, category: i.category })),
      groupByCategory: place.group_by_category,
    });
    const deliveries: DeliveryResult[] = [];
    for (const t of targets) {
      const channel = channels.build(t.channel);
      deliveries.push(
        await channel.send(t.target, {
          title: place.notion_shop ?? place.name,
          message,
          url: place.notion_url,
          tag: `georeminder-${place.id}`,
        }),
      );
    }
    const okCount = deliveries.filter((d) => d.ok).length;
    const delivery = { message, deliveries, notion_items: items.length };
    if (okCount === 0) {
      return {
        outcome: 'failed',
        reason: `delivery failed: ${deliveries.map((d) => d.error).join('; ')}`,
        matched_items: items.map((i) => i.name),
        delivery,
      };
    }
    return {
      outcome: 'notified',
      reason: `${rule.trigger} matched; ${items.length} item(s); sent to ${okCount}/${deliveries.length} recipient(s)${notionNote}`,
      matched_items: items.map((i) => i.name),
      delivery,
    };
  }

  /** Reset state for a place (e.g. after it moves) so the next fix re-evaluates from scratch. */
  async resetPlaceStates(placeId: string): Promise<void> {
    await this.deps.db.delete(placeStates).where(eq(placeStates.place_id, placeId));
  }
}
