import { describe, expect, it } from "vitest";
import { HttpError } from "./errors";
import { offSessionPaymentParams } from "./off-session";
import { billingCardBody, requireStripeTestKey, setupIntentCreateParams } from "./saved-card";

describe("saved card", () => {
  it("returns brand and last4 only when both are stored", () => {
    expect(billingCardBody(null)).toEqual({ card: null });
    expect(billingCardBody({ brand: "visa", last4: null })).toEqual({ card: null });
    expect(billingCardBody({ brand: "visa", last4: "4242" })).toEqual({
      card: { brand: "visa", last4: "4242" },
    });
  });

  it("creates an off-session SetupIntent for the Stripe customer", () => {
    expect(setupIntentCreateParams("cus_123", "user-1")).toEqual({
      customer: "cus_123",
      usage: "off_session",
      payment_method_types: ["card"],
      metadata: { user_id: "user-1" },
    });
  });

  it("confirms the saved card off session for the order total", () => {
    expect(
      offSessionPaymentParams({
        customerId: "cus_123",
        paymentMethodId: "pm_123",
        amountCents: 2985,
        currency: "usd",
        orderId: "order-1",
      }),
    ).toEqual({
      amount: 2985,
      currency: "usd",
      customer: "cus_123",
      payment_method: "pm_123",
      confirm: true,
      off_session: true,
      metadata: { order_id: "order-1" },
    });
  });

  it("refuses SetupIntent when Stripe is not in test mode", () => {
    const previous = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_live_123";
    expect(() => requireStripeTestKey()).toThrow(HttpError);
    try {
      requireStripeTestKey();
    } catch (error) {
      expect(error).toMatchObject({ status: 503, code: "payments_not_configured" });
    }
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    expect(requireStripeTestKey()).toBe("sk_test_123");
    if (previous == null) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previous;
  });
});
