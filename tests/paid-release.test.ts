import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ai from "../src/lib/orders/ai";
import * as certification from "../src/lib/orders/certification";
import * as db from "../src/lib/orders/db";
import * as dispatch from "../src/lib/orders/evaluation-dispatch";
import * as email from "../src/lib/orders/email";
import { completeEvaluation } from "../src/lib/orders/evaluation";
import * as finalEmail from "../src/lib/orders/final-email";
import * as pdf from "../src/lib/orders/pdf/evaluation";
import { settlePaidOrder } from "../src/lib/orders/paid-release";
import type { Db } from "../src/lib/orders/storage";
import * as storage from "../src/lib/orders/storage";
import type {
  DeliveryRecord,
  DocumentRecord,
  EvaluationResult,
  OrderRecord,
  PageRecord,
  PaymentRecord,
} from "../src/lib/orders/types";
import * as verification from "../src/lib/orders/verification";
import * as webhooks from "../src/lib/orders/webhook-delivery";
import type { EdgeCredentialRecord, EdgeEquivalencyRecord } from "../src/lib/orders/edge";

const dbHandle = {} as Db;
const orderId = "order-eval-release";

function credentialRow(): EdgeCredentialRecord {
  return {
    id: "cred-licence",
    countrySlug: "cameroon",
    country: "Cameroon",
    title: "Licence",
    content: "National credential.",
    levelNumber: 6,
    levelTitle: "Bachelor",
    url: null,
    usEquivalency: "Bachelor's degree",
  };
}

function equivalencyRow(): EdgeEquivalencyRecord {
  return {
    id: "eq-licence",
    edgeCredentialId: "cred-licence",
    country: "Cameroon",
    credentialTitle: "Licence",
    edgeLevel: "6",
    usEquivalency: "Bachelor's degree",
    basis: "High confidence national match.",
    confidence: "high",
  };
}

function draftOrder(): OrderRecord {
  return {
    id: orderId,
    customerId: "customer-1",
    userId: null,
    serviceType: "evaluation",
    status: "processing",
    sourceLanguage: "fr",
    targetLanguage: "en",
    languageConfirmed: false,
    billablePages: 1,
    unitPriceCents: 1995,
    totalCents: null,
    currency: "usd",
    etaAt: null,
    reviewReason: null,
    combinedOriginalPath: null,
    finalTranslationPath: null,
    certificationPath: null,
    pageOrderBasis: null,
    pageOrder: null,
    externalRef: null,
    orderType: "evaluation",
    service: "diploma",
    services: ["diploma"],
    degreeCount: 1,
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
    paidAt: null,
    staffAlertSentAt: null,
    staffUrgentAlertSentAt: null,
    progress: { step: "reading", pagesRead: 1, pagesTotal: 1 },
  } as OrderRecord;
}

function paidFromPreparation(patch: Record<string, unknown>): OrderRecord {
  return {
    ...draftOrder(),
    status: "paid",
    paidAt: "2026-10-12T00:05:00.000Z",
    languageConfirmed: true,
    sourceLanguage: "fr",
    billablePages: 1,
    evaluationCents: 1995,
    translationCents: 0,
    unitPriceCents: 1995,
    totalCents: 1995,
    reviewReason: patch.review_reason as string | null,
    serviceFiles: patch.service_files as OrderRecord["serviceFiles"],
    finalTranslationPath: (patch.final_translation_path as string | null) ?? null,
    certificationPath: (patch.certification_path as string | null) ?? null,
    evaluationResult: (patch.evaluation_result as EvaluationResult | null) ?? null,
    progress: { step: "done", pagesRead: 1, pagesTotal: 1 },
  } as OrderRecord;
}

