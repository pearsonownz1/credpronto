export type RefundPlan =
  | { action: "duplicate" }
  | { action: "placeholder" }
  | { action: "stripe"; paymentIntentId: string }
  | { action: "reject"; status: number; error: string };

/**
 * paid_test never calls Stripe. A real charge is refunded only with a test secret key.
 */
export function planRefund(input: {
  paymentStatus: string | null;
  paymentIntentId: string | null;
  stripeSecretKey: string | undefined;
}): RefundPlan {
  if (!input.paymentStatus) {
    return { action: "reject", status: 409, error: "This order has no settled payment" };
  }
  if (input.paymentStatus === "refunded") return { action: "duplicate" };
  if (input.paymentStatus === "paid_test") return { action: "placeholder" };
  if (input.paymentStatus !== "paid") {
    return { action: "reject", status: 409, error: "This payment cannot be refunded" };
  }

  const key = input.stripeSecretKey;
  if (!key) return { action: "reject", status: 503, error: "Payments not configured" };
  if (!key.startsWith("sk_test_")) {
    return { action: "reject", status: 409, error: "Stripe refunds from this route run in test mode" };
  }
  if (!input.paymentIntentId) {
    return { action: "reject", status: 409, error: "Payment has no Stripe payment intent" };
  }
  return { action: "stripe", paymentIntentId: input.paymentIntentId };
}
