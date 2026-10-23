import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/orders/errors";
import { PRE_EVAL_DAILY_EMAILS, PRE_EVAL_DAILY_UPLOADS } from "./constants";
import {
  assertDailyAllowance,
  assertPreEvalBurst,
  consumePreEvalBurst,
  preEvalIpHash,
  resetPreEvalBursts,
  secondsUntilUtcDayEnd,
  utcDayStart,
} from "./rate-limit";

describe("pre-evaluation rate limit", () => {
  it("hashes the address and caps uploads, emails, and a UTC day", () => {
    resetPreEvalBursts();
    const hash = preEvalIpHash("203.0.113.10");
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain("203.0.113.10");
    expect(preEvalIpHash("203.0.113.10")).toBe(hash);

    const start = Date.parse("2026-10-23T12:00:00.000Z");
    expect(consumePreEvalBurst(hash, "upload", start).allowed).toBe(true);
    expect(consumePreEvalBurst(hash, "upload", start + 1).allowed).toBe(true);
    expect(consumePreEvalBurst(hash, "upload", start + 2).allowed).toBe(true);
    expect(consumePreEvalBurst(hash, "upload", start + 3).allowed).toBe(false);
    expect(() => assertPreEvalBurst(hash, "upload", start + 4)).toThrow(HttpError);

    expect(consumePreEvalBurst(hash, "email", start).allowed).toBe(true);
    for (let attempt = 0; attempt < 4; attempt += 1) consumePreEvalBurst(hash, "email", start + attempt);
    expect(consumePreEvalBurst(hash, "email", start + 5).allowed).toBe(false);

    expect(() => assertDailyAllowance(PRE_EVAL_DAILY_UPLOADS - 1, "upload", new Date(start))).not.toThrow();
    expect(() => assertDailyAllowance(PRE_EVAL_DAILY_UPLOADS, "upload", new Date(start))).toThrow(/Daily/);
    expect(() => assertDailyAllowance(PRE_EVAL_DAILY_EMAILS, "email", new Date(start))).toThrow(HttpError);

    expect(utcDayStart(new Date("2026-10-23T23:30:00.000Z"))).toBe("2026-10-23T00:00:00.000Z");
    expect(secondsUntilUtcDayEnd(new Date("2026-10-23T23:30:00.000Z"))).toBe(30 * 60);
    resetPreEvalBursts();
  });
});
