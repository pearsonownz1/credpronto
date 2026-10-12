import { describe, expect, it } from "vitest";
import {
  decideChargeRefunded,
  decideCheckoutCompleted,
  decideCheckoutExpired,
  type CheckoutCompleted,
  type CheckoutExpiredOrder,
  type OrderCharge,
  type PaymentSnapshot,
} from "./webhook";

const order: OrderCharge = { totalCents: 2985, currency: "usd" };

const session: CheckoutCompleted = {
  sessionId: "cs_test_1",
  amountCents: 2985,
  currency: "usd",
  paymentIntentId: "pi_1",
  orderId: "order-1",
};

const pending: PaymentSnapshot = {
  status: "pending",
  amountCents: 2985,
  orderId: "order-1",
};

describe("webhook idempotency", () => {
  it("marks a pending session paid once and ignores the same session after that", () => {
    const first = decideCheckoutCompleted(pending, session, order);
    expect(first).toEqual({ action: "mark_paid", paymentIntentId: "pi_1" });

    const paid: PaymentSnapshot = { ...pending, status: "paid" };
    const second = decideCheckoutCompleted(paid, session, order);
    expect(second).toEqual({ action: "duplicate" });

    const third = decideCheckoutCompleted(paid, session, order);
    expect(third).toEqual({ action: "duplicate" });
  });

  it("does not mark the order paid when the amount does not equal total_cents", () => {
    const decision = decideCheckoutCompleted(pending, { ...session, amountCents: 100 }, order);
    expect(decision).toEqual({ action: "fail", reason: "amount_mismatch" });
  });

  it("does not mark the order paid when the currency does not match", () => {
    const decision = decideCheckoutCompleted(pending, { ...session, currency: "eur" }, order);
    expect(decision).toEqual({ action: "fail", reason: "currency_mismatch" });
  });

  it("accepts a currency match that differs only by case", () => {
    const decision = decideCheckoutCompleted(pending, { ...session, currency: "USD" }, order);
    expect(decision).toEqual({ action: "mark_paid", paymentIntentId: "pi_1" });
  });
});

describe("charge.refunded", () => {
  const paid: PaymentSnapshot = { ...pending, status: "paid" };
  const charge = { amountCents: 2985, currency: "usd" };

  it("marks a settled payment refunded when amount and currency match the order", () => {
    expect(decideChargeRefunded(paid, charge, order)).toEqual({ action: "mark_refunded" });
  });

  it("does not refund when the amount or currency does not match", () => {
    expect(decideChargeRefunded(paid, { amountCents: 100, currency: "usd" }, order)).toEqual({
      action: "fail",
      reason: "amount_mismatch",
    });
    expect(decideChargeRefunded(paid, { amountCents: 2985, currency: "eur" }, order)).toEqual({
      action: "fail",
      reason: "currency_mismatch",
    });
  });

  it("treats a second refund of the same payment as a duplicate", () => {
    const refunded: PaymentSnapshot = { ...paid, status: "refunded" };
    expect(decideChargeRefunded(refunded, charge, order)).toEqual({ action: "duplicate" });
  });
});

describe("checkout.session.expired", () => {
  const awaiting: CheckoutExpiredOrder = {
    status: "preview_ready",
    settled: false,
    isLatestPayment: true,
  };

  it("expires a pending payment and returns an unpaid preview order to preview_ready", () => {
    expect(decideCheckoutExpired(pending, awaiting)).toEqual({ action: "expire", reopenOrder: true });
  });

  it("expires the payment but leaves a paid, approved, or delivered order alone", () => {
    for (const status of ["paid", "approved", "delivered"] as const) {
      expect(decideCheckoutExpired(pending, { ...awaiting, status })).toEqual({
        action: "expire",
        reopenOrder: false,
      });
    }
  });

  it("does not reopen when another payment on the order has already settled", () => {
    expect(decideCheckoutExpired(pending, { ...awaiting, settled: true })).toEqual({
      action: "expire",
      reopenOrder: false,
    });
  });

  it("does not reopen when the order is waiting on a newer checkout session", () => {
    expect(decideCheckoutExpired(pending, { ...awaiting, isLatestPayment: false })).toEqual({
      action: "expire",
      reopenOrder: false,
    });
  });

  it("does not pull an order that has left the pay step back to preview_ready", () => {
    for (const status of ["correction_requested", "processing", "cancelled", "failed"] as const) {
      expect(decideCheckoutExpired(pending, { ...awaiting, status })).toEqual({
        action: "expire",
        reopenOrder: false,
      });
    }
  });

  it("is a no-op when the payment is already expired", () => {
    const expired: PaymentSnapshot = { ...pending, status: "expired" };
    expect(decideCheckoutExpired(expired, awaiting)).toEqual({ action: "duplicate" });
    expect(decideCheckoutExpired(expired, awaiting)).toEqual({ action: "duplicate" });
  });

  it("ignores an unknown session and payments that are not pending", () => {
    expect(decideCheckoutExpired(null, null)).toEqual({ action: "ignore", reason: "unknown_session" });
    for (const status of ["paid", "paid_test", "failed", "canceled", "refunded"] as const) {
      expect(decideCheckoutExpired({ ...pending, status }, awaiting)).toEqual({
        action: "ignore",
        reason: "not_pending",
      });
    }
  });

  it("does not mark an expired payment paid if a completed event arrives later", () => {
    const expired: PaymentSnapshot = { ...pending, status: "expired" };
    expect(decideCheckoutCompleted(expired, session, order)).toEqual({
      action: "ignore",
      reason: "not_pending",
    });
  });
});
