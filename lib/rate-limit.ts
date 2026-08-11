// A tiny, dependency-free sliding-window rate limiter for the auth gate in
// proxy.ts. It runs in the Edge runtime, so it uses only Map/arrays/Date — no
// Node APIs — and keeps all state in module memory.
//
// It counts *failed* authentication attempts per key (client IP): a client that
// presents a valid token is never recorded, so honest sync traffic is never
// throttled. Only brute-force guessing against a weak token accumulates
// failures and eventually trips a 429.
//
// Caveats (documented for self-hosters):
//   * State lives in one Edge isolate. A single-instance homeserver — the whole
//     target here — shares it across all requests. It is NOT shared across
//     horizontally-scaled instances (each would keep its own window).
//   * The key must be a stable client identity. proxy.ts uses the first
//     x-forwarded-for hop, so a reverse proxy in front must set that header;
//     without it every caller falls into one shared bucket (still bounds the
//     total guess rate, just more coarsely).

export type RateLimiter = {
  // Is this key currently over the failure limit? `retryAfterMs` is how long
  // until the oldest counted failure ages out of the window (0 when not limited).
  isLimited(key: string, now?: number): { limited: boolean; retryAfterMs: number };
  // Record one failed attempt for this key at `now`.
  recordFailure(key: string, now?: number): void;
  // Test/introspection helper: number of keys currently tracked.
  size(): number;
};

export type RateLimiterOptions = {
  // Max failures allowed within the window before `isLimited` returns true.
  max: number;
  // Sliding window length in milliseconds.
  windowMs: number;
  // Hard cap on distinct keys held in memory. When exceeded, the oldest-inserted
  // key is evicted so a spray of unique IPs can't grow memory without bound.
  maxKeys?: number;
};

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const max = Math.max(1, Math.floor(opts.max));
  const windowMs = Math.max(1, Math.floor(opts.windowMs));
  const maxKeys = Math.max(1, Math.floor(opts.maxKeys ?? 5000));

  // key -> ascending list of failure timestamps still within the window.
  const hits = new Map<string, number[]>();

  // Drop timestamps older than the window; returns the surviving list (possibly
  // empty). Mutates in place for the stored array.
  function prune(list: number[], now: number): number[] {
    const cutoff = now - windowMs;
    // Failures are pushed in time order, so the first still-valid index is the
    // first entry >= cutoff — splice everything before it.
    let i = 0;
    while (i < list.length && list[i] <= cutoff) i++;
    if (i > 0) list.splice(0, i);
    return list;
  }

  return {
    isLimited(key: string, now: number = Date.now()) {
      const list = hits.get(key);
      if (!list || list.length === 0) return { limited: false, retryAfterMs: 0 };
      prune(list, now);
      if (list.length === 0) {
        hits.delete(key);
        return { limited: false, retryAfterMs: 0 };
      }
      if (list.length >= max) {
        // The oldest counted failure ages out at list[0] + windowMs.
        const retryAfterMs = Math.max(0, list[0] + windowMs - now);
        return { limited: true, retryAfterMs };
      }
      return { limited: false, retryAfterMs: 0 };
    },

    recordFailure(key: string, now: number = Date.now()) {
      let list = hits.get(key);
      if (!list) {
        // Evict the oldest-inserted key when at capacity before adding a new one.
        if (hits.size >= maxKeys) {
          const oldest = hits.keys().next().value;
          if (oldest !== undefined) hits.delete(oldest);
        }
        list = [];
        hits.set(key, list);
      }
      prune(list, now);
      list.push(now);
    },

    size() {
      return hits.size;
    },
  };
}
