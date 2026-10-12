import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TRANSLATION_TIMEOUT_REASON } from "./translation-failure";
import { onStaffReviewQueue } from "./equivalency";
import {
  TRANSLATION_STALE_MS,
  applyTranslationWatch,
  checkedProgress,
  cronAuthorized,
  isPreviewDelayed,
  progressRetries,
  translationWatchAction,
  type WatchOrder,
} from "./translation-watch";

const NOW = Date.parse("2026-10-12T12:00:00.000Z");
const STALE = new Date(NOW - TRANSLATION_STALE_MS - 1).toISOString();
const FRESH = new Date(NOW - TRANSLATION_STALE_MS).toISOString();

function order(patch: Partial<WatchOrder> = {}): WatchOrder {
  return {
    id: "order-1",
    status: "processing",
    progress: { step: "translating", pagesRead: 2, pagesTotal: 2 },
    updatedAt: STALE,
    reviewReason: null,
    service: null,
    orderType: "translation",
    ...patch,
  };
}

describe("translation watchdog", () => {
  it("retries a stale translating order once, then flags it", async () => {
    const saved: Array<{ id: string; kind: string; progress: unknown }> = [];
    const translated: string[] = [];
    let current = order();
    const first = await applyTranslationWatch({
      orders: [current],
      now: NOW,
      save: async (row, patch) => {
        saved.push({ id: row.id, kind: patch.kind, progress: patch.progress });
        current = { ...row, progress: patch.progress, updatedAt: new Date(NOW).toISOString() };
        return true;
      },
      translate: async (id) => {
        translated.push(id);
      },
    });
    expect(first).toEqual({ retried: ["order-1"], flagged: [] });
    expect(translated).toEqual(["order-1"]);
    expect(saved[0]).toMatchObject({
      kind: "retry",
      progress: { step: "translating", pagesRead: 2, pagesTotal: 2, retries: 1 },
    });

    const stillStuck = {
      ...current,
      updatedAt: new Date(NOW).toISOString(),
    };
    const second = await applyTranslationWatch({
      orders: [stillStuck],
      now: NOW + TRANSLATION_STALE_MS + 1,
      save: async (row, patch) => {
        saved.push({ id: row.id, kind: patch.kind, progress: patch.progress });
        return true;
      },
      translate: async () => {
        throw new Error("should not translate again");
      },
    });
    expect(second).toEqual({ retried: [], flagged: ["order-1"] });
    expect(saved[1]).toMatchObject({
      kind: "flag",
      progress: { step: "done", pagesRead: 2, pagesTotal: 2, retries: 1 },
    });
  });

  it("does not translate when the stale claim loses the race", async () => {
    const translated: string[] = [];
    const result = await applyTranslationWatch({
      orders: [order()],
      now: NOW,
      save: async () => false,
      translate: async (id) => {
        translated.push(id);
      },
    });
    expect(result).toEqual({ retried: [], flagged: [] });
    expect(translated).toEqual([]);
  });

  it("logs a retry failure and still reports the retry", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await applyTranslationWatch({
      orders: [order({ status: "confirmed", progress: { step: "done", pagesRead: 1, pagesTotal: 1 } })],
      now: NOW,
      save: async () => true,
      translate: async () => {
        throw new Error("model down");
      },
    });
    expect(result.retried).toEqual(["order-1"]);
    expect(error).toHaveBeenCalledWith("model down");
    error.mockRestore();
  });

  it("ignores fresh, closed, evaluation, and already flagged orders", () => {
    expect(translationWatchAction(order({ updatedAt: FRESH }), NOW)).toBe("ignore");
    expect(translationWatchAction(order({ status: "quoted" }), NOW)).toBe("ignore");
    expect(translationWatchAction(order({ status: "draft", progress: { step: "reading", pagesRead: 1, pagesTotal: 2 } }), NOW)).toBe(
      "ignore",
    );
    expect(translationWatchAction(order({ status: "preview_ready" }), NOW)).toBe("ignore");
    expect(translationWatchAction(order({ status: "needs_review", reviewReason: TRANSLATION_TIMEOUT_REASON }), NOW)).toBe(
      "ignore",
    );
    expect(translationWatchAction(order({ orderType: "evaluation", service: "diploma" }), NOW)).toBe("ignore");
    expect(translationWatchAction(order({ status: "paid", progress: { step: "done", pagesRead: 1, pagesTotal: 1 } }), NOW)).toBe(
      "ignore",
    );
  });

  it("retries open orders and leaves a paid order alone", () => {
    expect(
      translationWatchAction(
        order({ status: "confirmed", progress: { step: "done", pagesRead: 2, pagesTotal: 2 } }),
        NOW,
      ),
    ).toBe("retry");
    expect(translationWatchAction(order({ status: "paid" }), NOW)).toBe("ignore");
    expect(translationWatchAction(order({ status: "cancelled" }), NOW)).toBe("ignore");
    expect(translationWatchAction(order({ status: "delivered" }), NOW)).toBe("ignore");
    expect(translationWatchAction(order({ status: "correction_requested" }), NOW)).toBe("retry");
    expect(translationWatchAction(order({ progress: { step: "translating", pagesRead: 2, pagesTotal: 2, retries: 1 } }), NOW)).toBe(
      "flag",
    );
  });

  it("keeps page counts inside the progress check and stores retries only when positive", () => {
    expect(checkedProgress({ step: "done", pagesRead: 4, pagesTotal: 2 }, { step: "translating", retries: 0 })).toEqual({
      step: "translating",
      pagesRead: 2,
      pagesTotal: 2,
    });
    expect(checkedProgress({ step: "done", pagesRead: 1, pagesTotal: 3, retries: 1 }, { step: "translating" })).toEqual({
      step: "translating",
      pagesRead: 1,
      pagesTotal: 3,
      retries: 1,
    });
    expect(
      checkedProgress(
        { step: "translating", pagesRead: 12, pagesTotal: 12, pagesDone: 4, pagesTranslateTotal: 9 },
        { step: "translating", retries: 1 },
      ),
    ).toEqual({
      step: "translating",
      pagesRead: 12,
      pagesTotal: 12,
      pagesDone: 4,
      pagesTranslateTotal: 9,
      retries: 1,
    });
    expect(progressRetries({ retries: 2 })).toBe(2);
    expect(progressRetries({ retries: 1.5 })).toBe(0);
  });

  it("marks a preview delayed only after 4 minutes without one", () => {
    const waiting = {
      status: "processing",
      previewVersion: null,
      updatedAt: STALE,
      progress: { step: "translating", pagesRead: 1, pagesTotal: 1 },
      now: NOW,
    };
    expect(isPreviewDelayed(waiting)).toBe(true);
    expect(isPreviewDelayed({ ...waiting, updatedAt: FRESH })).toBe(false);
    expect(isPreviewDelayed({ ...waiting, updatedAt: FRESH, progress: { retries: 1 } })).toBe(true);
    expect(isPreviewDelayed({ ...waiting, previewVersion: 1 })).toBe(false);
    expect(isPreviewDelayed({ ...waiting, status: "quoted" })).toBe(false);
    expect(
      isPreviewDelayed({
        ...waiting,
        status: "needs_review",
        updatedAt: FRESH,
        reviewReason: TRANSLATION_TIMEOUT_REASON,
        progress: { step: "done", pagesRead: 1, pagesTotal: 1 },
      }),
    ).toBe(true);
    expect(
      isPreviewDelayed({
        ...waiting,
        status: "needs_review",
        reviewReason: "image_quality",
        progress: { step: "done", pagesRead: 1, pagesTotal: 1 },
      }),
    ).toBe(false);
  });

  it("requires the cron bearer secret", () => {
    expect(cronAuthorized("Bearer secret", "secret")).toBe(true);
    expect(cronAuthorized("Bearer other", "secret")).toBe(false);
    expect(cronAuthorized(null, "secret")).toBe(false);
    expect(cronAuthorized("Bearer secret", undefined)).toBe(false);
  });

  it("puts a translation timeout on the staff review queue", () => {
    expect(onStaffReviewQueue({ status: "needs_review", reviewReason: TRANSLATION_TIMEOUT_REASON })).toBe(true);
  });

  it("schedules the watchdog on the Vercel cron and widens orders_progress_chk without a new column", () => {
    const vercel = readFileSync(path.join(process.cwd(), "vercel.json"), "utf8");
    expect(vercel).toMatch(/\/api\/cron\/translation-watchdog/);
    expect(vercel).toMatch(/"crons"/);
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20261012140000_progress_translating.sql"),
      "utf8",
    );
    expect(sql).toMatch(/orders_progress_chk/);
    expect(sql).toMatch(/'translating'/);
    expect(sql).toMatch(/progress->'retries'/);
    expect(sql.toLowerCase()).not.toMatch(/add column/);
  });
});
