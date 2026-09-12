import type { Clock, LocationRepository } from "../domain/ports.js";

/** Scheduled job: delete history rows older than the retention window. */
export class PurgeHistory {
  constructor(
    private readonly locations: LocationRepository,
    private readonly retentionDays: number,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<{ deleted: number; cutoff: Date }> {
    const cutoff = new Date(this.clock.now().getTime() - this.retentionDays * 86_400_000);
    const deleted = await this.locations.purgeHistoryOlderThan(cutoff);
    return { deleted, cutoff };
  }
}
