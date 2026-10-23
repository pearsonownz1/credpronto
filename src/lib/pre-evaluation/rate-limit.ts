import { createHash } from "node:crypto";
import { clientIp } from "@/lib/contact/rate-limit";
import { HttpError } from "@/lib/orders/errors";
import type { Db } from "@/lib/orders/storage";
import { PRE_EVAL_DAILY_EMAILS, PRE_EVAL_DAILY_UPLOADS, type PreEvalBurstKind } from "./constants";
import { consumePreEvalWindow } from "./db";

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

/** Counts the hit in the database so the cap holds on every instance. */
export async function assertPreEvalBurst(db: Db, key: string, kind: PreEvalBurstKind, now = Date.now()): Promise<void> {
  const decision = await consumePreEvalWindow(db, key, kind, now);
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
