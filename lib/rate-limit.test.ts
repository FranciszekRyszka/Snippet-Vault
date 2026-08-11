import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

// A fixed base time so tests are deterministic (we pass `now` explicitly rather
// than relying on Date.now()).
const T0 = 1_000_000;

describe("createRateLimiter", () => {
  it("allows attempts up to the limit, then blocks", () => {
    const rl = createRateLimiter({ max: 3, windowMs: 60_000 });
    // Three failures are allowed (isLimited is checked BEFORE the attempt).
    expect(rl.isLimited("ip", T0).limited).toBe(false);
    rl.recordFailure("ip", T0);
    rl.recordFailure("ip", T0 + 1);
    expect(rl.isLimited("ip", T0 + 2).limited).toBe(false);
    rl.recordFailure("ip", T0 + 2);
    // The third failure reaches the limit → blocked.
    const res = rl.isLimited("ip", T0 + 3);
    expect(res.limited).toBe(true);
    expect(res.retryAfterMs).toBeGreaterThan(0);
  });

  it("frees a key once the window slides past its failures", () => {
    const rl = createRateLimiter({ max: 2, windowMs: 60_000 });
    rl.recordFailure("ip", T0);
    rl.recordFailure("ip", T0 + 10);
    expect(rl.isLimited("ip", T0 + 20).limited).toBe(true);
    // Just after the oldest failure (T0) ages out, only one failure remains.
    expect(rl.isLimited("ip", T0 + 60_001).limited).toBe(false);
    // After both age out the key is dropped entirely.
    expect(rl.isLimited("ip", T0 + 60_011).limited).toBe(false);
    expect(rl.size()).toBe(0);
  });

  it("keeps distinct keys in separate buckets", () => {
    const rl = createRateLimiter({ max: 1, windowMs: 60_000 });
    rl.recordFailure("a", T0);
    expect(rl.isLimited("a", T0).limited).toBe(true);
    expect(rl.isLimited("b", T0).limited).toBe(false);
  });

  it("reports a shrinking retryAfter as the window slides", () => {
    const rl = createRateLimiter({ max: 1, windowMs: 60_000 });
    rl.recordFailure("ip", T0);
    const early = rl.isLimited("ip", T0 + 10_000).retryAfterMs;
    const later = rl.isLimited("ip", T0 + 50_000).retryAfterMs;
    expect(early).toBeGreaterThan(later);
    expect(later).toBeGreaterThan(0);
  });

  it("bounds memory by evicting the oldest key past maxKeys", () => {
    const rl = createRateLimiter({ max: 5, windowMs: 60_000, maxKeys: 3 });
    rl.recordFailure("k1", T0);
    rl.recordFailure("k2", T0);
    rl.recordFailure("k3", T0);
    expect(rl.size()).toBe(3);
    // A fourth distinct key evicts the oldest-inserted (k1).
    rl.recordFailure("k4", T0);
    expect(rl.size()).toBe(3);
    expect(rl.isLimited("k1", T0).limited).toBe(false); // k1 was evicted
    expect(rl.isLimited("k4", T0).limited).toBe(false); // present, under limit
  });
});
