import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/orders/errors";
import type { Db } from "@/lib/orders/storage";
import { PRE_EVAL_DAILY_EMAILS, PRE_EVAL_DAILY_UPLOADS } from "./constants";
import { assertDailyAllowance, assertPreEvalBurst, preEvalIpHash, secondsUntilUtcDayEnd, utcDayStart } from "./rate-limit";

type RateArgs = {
  p_subject_hash: string;
  p_kind: string;
  p_window_start: string;
  p_max: number;
};

function windowDb(rows: Map<string, number>, alreadyFull = false): Db {
  return {
    rpc: async (name: string, args: RateArgs) => {
      if (name !== "consume_pre_evaluation_rate_limit") return { data: null, error: { message: "unexpected" } };
      const key = `${args.p_subject_hash}|${args.p_kind}|${args.p_window_start}`;
      if (alreadyFull && !rows.has(key)) rows.set(key, args.p_max);
      const current = rows.get(key) ?? 0;
      if (current >= args.p_max) return { data: null, error: null };
      const next = current + 1;
      rows.set(key, next);
      return { data: next, error: null };
    },
  } as unknown as Db;
}

describe("pre-evaluation rate limit", () => {
  it("hashes the address and caps a UTC day", () => {
    const hash = preEvalIpHash("203.0.113.10");
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain("203.0.113.10");
    expect(preEvalIpHash("203.0.113.10")).toBe(hash);

    const start = Date.parse("2026-10-23T12:00:00.000Z");
    expect(() => assertDailyAllowance(PRE_EVAL_DAILY_UPLOADS - 1, "upload", new Date(start))).not.toThrow();
    expect(() => assertDailyAllowance(PRE_EVAL_DAILY_UPLOADS, "upload", new Date(start))).toThrow(/Daily/);
    expect(() => assertDailyAllowance(PRE_EVAL_DAILY_EMAILS, "email", new Date(start))).toThrow(HttpError);

    expect(utcDayStart(new Date("2026-10-23T23:30:00.000Z"))).toBe("2026-10-23T00:00:00.000Z");
    expect(secondsUntilUtcDayEnd(new Date("2026-10-23T23:30:00.000Z"))).toBe(30 * 60);
  });

  it("keeps the short window in the shared database instead of process memory", async () => {
    const hash = preEvalIpHash("198.51.100.8");
    const start = Date.parse("2026-10-23T12:00:00.000Z");
    const shared = new Map<string, number>();
    const first = windowDb(shared);
    const second = windowDb(shared);
    await assertPreEvalBurst(first, hash, "upload", start);
    await assertPreEvalBurst(first, hash, "upload", start + 1);
    await assertPreEvalBurst(second, hash, "upload", start + 2);
    await expect(assertPreEvalBurst(second, hash, "upload", start + 3)).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });

    const fresh = windowDb(new Map());
    await expect(assertPreEvalBurst(fresh, hash, "upload", start)).resolves.toBeUndefined();

    const full = windowDb(new Map(), true);
    await expect(assertPreEvalBurst(full, hash, "email", start)).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
  });
});
