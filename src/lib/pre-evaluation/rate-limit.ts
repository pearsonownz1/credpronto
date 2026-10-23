import { createHash } from "node:crypto";
import { clientIp } from "@/lib/contact/rate-limit";
import { HttpError } from "@/lib/orders/errors";
import { PRE_EVAL_DAILY_EMAILS, PRE_EVAL_DAILY_UPLOADS } from "./constants";

const WINDOW_MS = 10 * 60 * 1000;
const READ_WINDOW_MS = 60_000;

const BURST_MAX = {
  upload: 3,
  email: 5,
  read: 120,
} as const;

type BurstKind = keyof typeof BURST_MAX;

type Bucket = { start: number; count: number };

const buckets = new Map<string, Bucket>();

export function resetPreEvalBursts(): void {
  buckets.clear();
}

/** Stable digest of the client address. The raw address is not stored. */
export function preEvalIpHash(ip: string): string {
  const value = ip.trim() || "unknown";
  return createHash("sha256").update(`credpronto-pre-eval\n${value}`).digest("hex");
}

export function requestIpHash(request: Request): string {
  return preEvalIpHash(clientIp(request));
}

export function utcDayStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function secondsUntilUtcDayEnd(now: Date): number {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((end - now.getTime()) / 1000));
}

export function consumePreEvalBurst(
  key: string,
  kind: BurstKind,
  now = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const windowMs = kind === "read" ? READ_WINDOW_MS : WINDOW_MS;
  const max = BURST_MAX[kind];
  const bucketKey = `${kind}:${key}`;
  const existing = buckets.get(bucketKey);
  if (!existing || now - existing.start >= windowMs) {
    buckets.set(bucketKey, { start: now, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (existing.count >= max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.start + windowMs - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }
  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function assertPreEvalBurst(key: string, kind: BurstKind, now = Date.now()): void {
  const decision = consumePreEvalBurst(key, kind, now);
  if (decision.allowed) return;
  throw new HttpError("Too many requests", 429, "rate_limited", {
    retryAfterSeconds: decision.retryAfterSeconds,
  });
}

export function assertDailyAllowance(count: number, kind: "upload" | "email", now: Date): void {
  const max = kind === "upload" ? PRE_EVAL_DAILY_UPLOADS : PRE_EVAL_DAILY_EMAILS;
  if (count < max) return;
  throw new HttpError("Daily pre-evaluation limit reached", 429, "rate_limited", {
    retryAfterSeconds: secondsUntilUtcDayEnd(now),
  });
}
