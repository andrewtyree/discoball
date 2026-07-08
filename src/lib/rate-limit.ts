/**
 * Rate limiting — a sliding-window limiter for sign-in attempts and the
 * expensive endpoints (export, import commit, generation runs, webhook
 * tests).
 *
 * In-memory and per-process by design: the demo runs a single instance, and
 * the `check()` contract is Redis-shaped (INCR+EXPIRE or a sorted set slot
 * straight in) when horizontal scaling arrives — see docs/ops.md. State
 * hangs off `globalThis` so dev HMR doesn't reset the counters (same trick
 * as the db client singleton).
 *
 * The core is pure: `createRateLimiter` takes an injectable clock and is
 * unit-tested without timers (tests/rate-limit.test.ts).
 */

export interface RateLimitResult {
  ok: boolean;
  /** Calls left in the window after this one (0 when denied). */
  remaining: number;
  /** How long until the oldest counted call ages out (0 when allowed). */
  retryAfterMs: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
}

/** Keys tracked per limiter before the oldest are evicted — bounds memory
 *  against key-churn abuse (e.g. spraying sign-in emails). */
const MAX_KEYS = 10_000;

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const { limit, windowMs, now = Date.now } = opts;
  const hits = new Map<string, number[]>();

  return {
    check(key: string): RateLimitResult {
      const t = now();
      const cutoff = t - windowMs;
      const kept = (hits.get(key) ?? []).filter((ts) => ts > cutoff);

      if (kept.length >= limit) {
        hits.set(key, kept);
        return { ok: false, remaining: 0, retryAfterMs: kept[0] + windowMs - t };
      }

      kept.push(t);
      // Re-inserting moves the key to the end of the Map's insertion order,
      // so eviction below always removes the least-recently-used key.
      hits.delete(key);
      hits.set(key, kept);
      if (hits.size > MAX_KEYS) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) hits.delete(oldest);
      }
      return { ok: true, remaining: limit - kept.length, retryAfterMs: 0 };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* App buckets                                                                 */
/* -------------------------------------------------------------------------- */

export const RATE_LIMITS = {
  /** Failed-or-not sign-in attempts, keyed ip:email. */
  signin: { limit: 10, windowMs: 60_000 },
  /** Record exports, keyed by user id. */
  export: { limit: 30, windowMs: 60_000 },
  /** Import commits, keyed by user id. */
  importCommit: { limit: 10, windowMs: 60 * 60_000 },
  /** Batch generation runs, keyed by user id. */
  generationRun: { limit: 30, windowMs: 60 * 60_000 },
  /** Webhook test fires + redeliveries, keyed by user id. */
  webhookTest: { limit: 30, windowMs: 60 * 60_000 },
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

const globalStore = globalThis as unknown as {
  __discoballRateLimiters?: Map<string, RateLimiter>;
};

/** Check one call against a named app bucket (process-global counters). */
export function rateLimit(bucket: RateLimitBucket, key: string): RateLimitResult {
  const limiters = (globalStore.__discoballRateLimiters ??= new Map());
  let limiter = limiters.get(bucket);
  if (!limiter) {
    limiter = createRateLimiter(RATE_LIMITS[bucket]);
    limiters.set(bucket, limiter);
  }
  return limiter.check(key);
}

/** Standard friendly message for over-limit UI feedback. */
export function rateLimitMessage(result: RateLimitResult): string {
  const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  const wait =
    seconds >= 120
      ? `about ${Math.ceil(seconds / 60)} minutes`
      : `${seconds} second${seconds === 1 ? "" : "s"}`;
  return `Too many attempts — try again in ${wait}.`;
}
