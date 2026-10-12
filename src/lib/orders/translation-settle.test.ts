import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "./db";
import { AiUnavailableError } from "./errors";
import { recordTranslationFailure } from "./translation";
import type { Db } from "./storage";
import type { OrderRecord } from "./types";
import * as webhooks from "./webhook-delivery";

const orderId = "28492f38-1111-4111-8111-111111111111";

function order(status: OrderRecord["status"], step: OrderRecord["progress"]["step"]): OrderRecord {
  return {
    id: orderId,
    status,
    progress: { step, pagesRead: 1, pagesTotal: 1 },
  } as OrderRecord;
}

describe("recordTranslationFailure", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(db, "listCorrections").mockResolvedValue([]);
    vi.spyOn(db, "latestReadyPreview").mockResolvedValue(null);
    vi.spyOn(db, "updateOrder").mockResolvedValue(undefined);
    vi.spyOn(webhooks, "notifyOrder").mockResolvedValue(undefined);
  });

  it("writes needs_review when a processing translation times out", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(order("processing", "translating"));

    await recordTranslationFailure({} as Db, orderId, new AiUnavailableError("translation_timeout"));

    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      expect.objectContaining({
        status: "needs_review",
        review_reason: "translation_timeout",
        progress: expect.objectContaining({ step: "done" }),
      }),
    );
    expect(webhooks.notifyOrder).not.toHaveBeenCalled();
  });

  it("stores a readable reason when the quality-check row already exists", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(order("processing", "translating"));

    await recordTranslationFailure(
      {} as Db,
      orderId,
      new Error('duplicate key value violates unique constraint "order_qa_runs_order_attempt_key"'),
    );

    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      expect.objectContaining({
        status: "failed",
        review_reason: "Quality check was already recorded for this attempt.",
      }),
    );
    expect(webhooks.notifyOrder).toHaveBeenCalledWith(expect.anything(), orderId, "order.failed");
  });

  it("settles an order that is still confirmed on the translating step", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(order("confirmed", "translating"));

    await recordTranslationFailure({} as Db, orderId, new Error("The original pages are not ready to translate."));

    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      expect.objectContaining({
        status: "failed",
        review_reason: "The original pages are not ready to translate.",
      }),
    );
  });

  it("leaves a finished preview alone", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(order("preview_ready", "done"));

    await recordTranslationFailure({} as Db, orderId, new Error("late"));

    expect(db.updateOrder).not.toHaveBeenCalled();
    expect(webhooks.notifyOrder).not.toHaveBeenCalled();
  });
});