describe("settlePaidOrder after completeEvaluation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(dispatch, "ensurePaidEvaluationReports").mockResolvedValue({
      status: "unchanged",
      generated: [],
      pending: [],
      failures: [],
    });
    vi.spyOn(db, "listDocuments").mockResolvedValue([]);
    vi.spyOn(db, "listPages").mockResolvedValue([
      { id: "page-1", documentId: "doc-1", pageNumber: 1, needsReview: false } as PageRecord,
    ]);
    vi.spyOn(db, "listCorrections").mockResolvedValue([]);
    vi.spyOn(db, "listQaRuns").mockResolvedValue([]);
    vi.spyOn(db, "nextPreviewVersion").mockResolvedValue(1);
    vi.spyOn(db, "insertPreview").mockResolvedValue("inserted");
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(db, "markPreview").mockResolvedValue(undefined);
    vi.spyOn(db, "insertEvent").mockResolvedValue(undefined);
    vi.spyOn(db, "orderCustomerEmail").mockResolvedValue(null);
    vi.spyOn(db, "markOrderPaidAt").mockResolvedValue(undefined);
    vi.spyOn(db, "settledPayment").mockResolvedValue({
      id: "pay-1",
      status: "paid",
      paidAt: "2026-10-12T00:05:00.000Z",
    } as PaymentRecord);
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
    vi.spyOn(db, "claimOrderStatus").mockResolvedValue(true);
    vi.spyOn(db, "claimOrderColumn").mockResolvedValue(true);
    vi.spyOn(db, "clearOrderColumn").mockResolvedValue(undefined);
    vi.spyOn(db, "updateDelivery").mockResolvedValue(undefined);
    vi.spyOn(db, "hasEvent").mockResolvedValue(false);
    vi.spyOn(db, "customerEmail").mockResolvedValue("ada@example.com");
    vi.spyOn(db, "resolveEdgeCountrySlug").mockResolvedValue("cameroon");
    vi.spyOn(db, "listEdgeGradingScalesForCountry").mockResolvedValue([]);
    vi.spyOn(db, "listEdgeCredentialsForCountry").mockResolvedValue([credentialRow()]);
    vi.spyOn(db, "listEdgeEquivalenciesForCredential").mockResolvedValue([equivalencyRow()]);
    vi.spyOn(ai, "generateObject").mockResolvedValue({
      credentials: [
        {
          applicant: "Ada Lovelace",
          institution: "University of Yaounde",
          country: "Cameroon",
          credential: "Licence",
          englishCredential: "Bachelor's degree",
          field: "Quantitative Management Techniques",
          dates: "March 26, 2003",
        },
      ],
    });
    vi.spyOn(pdf, "renderEvaluationPdfs").mockResolvedValue({
      clean: new Uint8Array([1, 2, 3]),
      preview: new Uint8Array([4]),
      pageCount: 1,
    });
    vi.spyOn(verification, "stampFinishedPdf").mockImplementation(async (_db, bytes) => bytes);
    vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined);
    vi.spyOn(certification, "stampApprovedCover").mockResolvedValue(undefined);
    vi.spyOn(finalEmail, "sendFinalCustomerEmail").mockResolvedValue({ sent: true, skipped: false });
    vi.spyOn(email, "sendStaffOrderAlert").mockResolvedValue({ sent: true, skipped: false });
    vi.spyOn(webhooks, "notifyOrder").mockResolvedValue(undefined);
    vi.spyOn(webhooks, "notifyLifecycle").mockResolvedValue(undefined);
    vi.spyOn(db, "claimEvalPaidAlert").mockResolvedValue(false);
    delete process.env.AUTO_RELEASE_ENABLED;
  });

  it("auto-releases a clean qa_review evaluation prepared on upload", async () => {
    const prepared = await completeEvaluation(dbHandle, draftOrder(), {
      sourceLanguage: "fr",
      confidence: 0.99,
      billablePages: 1,
      imageQuality: false,
      detectionAvailable: true,
      languagesDisagree: false,
      pageText: "Licence en techniques quantitatives de gestion",
      filenames: ["diploma.pdf"],
      combinedPath: null,
      pageOrderBasis: null,
      pageOrder: null,
      token: null,
    });
    expect(prepared.status).toBe("preview_ready");

    const preparation = vi
      .mocked(db.updateOrder)
      .mock.calls.find((item) => item[2]?.status === "preview_ready")?.[2];
    expect(preparation?.review_reason).toBeNull();
    const paid = paidFromPreparation(preparation ?? {});

    vi.spyOn(db, "getOrderById").mockResolvedValue(paid);
    vi.spyOn(db, "listDocuments").mockResolvedValue([
      { id: "doc-1", confidence: 0.96, position: 0 } as DocumentRecord,
    ]);

    const result = await settlePaidOrder(dbHandle, orderId, { scheduleUrgent: false });

    expect(result.fulfillment).toBe("released");
    expect(result.fulfillment).not.toBe("awaiting_review");
    expect(email.sendStaffOrderAlert).not.toHaveBeenCalled();
    expect(finalEmail.sendFinalCustomerEmail).toHaveBeenCalledWith(
      dbHandle,
      expect.objectContaining({ id: orderId, reviewReason: null, service: "diploma" }),
    );
    expect(db.updateOrder).toHaveBeenCalledWith(
      dbHandle,
      orderId,
      expect.objectContaining({
        status: "delivered",
        evaluation_status: "evaluation_complete",
        review_reason: null,
      }),
    );
    expect(webhooks.notifyLifecycle).toHaveBeenCalledWith(dbHandle, orderId, "order.completed");
    expect(db.updateDelivery).toHaveBeenCalledWith(
      dbHandle,
      orderId,
      expect.objectContaining({ status: "delivered" }),
    );
  });
});
