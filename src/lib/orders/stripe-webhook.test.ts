import { beforeEach, describe, expect, it, vi } from "vitest";

const stripeApi = vi.hoisted(() => ({
  constructEvent: vi.fn(),
}));

const settlePaidOrder = vi.hoisted(() => vi.fn(async () => ({ fulfillment: "awaiting_review" as const })));

vi.mock("stripe", () => ({
  default: class Stripe {
    webhooks = {
      constructEvent: stripeApi.constructEvent,
    };
  },
}));

vi.mock("./paid-release", () => ({
  settlePaidOrder,
}));

import { ADDON_CATALOG } from "./addons";
import { handleStripeWebhook } from "./customer";
import * as db from "./db";
import * as storage from "./storage";
import type { OrderRecord, OrderStatus, PaymentRecord } from "./types";
import * as lifecycle from "./webhook-delivery";

const orderId = "order-1";
const notary = ADDON_CATALOG.find((item) => item.id === "notarization");
const mail = ADDON_CATALOG.find((item) => item.id === "mail");
const pages = 2;
const unitPriceCents = 995;
const addonCents = (notary?.unitCents ?? 0) + (mail?.unitCents ?? 0);
const totalCents = pages * unitPriceCents + addonCents;

function translationOrder(status: OrderStatus = "preview_ready"): OrderRecord {
  return {
    id: orderId,
    customerId: "customer-1",
    userId: null,
    serviceType: "translation",
    status,
    sourceLanguage: "es",
    targetLanguage: "en",
    languageConfirmed: true,
    billablePages: pages,
    unitPriceCents,
    totalCents,
    currency: "usd",
    etaAt: null,
    reviewReason: null,
    combinedOriginalPath: null,
    finalTranslationPath: null,
    certificationPath: null,
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
    addonCents,
    expedited: false,
    shippingAddress: {
      name: "Ada Lovelace",
      line1: "1 Market St",
      line2: null,
      city: "San Francisco",
      state: "CA",
      postalCode: "94105",
      country: "US",
    },
    mailStatus: "pending",
    mailTracking: null,
    notarizationStatus: "pending",
    edgeCredentialId: null,
    edgeGradingScaleId: null,
    edgeMatchMethod: null,
    createdAt: "2026-10-23T00:00:00.000Z",
    updatedAt: "2026-10-23T00:00:00.000Z",
    paidAt: null,
    staffAlertSentAt: null,
    staffUrgentAlertSentAt: null,
    progress: { step: "done", pagesRead: pages, pagesTotal: pages },
  };
}

function payment(status: PaymentRecord["status"]): PaymentRecord {
  return {
    id: "pay-1",
    orderId,
    sessionId: "cs_addons",
    paymentIntentId: status === "pending" ? null : "pi_addons",
    amountCents: totalCents,
    status,
    paidAt: status === "paid" ? "2026-10-23T00:05:00.000Z" : null,
    createdAt: "2026-10-23T00:04:00.000Z",
  };
}

function webhookRequest(): Request {
  return new Request("https://credpronto.test/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=test" },
    body: "{}",
  });
}

