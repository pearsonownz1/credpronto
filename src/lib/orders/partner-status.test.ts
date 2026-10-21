import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateApiKey } from "./api-key";
import { API_KEY_RATE_MAX, resetApiKeyRates } from "./api-rate-limit";
import * as db from "./db";
import { HttpError } from "./errors";
import * as integrations from "./integrations-db";
import { partnerFiles, partnerOrder, requireApiKey } from "./partner";
import * as storage from "./storage";
import type { DeliveryRecord, DocumentRecord, OrderRecord, PaymentRecord } from "./types";

const dbHandle = {} as db.Db;

function orderRecord(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "order-1",
    customerId: "customer-1",
    userId: "user-1",
    serviceType: "translation",
    status: "paid",
    sourceLanguage: "es",
    targetLanguage: "en",
    languageConfirmed: true,
    billablePages: 1,
    unitPriceCents: 995,
    totalCents: 995,
    currency: "usd",
    etaAt: null,
    reviewReason: null,
    combinedOriginalPath: null,
    finalTranslationPath: "order-1/final.pdf",
    certificationPath: "order-1/cert.pdf",
    pageOrderBasis: "logical",
    pageOrder: {
      basis: "logical",
      pages: [
        {
          documentId: "doc-1",
          uploadPosition: 1,
          appliedPosition: 1,
          uploadPage: 1,
          appliedPage: 1,
          logicalPage: 1,
          hint: null,
          confidence: 0.91,
        },
      ],
    },
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
    edgeCredentialId: "cred-1",
    edgeGradingScaleId: null,
    edgeMatchMethod: "fuzzy",
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    paidAt: "2026-10-12T00:00:00.000Z",
    staffAlertSentAt: null,
    staffUrgentAlertSentAt: null,
    progress: {
      step: "translating",
      pagesRead: 3,
      pagesTotal: 3,
      pagesDone: 1,
      pagesTranslateTotal: 3,
      retries: 1,
    },
    ...patch,
  };
}

function document(): DocumentRecord {
  return {
    id: "doc-1",
    orderId: "order-1",
    originalPath: "order-1/diploma.pdf",
    filename: "diploma.pdf",
    mime: "application/pdf",
    size: 100,
    pageCount: 1,
    status: "ready",
    detectedLanguage: "es",
    confidence: 0.94,
    position: 1,
    appliedPosition: 1,
  };
}

describe("partner status and files", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetApiKeyRates();
    vi.spyOn(storage, "serviceDb").mockReturnValue(dbHandle);
  });

  it("authenticates a hashed key and rate-limits that key", async () => {
    const generated = generateApiKey("test");
    vi.spyOn(integrations, "findActiveApiKey").mockResolvedValue({
      id: "key-1",
      userId: "user-1",
      name: "Test",
      prefix: "cp_test_",
      last4: generated.last4,
      createdAt: "2026-10-12T00:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null,
    });
    const touch = vi.spyOn(integrations, "touchApiKeyLastUsed").mockResolvedValue(undefined);
    const call = () =>
      requireApiKey(
        new Request("https://example.test/api/v1/orders", {
          headers: { authorization: `Bearer ${generated.secret}` },
        }),
      );

    for (let i = 0; i < API_KEY_RATE_MAX; i += 1) {
      await expect(call()).resolves.toMatchObject({ id: "key-1" });
    }
    await expect(call()).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    expect(touch).toHaveBeenCalledTimes(API_KEY_RATE_MAX);
    const hashed = integrations.findActiveApiKey as unknown as { mock: { calls: unknown[][] } };
    expect(hashed.mock.calls[0]?.[1]).not.toBe(generated.secret);
  });

  it("rejects a missing bearer token before counting a request", async () => {
    const find = vi.spyOn(integrations, "findActiveApiKey").mockResolvedValue(null);
    await expect(requireApiKey(new Request("https://example.test/api/v1/orders"))).rejects.toBeInstanceOf(HttpError);
    expect(find).not.toHaveBeenCalled();
  });

  it("returns quote fields, page progress, and delayed on the status read", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      orderRecord({
        status: "processing",
        updatedAt: "2026-10-12T00:00:00.000Z",
      }),
    );
    vi.spyOn(db, "latestPayment").mockResolvedValue({ status: "paid" } as PaymentRecord);
    vi.spyOn(db, "listQaRuns").mockResolvedValue([]);
    vi.spyOn(db, "latestReadyPreview").mockResolvedValue(null);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-12T00:20:00.000Z"));

    const body = await partnerOrder("user-1", "order-1", true);
    expect(body).toMatchObject({
      id: "order-1",
      status: "processing",
      billablePages: 1,
      unitPriceCents: 995,
      totalCents: 995,
      currency: "usd",
      progress: { step: "translating", pagesRead: 3, pagesTotal: 3, pagesDone: 1, pagesTranslateTotal: 3 },
      delayed: true,
      qa: null,
    });
    expect(body.progress).not.toHaveProperty("retries");
    const json = JSON.stringify(body);
    expect(json).not.toMatch(/"confidence"|"basis"|equivalencyBasis|edgeMatch|retries/);
    expect(json).not.toMatch(/\bEDGE\b/);
  });

  it("withholds the final file until it is released", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(orderRecord());
    vi.spyOn(db, "listDocuments").mockResolvedValue([document()]);
    vi.spyOn(db, "settledPayment").mockResolvedValue({ status: "paid" } as PaymentRecord);
    vi.spyOn(db, "getDelivery").mockResolvedValue({
      status: "pending",
      finalPath: "order-1/final.pdf",
      certificationPath: "order-1/cert.pdf",
    } as DeliveryRecord);
    vi.spyOn(storage, "signedObjectUrl").mockResolvedValue("https://files.example/original");

    const held = await partnerFiles("user-1", "order-1");
    expect(held).toMatchObject({
      downloadAvailable: false,
      translation: null,
      certification: null,
    });
    expect(held.originals[0]).toMatchObject({
      documentId: "doc-1",
      filename: "diploma.pdf",
      url: "https://files.example/original",
      expiresInSeconds: 300,
    });
    expect(JSON.stringify(held)).not.toMatch(/"confidence"|"basis"/);
  });

  it("returns the final file URL once delivery is approved", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(orderRecord());
    vi.spyOn(db, "listDocuments").mockResolvedValue([document()]);
    vi.spyOn(db, "settledPayment").mockResolvedValue({ status: "paid" } as PaymentRecord);
    vi.spyOn(db, "getDelivery").mockResolvedValue({
      status: "approved",
      finalPath: "order-1/final.pdf",
      certificationPath: "order-1/cert.pdf",
    } as DeliveryRecord);
    vi.spyOn(db, "insertEvent").mockResolvedValue(undefined);
    vi.spyOn(storage, "signedObjectUrl").mockImplementation(async (_db, _bucket, path) => {
      return `https://files.example/${path}`;
    });

    const released = await partnerFiles("user-1", "order-1");
    expect(released.downloadAvailable).toBe(true);
    expect(released.translation).toEqual({
      url: "https://files.example/order-1/final.pdf",
      filename: "diploma-certified-translation.pdf",
      expiresInSeconds: 300,
    });
    expect(released.certification).toEqual({
      url: "https://files.example/order-1/cert.pdf",
      filename: "diploma-certificate.pdf",
      expiresInSeconds: 300,
    });
  });
});
