import { describe, expect, it } from "vitest";

import { createRateLimiter, rateLimitMessage } from "@/lib/rate-limit";

function clock(start = 0) {
  let t = start;
  return {
    now: () => t,
    tick: (ms: number) => {
      t += ms;
    },
  };
}

describe("createRateLimiter", () => {
  it("allows up to the limit, then denies", () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: c.now });
    expect(limiter.check("k").ok).toBe(true);
    expect(limiter.check("k").ok).toBe(true);
    expect(limiter.check("k").ok).toBe(true);
    expect(limiter.check("k").ok).toBe(false);
  });

  it("counts remaining calls down", () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: c.now });
    expect(limiter.check("k").remaining).toBe(2);
    expect(limiter.check("k").remaining).toBe(1);
    expect(limiter.check("k").remaining).toBe(0);
  });

  it("slides: old calls age out of the window", () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: c.now });
    limiter.check("k"); // t=0
    c.tick(600);
    limiter.check("k"); // t=600
    expect(limiter.check("k").ok).toBe(false); // both still in window
    c.tick(500); // t=1100 — the t=0 call has aged out
    expect(limiter.check("k").ok).toBe(true);
    expect(limiter.check("k").ok).toBe(false); // t=600 + this one fill it again
  });

  it("reports when to retry", () => {
    const c = clock(10_000);
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    limiter.check("k");
    c.tick(400);
    const denied = limiter.check("k");
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterMs).toBe(600);
  });

  it("keys are independent", () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    expect(limiter.check("a").ok).toBe(true);
    expect(limiter.check("b").ok).toBe(true);
    expect(limiter.check("a").ok).toBe(false);
  });

  it("a denied call does not extend the lockout", () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    limiter.check("k"); // t=0
    c.tick(500);
    expect(limiter.check("k").ok).toBe(false); // denied at t=500 must not count
    c.tick(501); // t=1001 — original call aged out
    expect(limiter.check("k").ok).toBe(true);
  });
});

describe("rateLimitMessage", () => {
  it("phrases short waits in seconds and long waits in minutes", () => {
    expect(rateLimitMessage({ ok: false, remaining: 0, retryAfterMs: 900 })).toContain("1 second");
    expect(rateLimitMessage({ ok: false, remaining: 0, retryAfterMs: 45_000 })).toContain(
      "45 seconds",
    );
    expect(rateLimitMessage({ ok: false, remaining: 0, retryAfterMs: 30 * 60_000 })).toContain(
      "30 minutes",
    );
  });
});
