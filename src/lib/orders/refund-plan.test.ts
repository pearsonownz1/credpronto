import { describe, expect, it } from "vitest";
import { planRefund } from "./refund-plan";

describe("refund plan", () => {
  it("uses a placeholder for paid_test and does not need Stripe", () => {
    expect(
      planRefund({ paymentStatus: "paid_test", paymentIntentId: null, stripeSecretKey: undefined }),
    ).toEqual({ action: "placeholder" });
  });

  it("refunds a paid charge only with a Stripe test key and a payment intent", () => {
    expect(
      planRefund({
        paymentStatus: "paid",
        paymentIntentId: "pi_test",
        stripeSecretKey: "sk_test_123",
      }),
    ).toEqual({ action: "stripe", paymentIntentId: "pi_test" });
  });

  it("refuses a live Stripe key", () => {
    const plan = planRefund({
      paymentStatus: "paid",
      paymentIntentId: "pi_live",
      stripeSecretKey: "sk_live_123",
    });
    expect(plan.action).toBe("reject");
    if (plan.action === "reject") expect(plan.status).toBe(409);
  });

  it("treats an existing refund as a duplicate", () => {
    expect(
      planRefund({ paymentStatus: "refunded", paymentIntentId: "pi_test", stripeSecretKey: "sk_test_123" }),
    ).toEqual({ action: "duplicate" });
  });

  it("rejects an order with no settled payment", () => {
    const plan = planRefund({ paymentStatus: null, paymentIntentId: null, stripeSecretKey: "sk_test_123" });
    expect(plan.action).toBe("reject");
    if (plan.action === "reject") expect(plan.status).toBe(409);
  });
});
