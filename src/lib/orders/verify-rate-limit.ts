/** Public verify reads allowed for one key inside one window. */
export const VERIFY_RATE_MAX = 30;

/** Fixed window for `VERIFY_RATE_MAX`. Counted per process. */
export const VERIFY_RATE_WINDOW_MS = 60_000;

type Bucket = { start: number; count: number };

const buckets = new Map<string, Bucket>();

export type VerifyRateDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

/** Counts one request. A full window starts over. A full bucket waits until that window ends. */
export function consumeVerifyRate(key: string, now = Date.now()): VerifyRateDecision {
  const existing = buckets.get(key);
  if (!existing || now - existing.start >= VERIFY_RATE_WINDOW_MS) {
    buckets.set(key, { start: now, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (existing.count >= VERIFY_RATE_MAX) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.start + VERIFY_RATE_WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }
  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test helper. Production callers leave the map in place. */
export function resetVerifyRate(): void {
  buckets.clear();
}
