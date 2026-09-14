import { asc, eq } from 'drizzle-orm';
import type { Place } from '@georeminder/shared';
import type { Db } from '../db/client.js';
import { channels } from '../db/schema.js';
import { HomeAssistantClient, haSlugify, type HaZone } from '../integrations/home-assistant.js';
import { listPlaces, setPlaceZone } from './repos.js';
import type { SecretBox } from '../crypto.js';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';

export interface ZoneSyncSummary {
  synced: number;
  removed: number;
  errors: Array<{ place_id: string; error: string }>;
  warning: string | null;
}

/**
 * Mirrors active places as Home Assistant zones so the Companion app's OS geofences match the map.
 * Uses the first configured Home Assistant channel's URL/token.
 */
export class ZoneSync {
  constructor(
    private readonly db: Db,
    private readonly secrets: SecretBox,
    private readonly config: Pick<Config, 'HA_ZONE_SYNC' | 'HA_ZONE_PREFIX' | 'HA_ZONE_WARN_LIMIT'>,
    private readonly log: Logger,
  ) {}

  async client(): Promise<HomeAssistantClient | null> {
    if (!this.config.HA_ZONE_SYNC) return null;
    const [row] = await this.db
      .select()
      .from(channels)
      .where(eq(channels.type, 'home_assistant'))
      .orderBy(asc(channels.created_at))
      .limit(1);
    if (!row?.secret_enc) return null;
    const baseUrl = String((row.config as Record<string, unknown>).base_url ?? '');
    if (!baseUrl) return null;
    return new HomeAssistantClient(baseUrl, this.secrets.decrypt(row.secret_enc));
  }

  zoneName(place: Place): string {
    return `${this.config.HA_ZONE_PREFIX}${place.name}`.trim();
  }

  entityId(place: Place): string {
    return `zone.${haSlugify(this.zoneName(place))}`;
  }

  private zoneInput(place: Place) {
    return {
      name: this.zoneName(place),
      latitude: place.lat,
      longitude: place.lng,
      radius: place.enter_radius_m,
      icon: place.icon.startsWith('mdi:') ? place.icon : 'mdi:map-marker',
      passive: false,
    };
  }

  /** Create/update the zone for an active place, delete it for an inactive one. Never throws. */
  async syncPlace(place: Place): Promise<Place> {
    const ha = await this.client();
    if (!ha) return place;
    try {
      if (!place.active) {
        if (place.ha_zone_id) await ha.deleteZone(place.ha_zone_id).catch(ignoreNotFound);
        await setPlaceZone(this.db, place.id, {
          ha_zone_id: null,
          ha_zone_entity_id: null,
          error: null,
        });
        return { ...place, ha_zone_id: null, ha_zone_entity_id: null, ha_zone_error: null };
      }
      let zone: HaZone | null = null;
      if (place.ha_zone_id) {
        zone = await ha.updateZone(place.ha_zone_id, this.zoneInput(place)).catch((err) => {
          if (isNotFound(err)) return null;
          throw err;
        });
      }
      if (!zone) {
        // Adopt an existing zone with the same name (e.g. after a DB restore) before creating one.
        const existing = (await ha.listZones()).find((z) => z.name === this.zoneName(place));
        zone = existing
          ? await ha.updateZone(existing.id, this.zoneInput(place))
          : await ha.createZone(this.zoneInput(place));
      }
      const entity = this.entityId(place);
      await setPlaceZone(this.db, place.id, {
        ha_zone_id: zone.id,
        ha_zone_entity_id: entity,
        error: null,
      });
      this.log.info({ place: place.id, zone: entity }, 'HA zone synced');
      return {
        ...place,
        ha_zone_id: zone.id,
        ha_zone_entity_id: entity,
        ha_zone_error: null,
        ha_zone_synced_at: new Date().toISOString(),
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.log.warn({ place: place.id, err: error }, 'HA zone sync failed');
      await setPlaceZone(this.db, place.id, {
        ha_zone_id: place.ha_zone_id,
        ha_zone_entity_id: place.ha_zone_entity_id,
        error,
      }).catch(() => undefined);
      return { ...place, ha_zone_error: error };
    }
  }

  async removePlace(place: Place): Promise<void> {
    const ha = await this.client();
    if (!ha || !place.ha_zone_id) return;
    await ha.deleteZone(place.ha_zone_id).catch((err) => {
      if (!isNotFound(err))
        this.log.warn({ place: place.id, err: String(err) }, 'HA zone delete failed');
    });
  }

  async syncAll(): Promise<ZoneSyncSummary> {
    const all = await listPlaces(this.db);
    const active = all.filter((p) => p.active);
    const summary: ZoneSyncSummary = { synced: 0, removed: 0, errors: [], warning: null };
    if (active.length > this.config.HA_ZONE_WARN_LIMIT) {
      summary.warning = `${active.length} active places exceed the ~${this.config.HA_ZONE_WARN_LIMIT} geofence limit of iOS devices; deactivate some places.`;
      this.log.warn(summary.warning);
    }
    if (!(await this.client()))
      return {
        ...summary,
        warning: summary.warning ?? 'no Home Assistant channel configured; zone sync skipped',
      };
    for (const place of all) {
      const res = await this.syncPlace(place);
      if (res.ha_zone_error) summary.errors.push({ place_id: place.id, error: res.ha_zone_error });
      else if (place.active) summary.synced += 1;
      else if (place.ha_zone_id) summary.removed += 1;
    }
    return summary;
  }

  async listZones(): Promise<HaZone[]> {
    const ha = await this.client();
    return ha ? ha.listZones() : [];
  }
}

const isNotFound = (err: unknown) =>
  err instanceof Error && /not_found|not found|404/i.test(err.message);
const ignoreNotFound = (err: unknown) => {
  if (!isNotFound(err)) throw err;
};
