import { beforeEach, describe, expect, it, vi } from "vitest";
import * as certification from "./certification";
import * as db from "./db";
import * as email from "./email";
import { settlePaidOrder } from "./paid-release";
import type { Db } from "./storage";
import type { DeliveryRecord, DocumentRecord, OrderRecord, PageRecord, PaymentRecord } from "./types";
import * as webhooks from "./webhook-delivery";

const dbHandle = {} as Db;
const orderId = "order-9";

function order(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: orderId,
    customerId: "customer-1",
    userId: null,
    serviceType: "translation",
    status: "paid",
    sourceLanguage: "es",
    targetLanguage: "en",
    languageConfirmed: true,
    billablePages: 2,
    unitPriceCents: 995,
    totalCents: 1990,
    currency: "usd",
    etaAt: null,
    reviewReason: null,
    combinedOriginalPath: null,
    finalTranslationPath: "order-9/translation.pdf",
    certificationPath: "order-9/certification.pdf",
    pageOrderBasis: null,
    pageOrder: null,
    externalRef: null,
    orderType: "translation",
    service: null,
    degreeCount: null,
    evaluationCents: null,
    translationCents: null,
    includeTranslation: false,
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
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    paidAt: "2026-10-12T00:05:00.000Z",
    staffAlertSentAt: null,
    staffUrgentAlertSentAt: null,
    progress: { step: "done", pagesRead: 2, pagesTotal: 2 },
    ...patch,
  } as OrderRecord;
}

describe("settlePaidOrder", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "markOrderPaidAt").mockResolvedValue(undefined);
    vi.spyOn(db, "settledPayment").mockResolvedValue({ id: "pay-1", status: "paid", paidAt: "2026-10-12T00:05:00.000Z" } as PaymentRecord);
    vi.spyOn(db, "listDocuments").mockResolvedValue([
      { id: "doc-1", confidence: 0.96 } as DocumentRecord,
    ]);
    vi.spyOn(db, "listPages").mockResolvedValue([
      { id: "page-1", documentId: "doc-1", pageNumber: 1, needsReview: false } as PageRecord,
    ]);
    vi.spyOn(db, "listCorrections").mockResolvedValue([]);
    vi.spyOn(db, "listQaRuns").mockResolvedValue([
      { id: "qa-1", orderId, attempt: 1, status: "pass", score: 96, issues: [], createdAt: "2026-10-12T00:04:00.000Z" },
    ]);
    vi.spyOn(db, "getDelivery").mockResolvedValue({
      id: "delivery-1",
      orderId,
      status: "pending",
      finalPath: null,
      certificationPath: null,
      approvedBy: null,
      approvedAt: null,
      deliveredAt: null,
    } as DeliveryRecord);
    vi.spyOn(db, "listTranslations").mockResolvedValue([
      {
        id: "tr-1",
        documentId: "doc-1",
        version: 1,
        model: "test",
        status: "ready",
        output: { pages: [{ pageNumber: 1, paragraphs: ["Certified translation of the diploma."] }] },
      },
    ]);
    vi.spyOn(db, "claimOrderStatus").mockResolvedValue(true);
    vi.spyOn(db, "claimOrderColumn").mockResolvedValue(true);
    vi.spyOn(db, "clearOrderColumn").mockResolvedValue(undefined);
    vi.spyOn(db, "updateDelivery").mockResolvedValue(undefined);
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(db, "hasEvent").mockResolvedValue(false);
    vi.spyOn(db, "insertEvent").mockResolvedValue(undefined);
    vi.spyOn(db, "customerEmail").mockResolvedValue("ada@example.com");
    vi.spyOn(certification, "stampApprovedCover").mockResolvedValue(undefined);
    vi.spyOn(email, "sendDeliveryReady").mockResolvedValue({ sent: true, skipped: false });
    vi.spyOn(email, "sendStaffOrderAlert").mockResolvedValue({ sent: true, skipped: false });
    vi.spyOn(webhooks, "notifyOrder").mockResolvedValue(undefined);
    vi.spyOn(webhooks, "notifyLifecycle").mockResolvedValue(undefined);
    delete process.env.AUTO_RELEASE_ENABLED;
  });

  it("releases a high-confidence paid order and does not email staff", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(order());
    const schedule = vi.fn();

    const result = await settlePaidOrder(dbHandle, orderId, { scheduleUrgent: schedule });

    expect(result.fulfillment).toBe("released");
    expect(certification.stampApprovedCover).toHaveBeenCalledWith(expect.anything(), expect.anything(), null);
    expect(db.claimOrderStatus).toHaveBeenCalledWith(dbHandle, orderId, "paid", "approved");
    expect(email.sendDeliveryReady).toHaveBeenCalledWith("ada@example.com", "translation");
    expect(db.updateOrder).toHaveBeenCalledWith(dbHandle, orderId, { status: "delivered" });
    expect(email.sendStaffOrderAlert).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("alerts staff once for a low-confidence pass and arms the urgent reminder", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(order());
    vi.spyOn(db, "listQaRuns").mockResolvedValue([
      { id: "qa-1", orderId, attempt: 1, status: "pass", score: 81, issues: [], createdAt: "2026-10-12T00:04:00.000Z" },
    ]);
    const schedule = vi.fn();

    const result = await settlePaidOrder(dbHandle, orderId, { scheduleUrgent: schedule });

    expect(result.fulfillment).toBe("awaiting_review");
    expect(email.sendStaffOrderAlert).toHaveBeenCalledTimes(1);
    expect(email.sendStaffOrderAlert).toHaveBeenCalledWith(
      ["support@credpronto.com", "guyp@mail.grokbot.com"],
      expect.objectContaining({ urgent: false, orderId, billablePages: 2, totalCents: 1990 }),
    );
    expect(schedule).toHaveBeenCalledWith(orderId);
    expect(certification.stampApprovedCover).not.toHaveBeenCalled();

    vi.spyOn(db, "getOrderById").mockResolvedValue(order({ staffAlertSentAt: "2026-10-12T00:06:00.000Z" }));
    await settlePaidOrder(dbHandle, orderId, { scheduleUrgent: schedule });
    expect(email.sendStaffOrderAlert).toHaveBeenCalledTimes(1);
  });

  it("holds a high-confidence order for staff when auto-release is off", async () => {
    process.env.AUTO_RELEASE_ENABLED = "false";
    vi.spyOn(db, "getOrderById").mockResolvedValue(order());

    const result = await settlePaidOrder(dbHandle, orderId, { scheduleUrgent: false });

    expect(result.fulfillment).toBe("awaiting_review");
    expect(email.sendStaffOrderAlert).toHaveBeenCalledTimes(1);
    expect(certification.stampApprovedCover).not.toHaveBeenCalled();
  });

  it("waits without an alert when the certified file is not stored yet", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      order({ finalTranslationPath: null, certificationPath: null }),
    );
    vi.spyOn(db, "listQaRuns").mockResolvedValue([]);

    const result = await settlePaidOrder(dbHandle, orderId, { scheduleUrgent: false });

    expect(result.fulfillment).toBe("awaiting_review");
    expect(email.sendStaffOrderAlert).not.toHaveBeenCalled();
    expect(certification.stampApprovedCover).not.toHaveBeenCalled();
  });
});