describe("checkout.session.completed with translation add-ons", () => {
  let current: OrderRecord;
  let charge: PaymentRecord;
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];

  beforeEach(() => {
    vi.restoreAllMocks();
    current = translationOrder();
    charge = payment("pending");
    events.length = 0;
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_123";
    stripeApi.constructEvent.mockReset();
    stripeApi.constructEvent.mockReturnValue({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_addons",
          amount_total: totalCents,
          currency: "usd",
          payment_intent: "pi_addons",
          metadata: { order_id: orderId },
        },
      },
    });
    settlePaidOrder.mockReset();
    settlePaidOrder.mockResolvedValue({ fulfillment: "awaiting_review" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(storage, "serviceDb").mockReturnValue({} as db.Db);
    vi.spyOn(db, "getOrderById").mockImplementation(async () => current);
    vi.spyOn(db, "paymentBySession").mockImplementation(async () => charge);
    vi.spyOn(db, "markPaymentPaid").mockImplementation(async () => {
      charge = { ...charge, status: "paid", paymentIntentId: "pi_addons", paidAt: "2026-10-23T00:05:00.000Z" };
    });
    vi.spyOn(db, "markPaymentFailed").mockResolvedValue(undefined);
    vi.spyOn(db, "ensurePendingDelivery").mockResolvedValue(undefined);
    vi.spyOn(db, "updateOrder").mockImplementation(async (_db, _id, patch, options) => {
      const allowed = options?.statuses;
      if (allowed && allowed.length > 0 && !allowed.includes(current.status)) return false;
      if (typeof patch.status === "string") current = { ...current, status: patch.status as OrderStatus };
      return true;
    });
    vi.spyOn(db, "hasEvent").mockImplementation(async (_db, _id, type) => events.some((event) => event.type === type));
    vi.spyOn(db, "insertEvent").mockImplementation(async (_db, _id, type, data) => {
      events.push({ type, data: data ?? {} });
    });
    vi.spyOn(lifecycle, "notifyLifecycle").mockResolvedValue(undefined);
  });

  it("marks a notarized and mailed translation paid and records the paid event", async () => {
    expect(notary?.unitCents).toBeGreaterThan(0);
    expect(mail?.unitCents).toBeGreaterThan(0);
    expect(current.totalCents).toBe((current.billablePages ?? 0) * current.unitPriceCents + current.addonCents);
    expect(current.addonCents).toBe((notary?.unitCents ?? 0) + (mail?.unitCents ?? 0));

    await expect(handleStripeWebhook(webhookRequest())).resolves.toEqual({ received: true });

    expect(current.status).toBe("paid");
    expect(events).toEqual([{ type: "paid", data: { mode: "stripe" } }]);
    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      { status: "paid" },
      expect.objectContaining({ statuses: expect.arrayContaining(["preview_ready"]) }),
    );
    expect(db.markPaymentPaid).toHaveBeenCalledWith(expect.anything(), "pay-1", "pi_addons");
    expect(db.ensurePendingDelivery).toHaveBeenCalledWith(expect.anything(), orderId);
    expect(lifecycle.notifyLifecycle).toHaveBeenCalledWith(expect.anything(), orderId, "order.paid");
    expect(settlePaidOrder).toHaveBeenCalledWith(expect.anything(), orderId);
  });

  it("repairs a settled payment that left the order at preview_ready", async () => {
    charge = payment("paid");
    current = translationOrder("preview_ready");

    await expect(handleStripeWebhook(webhookRequest())).resolves.toEqual({ received: true, duplicate: true });

    expect(current.status).toBe("paid");
    expect(events).toEqual([{ type: "paid", data: { mode: "stripe" } }]);
    expect(db.markPaymentPaid).not.toHaveBeenCalled();
    expect(lifecycle.notifyLifecycle).toHaveBeenCalledTimes(1);
    expect(lifecycle.notifyLifecycle).toHaveBeenCalledWith(expect.anything(), orderId, "order.paid");
    expect(settlePaidOrder).toHaveBeenCalledWith(expect.anything(), orderId);

    await handleStripeWebhook(webhookRequest());

    expect(current.status).toBe("paid");
    expect(events).toEqual([{ type: "paid", data: { mode: "stripe" } }]);
    expect(db.updateOrder).toHaveBeenCalledTimes(1);
    expect(lifecycle.notifyLifecycle).toHaveBeenCalledTimes(1);
    expect(settlePaidOrder).toHaveBeenCalledTimes(2);
  });

  it("logs and rethrows when the paid status update fails", async () => {
    vi.mocked(db.updateOrder).mockRejectedValueOnce(
      new Error('new row for relation "orders" violates check constraint "orders_translation_priced_when_paid_chk"'),
    );

    await expect(handleStripeWebhook(webhookRequest())).rejects.toThrow("orders_translation_priced_when_paid_chk");

    expect(console.error).toHaveBeenCalledWith(
      `ALERT: Stripe payment could not mark order ${orderId} paid`,
      expect.stringContaining("orders_translation_priced_when_paid_chk"),
    );
    expect(current.status).toBe("preview_ready");
    expect(events).toEqual([]);
    expect(lifecycle.notifyLifecycle).not.toHaveBeenCalled();
    expect(settlePaidOrder).not.toHaveBeenCalled();
    expect(db.markPaymentPaid).toHaveBeenCalled();
  });
});
