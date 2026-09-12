import { ProviderUnavailableError } from "../../domain/errors.js";

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens. */
  failureThreshold: number;
  /** How long the circuit stays open before allowing a trial call. */
  resetTimeoutMs: number;
  now?: () => number;
}

/**
 * Minimal circuit breaker: closed → open after N consecutive failures →
 * half-open after the reset timeout (one trial call) → closed on success.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private readonly now: () => number;

  constructor(
    private readonly name: string,
    private readonly opts: CircuitBreakerOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  get state(): "closed" | "open" | "half-open" {
    if (this.openedAt === null) return "closed";
    return this.now() - this.openedAt >= this.opts.resetTimeoutMs ? "half-open" : "open";
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      throw new ProviderUnavailableError(`${this.name}: circuit open`);
    }
    try {
      const result = await fn();
      this.failures = 0;
      this.openedAt = null;
      return result;
    } catch (err) {
      this.failures += 1;
      if (this.failures >= this.opts.failureThreshold || this.state === "half-open") {
        this.openedAt = this.now();
      }
      throw err;
    }
  }
}
