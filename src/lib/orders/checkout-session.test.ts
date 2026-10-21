import { beforeEach, describe, expect, it, vi } from "vitest";

const stripeApi = vi.hoisted(() => ({
  create: vi.fn(),
  retrieve: vi.fn(),
  expire: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class Stripe {
    checkout = {
      sessions: {
        create: stripeApi.create,
        retrieve: stripeApi.retrieve,
        expire: stripeApi.expire,
      },
    };
  },
}));

import { startCheckout } from "./customer";
import * as db from "./db";
import { customerServiceQuote } from "./evaluation-price";
import * as storage from "./storage";
import type { DocumentRecord, OrderRecord, PaymentRecord } from "./types";

const token = "cLhjpSz7HaGJYb94lLxcJnKvKki_G00FSpsQnZu5dm8";

function order(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "order-1",
    customerId: "customer-1",
    userId: null,
    serviceType: "evaluation",
    status: "quoted",
    sourceLanguage: "es",
    targetLanguage: "en",
    languageConfirmed: true,
    billablePages: 1,
    unitPriceCents: 1995,
    totalCents: 1995,
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
    degreeCount: 1,
    evaluationCents: 1995,
    translationCents: 0,
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
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
    paidAt: null,
    staffAlertSentAt: null,
    staffUrgentAlertSentAt: null,
    progress: { step: "done", pagesRead: 1, pagesTotal: 1 },
    ...patch,
  };
}

function pendingPayment(amountCents: number): PaymentRecord {
  return {
    id: "pay-1",
    orderId: "order-1",
    sessionId: "cs_old",
    paymentIntentId: null,
    amountCents,
    status: "pending",
    paidAt: null,
    createdAt: "2026-10-21T00:00:00.000Z",
  };
}

function sessionAmount(params: {
  line_items: Array<{ quantity: number; price_data: { unit_amount: number } }>;
}): number {
  return params.line_items.reduce((sum, line) => sum + line.quantity * line.price_data.unit_amount, 0);
}

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  delete process.env.CHECKOUT_PLACEHOLDER;
  stripeApi.create.mockReset();
  stripeApi.retrieve.mockReset();
  stripeApi.expire.mockReset();
  stripeApi.create.mockImplementation(async (params: Parameters<typeof sessionAmount>[0]) => ({
    id: "cs_test",
    url: "https://checkout.stripe.test/c/cs_test",
    payment_intent: "pi_test",
    amount_total: sessionAmount(params),
    status: "open",
  }));
  vi.spyOn(storage, "serviceDb").mockReturnValue({} as db.Db);
  vi.spyOn(db, "requireOrderByHash").mockResolvedValue(order());
  vi.spyOn(db, "settledPayment").mockResolvedValue(null);
  vi.spyOn(db, "latestPayment").mockResolvedValue(null);
  vi.spyOn(db, "updateOrder").mockResolvedValue(true);
  vi.spyOn(db, "replaceOrderAddons").mockResolvedValue();
  vi.spyOn(db, "insertEvent").mockResolvedValue(undefined);
  vi.spyOn(db, "customerEmail").mockResolvedValue("ada@example.com");
  vi.spyOn(db, "listDocuments").mockResolvedValue([]);
  vi.spyOn(db, "latestReadyPreview").mockResolvedValue(null);
  vi.spyOn(db, "insertPayment").mockResolvedValue(pendingPayment(0));
  vi.spyOn(db, "markPaymentExpired").mockResolvedValue();
  vi.spyOn(db, "paymentBySession").mockResolvedValue(null);
});

async function paidSession(current: OrderRecord, body: unknown = {}) {
  vi.mocked(db.requireOrderByHash).mockResolvedValue(current);
  const quote = customerServiceQuote(current);
  const result = await startCheckout(token, body);
  const params = stripeApi.create.mock.calls.at(-1)?.[0] as Parameters<typeof sessionAmount>[0];
  const created = await stripeApi.create.mock.results.at(-1)?.value;
  return { quote, result, params, amountTotal: created.amount_total as number };
}

