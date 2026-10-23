import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as certification from "./certification";
import * as db from "./db";
import * as dispatch from "./evaluation-dispatch";
import * as email from "./email";
import * as finalEmail from "./final-email";
import { EVAL_ALERT_SIGNATURE_HEADER } from "./eval-alert-webhook";
import { runStaffAlertBackstop, settlePaidOrder } from "./paid-release";
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
    vi.spyOn(dispatch, "ensurePaidEvaluationReports").mockResolvedValue({
      status: "unchanged",
      generated: [],
      pending: [],
      failures: [],
    });
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
    vi.spyOn(finalEmail, "sendFinalCustomerEmail").mockResolvedValue({ sent: true, skipped: false });
    vi.spyOn(email, "sendStaffOrderAlert").mockResolvedValue({ sent: true, skipped: false });
    vi.spyOn(webhooks, "notifyOrder").mockResolvedValue(undefined);
    vi.spyOn(webhooks, "notifyLifecycle").mockResolvedValue(undefined);
    vi.spyOn(db, "claimEvalPaidAlert").mockResolvedValue(false);
    delete process.env.AUTO_RELEASE_ENABLED;
    delete process.env.EVAL_ALERT_WEBHOOK_URL;
    delete process.env.EVAL_ALERT_WEBHOOK_SECRET;
    delete process.env.STAFF_ALERT_EMAILS;
  });

  it("releases a high-confidence paid order and does not email staff", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(order());
    const schedule = vi.fn();

    const result = await settlePaidOrder(dbHandle, orderId, { scheduleUrgent: schedule });

    expect(result.fulfillment).toBe("released");
    expect(certification.stampApprovedCover).toHaveBeenCalledWith(expect.anything(), expect.anything(), null);
    expect(db.claimOrderStatus).toHaveBeenCalledWith(dbHandle, orderId, "paid", "approved");
    expect(finalEmail.sendFinalCustomerEmail).toHaveBeenCalledWith(dbHandle, expect.objectContaining({ id: orderId }));
    expect(db.updateOrder).toHaveBeenCalledWith(dbHandle, orderId, {
      status: "delivered",
      review_reason: null,
    });
    expect(email.sendStaffOrderAlert).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(dispatch.ensurePaidEvaluationReports).not.toHaveBeenCalled();
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

  it("queues a paid evaluation and emails staff without waiting for a generated file", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      order({
        serviceType: "evaluation",
        orderType: "evaluation",
        service: "diploma",
        degreeCount: 1,
        evaluationCents: 1995,
        translationCents: 0,
        unitPriceCents: 1995,
        totalCents: 1995,
        billablePages: null,
        finalTranslationPath: null,
        certificationPath: null,
        languageConfirmed: false,
      }),
    );
    vi.spyOn(db, "listQaRuns").mockResolvedValue([]);

    const result = await settlePaidOrder(dbHandle, orderId, { scheduleUrgent: false });

    expect(result.fulfillment).toBe("awaiting_review");
    expect(email.sendStaffOrderAlert).toHaveBeenCalledTimes(1);
    expect(email.sendStaffOrderAlert).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        urgent: false,
        orderId,
        serviceType: "evaluation",
        totalCents: 1995,
        studioUrl: expect.stringContaining(`/admin/orders/${orderId}`),
      }),
    );
    expect(db.updateOrder).toHaveBeenCalledWith(dbHandle, orderId, {
      review_reason: "Credential evaluation is reviewed by staff.",
    });
    expect(db.updateOrder).toHaveBeenCalledWith(
      dbHandle,
      orderId,
      expect.objectContaining({ evaluation_status: "under_review", under_review_at: expect.any(String) }),
    );
    expect(certification.stampApprovedCover).not.toHaveBeenCalled();
    expect(finalEmail.sendFinalCustomerEmail).not.toHaveBeenCalled();
  });

  it("puts a multi-service evaluation (service null, services list) under review after payment", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      order({
        serviceType: "evaluation",
        orderType: "evaluation",
        service: null,
        services: ["translation", "diploma", "course_by_course"],
        degreeCount: 1,
        includeTranslation: true,
        evaluationCents: 5990,
        translationCents: 2985,
        totalCents: 8975,
      } as Partial<OrderRecord>),
    );
    const schedule = vi.fn();

    const result = await settlePaidOrder(dbHandle, orderId, { scheduleUrgent: schedule });

    expect(result.fulfillment).toBe("awaiting_review");
    expect(email.sendStaffOrderAlert).toHaveBeenCalledTimes(1);
    expect(db.updateOrder).toHaveBeenCalledWith(dbHandle, orderId, {
      review_reason: "Credential evaluation is reviewed by staff.",
    });
    expect(db.updateOrder).toHaveBeenCalledWith(
      dbHandle,
      orderId,
      expect.objectContaining({ evaluation_status: "under_review", under_review_at: expect.any(String) }),
    );
    expect(schedule).not.toHaveBeenCalled();
    expect(finalEmail.sendFinalCustomerEmail).not.toHaveBeenCalled();
    expect(dispatch.ensurePaidEvaluationReports).toHaveBeenCalledWith(dbHandle, orderId);
  });

  it("emails staff once for a paid evaluation with translation and does not arm the urgent reminder", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      order({
        serviceType: "evaluation",
        orderType: "evaluation",
        service: "diploma",
        degreeCount: 1,
        includeTranslation: true,
        evaluationCents: 1995,
        translationCents: 995,
        unitPriceCents: 995,
        totalCents: 2990,
        billablePages: 1,
        sourceLanguage: null,
        finalTranslationPath: null,
        certificationPath: null,
        languageConfirmed: false,
        progress: { step: "uploaded", pagesRead: 0, pagesTotal: 0 },
      }),
    );
    vi.spyOn(db, "listQaRuns").mockResolvedValue([]);
    const schedule = vi.fn();

    const result = await settlePaidOrder(dbHandle, orderId, { scheduleUrgent: schedule });

    expect(result.fulfillment).toBe("awaiting_review");
    expect(email.sendStaffOrderAlert).toHaveBeenCalledTimes(1);
    expect(email.sendStaffOrderAlert).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ urgent: false, orderId, serviceType: "evaluation" }),
    );
    expect(schedule).not.toHaveBeenCalled();
  });

  it("does not send the urgent reminder for an evaluation the cron already told staff about", async () => {
    const paidAt = "2026-10-21T10:23:25.358Z";
    const evaluation = order({
      serviceType: "evaluation",
      orderType: "evaluation",
      service: "course_by_course",
      degreeCount: 2,
      includeTranslation: true,
      evaluationCents: 7990,
      translationCents: 995,
      unitPriceCents: 995,
      totalCents: 8985,
      billablePages: 1,
      finalTranslationPath: null,
      certificationPath: null,
      languageConfirmed: false,
      paidAt,
      staffAlertSentAt: "2026-10-21T10:23:25.809Z",
      progress: { step: "uploaded", pagesRead: 0, pagesTotal: 0 },
    });
    vi.spyOn(db, "listStaffAlertCandidates").mockResolvedValue([evaluation]);
    vi.spyOn(db, "getOrderById").mockResolvedValue(evaluation);
    vi.spyOn(db, "listQaRuns").mockResolvedValue([]);

    const result = await runStaffAlertBackstop(dbHandle, Date.parse(paidAt) + 3 * 60 * 1000);

    expect(result.urgent).toEqual([]);
    expect(email.sendStaffOrderAlert).not.toHaveBeenCalled();
  });

  it("sends one urgent reminder for a bundled evaluation after four business hours", async () => {
    const paidAt = "2026-10-19T17:00:00.000Z";
    const due = Date.parse("2026-10-19T21:00:00.000Z");
    const evaluation = order({
      serviceType: "evaluation",
      orderType: "evaluation",
      service: "diploma",
      degreeCount: 1,
      includeTranslation: true,
      evaluationCents: 1995,
      translationCents: 995,
      unitPriceCents: 995,
      totalCents: 2990,
      billablePages: 1,
      finalTranslationPath: null,
      certificationPath: null,
      languageConfirmed: false,
      paidAt,
      staffAlertSentAt: paidAt,
      progress: { step: "uploaded", pagesRead: 0, pagesTotal: 0 },
    });
    vi.spyOn(db, "listStaffAlertCandidates").mockResolvedValue([evaluation]);
    vi.spyOn(db, "getOrderById").mockResolvedValue(evaluation);
    vi.spyOn(db, "listQaRuns").mockResolvedValue([]);

    const early = await runStaffAlertBackstop(dbHandle, due - 1);
    expect(early.urgent).toEqual([]);
    expect(email.sendStaffOrderAlert).not.toHaveBeenCalled();

    const result = await runStaffAlertBackstop(dbHandle, due);

    expect(result.urgent).toEqual([orderId]);
    expect(email.sendStaffOrderAlert).toHaveBeenCalledTimes(1);
    expect(email.sendStaffOrderAlert).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ urgent: true, orderId, serviceType: "evaluation" }),
    );

    vi.mocked(email.sendStaffOrderAlert).mockClear();
    vi.spyOn(db, "getOrderById").mockResolvedValue({
      ...evaluation,
      staffUrgentAlertSentAt: new Date(due).toISOString(),
    });
    const again = await runStaffAlertBackstop(dbHandle, due + 60_000);
    expect(again.urgent).toEqual([]);
    expect(email.sendStaffOrderAlert).not.toHaveBeenCalled();
  });

  it("still sends the urgent reminder for a flagged translation", async () => {
    const paidAt = "2026-10-12T00:05:00.000Z";
    const flagged = order({
      staffAlertSentAt: "2026-10-12T00:06:00.000Z",
      paidAt,
    });
    vi.spyOn(db, "listStaffAlertCandidates").mockResolvedValue([flagged]);
    vi.spyOn(db, "getOrderById").mockResolvedValue(flagged);
    vi.spyOn(db, "listQaRuns").mockResolvedValue([
      { id: "qa-1", orderId, attempt: 1, status: "pass", score: 81, issues: [], createdAt: "2026-10-12T00:04:00.000Z" },
    ]);

    const result = await runStaffAlertBackstop(dbHandle, Date.parse(paidAt) + 3 * 60 * 1000);

    expect(result.urgent).toEqual([orderId]);
    expect(email.sendStaffOrderAlert).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ urgent: true, orderId }),
    );
  });

  it("posts one signed evaluation.paid alert when the order is paid", async () => {
    process.env.EVAL_ALERT_WEBHOOK_URL = "https://alerts.example/paid";
    process.env.EVAL_ALERT_WEBHOOK_SECRET = "test-secret";
    vi.spyOn(db, "claimEvalPaidAlert").mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const paid = order({
      serviceType: "evaluation",
      orderType: "evaluation",
      service: "course_by_course",
      degreeCount: 1,
      evaluationCents: 3995,
      translationCents: 0,
      unitPriceCents: 3995,
      totalCents: 3995,
      billablePages: null,
      finalTranslationPath: null,
      certificationPath: null,
      languageConfirmed: false,
    });
    vi.spyOn(db, "getOrderById").mockResolvedValue(paid);
    vi.spyOn(db, "listQaRuns").mockResolvedValue([]);

    const result = await settlePaidOrder(dbHandle, orderId, { scheduleUrgent: false });
    await settlePaidOrder(dbHandle, orderId, { scheduleUrgent: false });

    expect(result.fulfillment).toBe("awaiting_review");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toBeTruthy();
    if (!init) return;
    const raw = String(init.body);
    const adminUrl = email.adminStudioLink(orderId);
    expect(raw).toBe(
      JSON.stringify({
        event: "evaluation.paid",
        orderId,
        type: "course_by_course",
        customerEmail: "ada@example.com",
        paidAt: paid.paidAt,
        adminUrl,
      }),
    );
    const headers = init.headers as Record<string, string>;
    expect(headers[EVAL_ALERT_SIGNATURE_HEADER]).toBe(
      createHmac("sha256", "test-secret").update(raw).digest("hex"),
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);
    vi.unstubAllGlobals();
  });

  it("still settles the evaluation when the alert post throws", async () => {
    process.env.EVAL_ALERT_WEBHOOK_URL = "https://alerts.example/paid";
    process.env.EVAL_ALERT_WEBHOOK_SECRET = "test-secret";
    vi.spyOn(db, "claimEvalPaidAlert").mockResolvedValue(true);
    vi.stubGlobal("fetch", async () => {
      throw new Error("timed out");
    });
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      order({
        serviceType: "evaluation",
        orderType: "evaluation",
        service: "diploma",
        degreeCount: 1,
        evaluationCents: 1995,
        translationCents: 0,
        unitPriceCents: 1995,
        totalCents: 1995,
        billablePages: null,
        finalTranslationPath: null,
        certificationPath: null,
      }),
    );
    vi.spyOn(db, "listQaRuns").mockResolvedValue([]);

    await expect(settlePaidOrder(dbHandle, orderId, { scheduleUrgent: false })).resolves.toEqual({
      fulfillment: "awaiting_review",
    });
    vi.unstubAllGlobals();
  });

  it("does not post the evaluation alert for a translation", async () => {
    process.env.EVAL_ALERT_WEBHOOK_URL = "https://alerts.example/paid";
    process.env.EVAL_ALERT_WEBHOOK_SECRET = "test-secret";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(db, "getOrderById").mockResolvedValue(order());
    vi.spyOn(db, "listQaRuns").mockResolvedValue([
      { id: "qa-1", orderId, attempt: 1, status: "pass", score: 81, issues: [], createdAt: "2026-10-12T00:04:00.000Z" },
    ]);

    await settlePaidOrder(dbHandle, orderId, { scheduleUrgent: false });

    expect(email.sendStaffOrderAlert).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.claimEvalPaidAlert).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("posts the evaluation alert when no staff inbox is configured", async () => {
    process.env.EVAL_ALERT_WEBHOOK_URL = "https://alerts.example/paid";
    process.env.EVAL_ALERT_WEBHOOK_SECRET = "test-secret";
    process.env.STAFF_ALERT_EMAILS = "not-an-email";
    vi.spyOn(db, "claimEvalPaidAlert").mockResolvedValue(true);
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      order({
        serviceType: "evaluation",
        orderType: "evaluation",
        service: "diploma",
        degreeCount: 1,
        evaluationCents: 1995,
        translationCents: 0,
        unitPriceCents: 1995,
        totalCents: 1995,
        billablePages: null,
        finalTranslationPath: null,
        certificationPath: null,
      }),
    );
    vi.spyOn(db, "listQaRuns").mockResolvedValue([]);

    await settlePaidOrder(dbHandle, orderId, { scheduleUrgent: false });

    expect(email.sendStaffOrderAlert).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
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
