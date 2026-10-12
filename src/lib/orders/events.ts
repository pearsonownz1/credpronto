import type { OrderEventType } from "./types";

const BLOCKED_KEY = /token/i;

/** Funnel payload. Drops anything that could carry the raw order token. */
export function eventData(data: Record<string, unknown> = {}): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (BLOCKED_KEY.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}

export function isOrderEventType(value: string): value is OrderEventType {
  return [
    "landing_view",
    "upload_started",
    "upload_done",
    "quote_shown",
    "preview_ready",
    "preview_viewed",
    "checkout_started",
    "paid",
    "refunded",
    "downloaded",
  ].includes(value);
}