describe("checkout session matches the quote", () => {
  it("charges a combined diploma the evaluation plus detected pages, even when stored translation cents are still 0", async () => {
    const current = order({
      status: "preview_ready",
      includeTranslation: true,
      translationCents: 0,
      totalCents: 1995,
    });
    const { quote, amountTotal, params } = await paidSession(current);
    expect(quote.totalCents).toBe(2990);
    expect(amountTotal).toBe(quote.totalCents);
    expect(params.line_items).toEqual([
      expect.objectContaining({ quantity: 1, price_data: expect.objectContaining({ unit_amount: 1995 }) }),
      expect.objectContaining({
        quantity: 1,
        price_data: expect.objectContaining({
          unit_amount: 995,
          product_data: expect.objectContaining({ name: "Certified translation" }),
        }),
      }),
    ]);
    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      "order-1",
      expect.objectContaining({
        evaluation_cents: 1995,
        translation_cents: 995,
        include_translation: true,
        total_cents: 2990,
        unit_price_cents: 995,
      }),
    );
  });

  it("charges course-by-course for two degrees plus one detected page", async () => {
    const current = order({
      status: "preview_ready",
      service: "course_by_course",
      degreeCount: 2,
      evaluationCents: 7990,
      unitPriceCents: 3995,
      totalCents: 7990,
      includeTranslation: true,
      translationCents: 0,
    });
    const { quote, amountTotal } = await paidSession(current);
    expect(quote).toMatchObject({ evaluationCents: 7990, translationCents: 995, totalCents: 8985 });
    expect(amountTotal).toBe(8985);
    expect(amountTotal).toBe(quote.totalCents);
  });

  it("keeps an evaluation-only session equal to the quote", async () => {
    const current = order();
    const { quote, amountTotal, params } = await paidSession(current);
    expect(quote.totalCents).toBe(1995);
    expect(amountTotal).toBe(quote.totalCents);
    expect(params.line_items).toHaveLength(1);
    expect(params.line_items[0]).toEqual(
      expect.objectContaining({ quantity: 1, price_data: expect.objectContaining({ unit_amount: 1995 }) }),
    );
    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      "order-1",
      expect.objectContaining({
        evaluation_cents: 1995,
        translation_cents: 0,
        include_translation: false,
        total_cents: 1995,
        unit_price_cents: 1995,
      }),
    );
  });

  it("does not charge a bundle from document pages before the preview is ready", async () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        orderId: "order-1",
        originalPath: "order-1/diploma.pdf",
        filename: "diploma.pdf",
        mime: "application/pdf",
        size: 100,
        pageCount: 1,
        status: "uploaded",
        detectedLanguage: null,
        confidence: null,
        position: 1,
        appliedPosition: 1,
      },
    ];
    vi.mocked(db.listDocuments).mockResolvedValue(documents);
    const current = order({
      status: "draft",
      includeTranslation: true,
      sourceLanguage: null,
      languageConfirmed: false,
      billablePages: null,
      translationCents: 0,
      totalCents: 1995,
    });
    vi.mocked(db.requireOrderByHash).mockResolvedValue(current);
    await expect(startCheckout(token, {})).rejects.toThrow(/Preview is not ready/);
    expect(stripeApi.create).not.toHaveBeenCalled();
  });

  it("does not charge a bundle from the stored page count before the preview is ready", async () => {
    const current = order({
      status: "draft",
      service: "course_by_course",
      degreeCount: 2,
      evaluationCents: 7990,
      unitPriceCents: 3995,
      totalCents: 7990,
      includeTranslation: true,
      sourceLanguage: null,
      languageConfirmed: false,
      billablePages: 1,
      translationCents: 0,
    });
    vi.mocked(db.requireOrderByHash).mockResolvedValue(current);
    await expect(startCheckout(token, {})).rejects.toThrow(/Preview is not ready/);
    expect(stripeApi.create).not.toHaveBeenCalled();
  });

  it("still charges an evaluation-only order when language and pages are unknown", async () => {
    const current = order({
      status: "draft",
      sourceLanguage: null,
      languageConfirmed: false,
      billablePages: null,
    });
    const { quote, amountTotal } = await paidSession(current);
    expect(quote.totalCents).toBe(1995);
    expect(amountTotal).toBe(quote.totalCents);
  });

  it("keeps a translation-only session equal to the quote", async () => {
    const current = order({
      serviceType: "translation",
      orderType: "translation",
      status: "preview_ready",
      service: null,
      degreeCount: null,
      evaluationCents: null,
      translationCents: null,
      includeTranslation: false,
      billablePages: 3,
      unitPriceCents: 995,
      totalCents: 2985,
    });
    const { quote, amountTotal, params } = await paidSession(current);
    expect(quote.totalCents).toBe(2985);
    expect(amountTotal).toBe(quote.totalCents);
    expect(params.line_items).toEqual([
      expect.objectContaining({ quantity: 1, price_data: expect.objectContaining({ unit_amount: 2985 }) }),
    ]);
    expect(db.updateOrder).not.toHaveBeenCalled();
  });

  it("adds the selected add-on on top of the quote", async () => {
    const current = order({ status: "preview_ready", includeTranslation: true });
    const { quote, amountTotal } = await paidSession(current, { addons: ["notarization"] });
    expect(quote.totalCents).toBe(2990);
    expect(amountTotal).toBe(2990 + 1795);
  });

  it("does not open a session or clear translation before pages and language are known", async () => {
    vi.mocked(db.requireOrderByHash).mockResolvedValue(
      order({ includeTranslation: true, sourceLanguage: null, billablePages: null, translationCents: 0 }),
    );
    await expect(startCheckout(token, {})).rejects.toThrow(/Preview is not ready/);
    expect(db.updateOrder).not.toHaveBeenCalled();
    expect(stripeApi.create).not.toHaveBeenCalled();
  });

  it("does not reuse a pending session that omitted the translation", async () => {
    vi.mocked(db.latestPayment).mockResolvedValue(pendingPayment(1995));
    const current = order({
      status: "preview_ready",
      includeTranslation: true,
      translationCents: 995,
      totalCents: 2990,
    });
    const { amountTotal } = await paidSession(current);
    expect(stripeApi.expire).toHaveBeenCalledWith("cs_old");
    expect(db.markPaymentExpired).toHaveBeenCalledWith(expect.anything(), "pay-1");
    expect(amountTotal).toBe(2990);
  });

  it("returns the open session when a retry matches the quote total", async () => {
    vi.mocked(db.latestPayment).mockResolvedValue(pendingPayment(2990));
    stripeApi.retrieve.mockResolvedValue({
      id: "cs_old",
      url: "https://checkout.stripe.test/c/cs_old",
      status: "open",
    });
    const current = order({
      status: "preview_ready",
      includeTranslation: true,
      translationCents: 995,
      totalCents: 2990,
    });
    vi.mocked(db.requireOrderByHash).mockResolvedValue(current);
    const result = await startCheckout(token, {});
    expect(result).toEqual({ url: "https://checkout.stripe.test/c/cs_old", sessionId: "cs_old" });
    expect(stripeApi.create).not.toHaveBeenCalled();
  });
});
