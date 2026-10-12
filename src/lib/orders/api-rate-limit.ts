/** Authenticated public-API calls allowed for one key inside one window. */
export const API_KEY_RATE_MAX = 60;

/** Fixed window for `API_KEY_RATE_MAX`. Counted per process, per key id. */
export const API_KEY_RATE_WINDOW_MS = 60_000;

type Bucket = { start: number; count: number };

const buckets = new Map<string, Bucket>();

export type ApiKeyRateDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

/** Counts one request. A full window starts over. A full bucket waits until that window ends. */
export function consumeApiKeyRate(keyId: string, now = Date.now()): ApiKeyRateDecision {
  const existing = buckets.get(keyId);
  if (!existing || now - existing.start >= API_KEY_RATE_WINDOW_MS) {
    buckets.set(keyId, { start: now, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (existing.count >= API_KEY_RATE_MAX) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.start + API_KEY_RATE_WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }
  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test helper. Production callers leave the map in place. */
export function resetApiKeyRates(): void {
  buckets.clear();
}
