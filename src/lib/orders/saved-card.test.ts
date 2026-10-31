import { describe, expect, it } from "vitest";
import { HttpError } from "./errors";
import { offSessionPaymentParams } from "./off-session";
import {
  billingCardBody,
  cardExpiryFromStripe,
  requireStripeTestKey,
  savedMethodFromStripe,
  setupIntentBelongsToUser,
  setupIntentCreateParams,
  shouldReadCardExpiry,
} from "./saved-card";

describe("saved card", () => {
  it("returns brand and last4 only when both are stored", () => {
    expect(billingCardBody(null)).toEqual({ card: null });
    expect(billingCardBody({ brand: "visa", last4: null })).toEqual({ card: null });
    expect(billingCardBody({ brand: "visa", last4: "4242" })).toEqual({
      card: { brand: "visa", last4: "4242", expMonth: null, expYear: null },
    });
    expect(billingCardBody({ brand: "visa", last4: "4242", expMonth: 4, expYear: 2028 })).toEqual({
      card: { brand: "visa", last4: "4242", expMonth: 4, expYear: 2028 },
    });
    expect(cardExpiryFromStripe({ exp_month: 4, exp_year: 2028 })).toEqual({ expMonth: 4, expYear: 2028 });
    expect(cardExpiryFromStripe({ exp_month: 13, exp_year: 2028 })).toEqual({ expMonth: null, expYear: null });
    expect(shouldReadCardExpiry("sk_test_123")).toBe(true);
    expect(shouldReadCardExpiry("sk_live_123")).toBe(true);
    expect(shouldReadCardExpiry(null)).toBe(false);
  });

  it("creates an off-session SetupIntent for the Stripe customer", () => {
    expect(setupIntentCreateParams("cus_123", "user-1")).toEqual({
      customer: "cus_123",
      usage: "off_session",
      automatic_payment_methods: { enabled: true, allow_redirects: "always" },
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

  it("keeps a Link payment method when Stripe does not return a card", () => {
    expect(savedMethodFromStripe({ type: "link" })).toEqual({
      brand: "link",
      last4: "link",
      expMonth: null,
      expYear: null,
    });
    expect(
      savedMethodFromStripe({
        type: "link",
        card: { brand: "mastercard", last4: "6850", exp_month: 8, exp_year: 2028, wallet: { type: "link" } },
      }),
    ).toEqual({ brand: "mastercard", last4: "6850", expMonth: 8, expYear: 2028 });
    expect(savedMethodFromStripe({ type: "us_bank_account" })).toBeNull();
  });

  it("accepts a SetupIntent for this customer only", () => {
    expect(setupIntentBelongsToUser({ metadata: { user_id: "user-1" }, customer: "cus_other" }, "user-1", "cus_1")).toBe(
      true,
    );
    expect(setupIntentBelongsToUser({ customer: "cus_1" }, "user-1", "cus_1")).toBe(true);
    expect(setupIntentBelongsToUser({ customer: "cus_2" }, "user-1", "cus_1")).toBe(false);
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
