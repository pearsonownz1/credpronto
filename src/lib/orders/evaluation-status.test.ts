import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "./db";
import * as email from "./email";
import { setEvaluationStatus } from "./evaluation-status";
import * as staff from "./staff";
import type { Db } from "./storage";
import type { OrderRecord } from "./types";

const dbHandle = {} as Db;

function order(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "order-1",
    customerId: "customer-1",
    userId: null,
    serviceType: "evaluation",
    status: "paid",
    sourceLanguage: "es",
    targetLanguage: "en",
    languageConfirmed: true,
    billablePages: 1,
    unitPriceCents: 995,
    totalCents: 2990,
    currency: "usd",
    etaAt: null,
    reviewReason: "Credential evaluation is reviewed by staff.",
    combinedOriginalPath: null,
    finalTranslationPath: null,
    certificationPath: null,
    pageOrderBasis: null,
    pageOrder: null,
    externalRef: null,
    orderType: "evaluation",
    service: "diploma",
    degreeCount: 1,
    evaluationCents: 1995,
    translationCents: 995,
    includeTranslation: true,
    evaluationResult: null,
    addonCents: 0,
    expedited: false,
    shippingAddress: null,
    mailStatus: null,
    mailTracking: null,
    notarizationStatus: null,
    edgeCredentialId: null,
    edgeGradingScaleId: null,
    edgeMatchMethod: null,
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
    paidAt: "2026-10-21T00:05:00.000Z",
    evaluationStatus: "under_review",
    underReviewAt: "2026-10-21T00:05:00.000Z",
    staffAlertSentAt: null,
    staffUrgentAlertSentAt: null,
    progress: { step: "done", pagesRead: 1, pagesTotal: 1 },
    ...patch,
  };
}

describe("evaluation status", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(staff, "requireStaff").mockResolvedValue({ db: dbHandle, userId: "staff-1", role: "admin" });
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(db, "customerEmail").mockResolvedValue("ada@example.com");
    vi.spyOn(email, "sendEvaluationStatus").mockResolvedValue({ sent: true, skipped: false });
  });

  it("emails the customer when staff move the stage and keeps the earlier timestamp", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(order());
    const result = await setEvaluationStatus("order-1", { status: "performing_evaluation" });
    expect(db.updateOrder).toHaveBeenCalledWith(
      dbHandle,
      "order-1",
      expect.objectContaining({
        evaluation_status: "performing_evaluation",
        performing_evaluation_at: expect.any(String),
      }),
    );
    const patch = vi.mocked(db.updateOrder).mock.calls[0]?.[2] ?? {};
    expect(patch).not.toHaveProperty("under_review_at");
    expect(email.sendEvaluationStatus).toHaveBeenCalledWith(
      "ada@example.com",
      expect.objectContaining({ statusLabel: "Performing evaluation", orderId: "order-1" }),
    );
    expect(result.emailed).toBe(true);
    expect(result.evaluationStatus).toBe("performing_evaluation");
    expect(result.evaluationStatusAt.under_review).toBe("2026-10-21T00:05:00.000Z");
    expect(result.evaluationStatusAt.performing_evaluation).toEqual(expect.any(String));
  });

  it("does not email when the stage is already current", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(order());
    const result = await setEvaluationStatus("order-1", { status: "under_review" });
    expect(result.emailed).toBe(false);
    expect(db.updateOrder).not.toHaveBeenCalled();
    expect(email.sendEvaluationStatus).not.toHaveBeenCalled();
  });

  it("refuses a stage before payment", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(order({ status: "quoted", paidAt: null, evaluationStatus: null }));
    await expect(setEvaluationStatus("order-1", { status: "under_review" })).rejects.toThrow(/after payment/);
    expect(email.sendEvaluationStatus).not.toHaveBeenCalled();
  });
});
