import { ValidationError } from "../domain/errors.js";
import { type FixPolicy, type LocationFix, type UserLocation, evaluateFix } from "../domain/location.js";
import type { Clock, LocationRepository } from "../domain/ports.js";

export interface UpdateLocationResult {
  /** The user's current position after this upload (unchanged if nothing qualified). */
  current: UserLocation | null;
  currentUpdated: boolean;
  /** Fixes stored (as current or history). */
  accepted: number;
  /** Fixes dropped, with the index in the request and the reason. */
  rejected: { index: number; reason: string }[];
}

/**
 * Accepts a batch of fixes (the mobile client throttles and batches), stores
 * every trustworthy fix in history, and promotes the newest fresh, plausible
 * one to "current". Stale and out-of-order fixes are archived but never become
 * current; untrustworthy fixes are dropped and reported.
 */
export class UpdateLocation {
  constructor(
    private readonly locations: LocationRepository,
    private readonly policy: FixPolicy,
    private readonly clock: Clock,
    private readonly maxBatchSize = 100,
  ) {}

  async execute(userId: string, fixes: LocationFix[]): Promise<UpdateLocationResult> {
    if (fixes.length === 0) throw new ValidationError("at least one fix is required");
    if (fixes.length > this.maxBatchSize) {
      throw new ValidationError(`at most ${this.maxBatchSize} fixes per request`);
    }

    const now = this.clock.now();
    const previous = await this.locations.getCurrent(userId);
    const rejected: { index: number; reason: string }[] = [];
    const history: LocationFix[] = [];
    let candidate: LocationFix | null = null;

    // Newest first, so the first fix judged "current" wins.
    const ordered = fixes
      .map((fix, index) => ({ fix, index }))
      .sort((a, b) => b.fix.recordedAt.getTime() - a.fix.recordedAt.getTime());

    for (const { fix, index } of ordered) {
      const result = evaluateFix(fix, previous, now, this.policy);
      if (result.verdict === "reject") {
        rejected.push({ index, reason: result.reason });
      } else if (result.verdict === "current" && candidate === null) {
        candidate = fix;
      } else {
        history.push(fix);
      }
    }

    if (candidate === null) {
      if (history.length > 0) await this.locations.appendHistory(userId, history);
      return { current: previous, currentUpdated: false, accepted: history.length, rejected };
    }

    const current = await this.locations.saveCurrentAndHistory(userId, candidate, [candidate, ...history]);
    return { current, currentUpdated: true, accepted: history.length + 1, rejected };
  }
}
