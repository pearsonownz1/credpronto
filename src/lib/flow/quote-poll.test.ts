import { describe, expect, it } from "vitest";
import { liveReadingPercent } from "@/lib/orders/reading-progress";
import {
  QUOTE_POLL_MS,
  QUOTE_READ_TIMEOUT_MESSAGE,
  QUOTE_READ_TIMEOUT_MS,
  quotePollDelay,
  quoteReadFinished,
  quoteReadTimedOut,
  settleQuotePoll,
} from "./quote-poll";

const readingDone = { status: "draft", progress: { step: "reading" as const, pagesRead: 2, pagesTotal: 2 } };

describe("quote read poll", () => {
  it("keeps polling a draft stuck at the 60% reading plateau", () => {
    expect(liveReadingPercent(readingDone.progress)).toBe(60);
    expect(quoteReadFinished(readingDone)).toBe(false);
    expect(quotePollDelay(readingDone)).toBe(QUOTE_POLL_MS);
    expect(
      settleQuotePoll({ order: readingDone, elapsedMs: 1_000, error: null }),
    ).toEqual({ kind: "order", order: readingDone, done: false });
  });

  it("does not stop after the first draft response", () => {
    const first = settleQuotePoll({
      order: { status: "draft", progress: { step: "uploaded", pagesRead: 0, pagesTotal: 0 } },
      elapsedMs: 0,
      error: null,
    });
    expect(first).toMatchObject({ kind: "order", done: false });
    const second = settleQuotePoll({ order: readingDone, elapsedMs: QUOTE_POLL_MS, error: null });
    expect(second).toMatchObject({ kind: "order", done: false });
  });

  it("advances when progress.step is done, even if status is still draft", () => {
    const order = { status: "draft", progress: { step: "done", pagesRead: 2, pagesTotal: 2 } };
    expect(quoteReadFinished(order)).toBe(true);
    expect(quotePollDelay(order)).toBeNull();
    expect(settleQuotePoll({ order, elapsedMs: 8_000, error: null })).toEqual({
      kind: "order",
      order,
      done: true,
    });
  });

  it("advances when the server leaves draft", () => {
    const quoted = { status: "quoted", progress: { step: "done", pagesRead: 2, pagesTotal: 2 } };
    expect(quoteReadFinished(quoted)).toBe(true);
    expect(quotePollDelay(quoted)).toBeNull();
    expect(settleQuotePoll({ order: quoted, elapsedMs: 12_000, error: null })).toMatchObject({
      kind: "order",
      done: true,
    });
    expect(quoteReadFinished({ status: "needs_review", progress: { step: "reading" } })).toBe(true);
    expect(quoteReadFinished({ status: "failed", progress: { step: "reading" } })).toBe(true);
  });

  it("keeps polling later working statuses after the quote exists", () => {
    expect(quotePollDelay({ status: "processing", progress: { step: "translating" } })).toBe(QUOTE_POLL_MS);
    expect(quoteReadTimedOut({ status: "processing", progress: { step: "translating" } }, QUOTE_READ_TIMEOUT_MS)).toBe(
      false,
    );
  });

  it("retries a blip and then surfaces a timeout instead of hanging", () => {
    expect(
      settleQuotePoll({
        order: readingDone,
        elapsedMs: 5_000,
        error: { status: 503, message: "unavailable" },
      }),
    ).toEqual({ kind: "retry" });
    expect(quoteReadTimedOut(readingDone, QUOTE_READ_TIMEOUT_MS - 1)).toBe(false);
    expect(
      settleQuotePoll({
        order: readingDone,
        elapsedMs: QUOTE_READ_TIMEOUT_MS,
        error: null,
      }),
    ).toEqual({ kind: "error", message: QUOTE_READ_TIMEOUT_MESSAGE });
    expect(
      settleQuotePoll({
        order: readingDone,
        elapsedMs: QUOTE_READ_TIMEOUT_MS,
        error: { status: 0, message: "network" },
      }),
    ).toEqual({ kind: "error", message: QUOTE_READ_TIMEOUT_MESSAGE });
  });

  it("stops on a missing order", () => {
    expect(
      settleQuotePoll({
        order: null,
        elapsedMs: 0,
        error: { status: 404, message: "Order not found" },
      }),
    ).toEqual({ kind: "error", message: "Order not found" });
  });
});
