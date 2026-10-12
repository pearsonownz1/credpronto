export type PaymentSnapshot = {
  status: "pending" | "paid" | "paid_test" | "failed" | "canceled" | "refunded";
  amountCents: number;
  orderId: string;
};

export type CheckoutCompleted = {
  sessionId: string;
  amountCents: number | null;
  currency: string | null;
  paymentIntentId: string | null;
  orderId: string | null;
};

export type OrderCharge = {
  totalCents: number | null;
  currency: string;
};

export type RefundCharge = {
  amountCents: number | null;
  currency: string | null;
};

export type WebhookDecision =
  | { action: "duplicate" }
  | { action: "ignore"; reason: string }
  | { action: "fail"; reason: string }
  | { action: "mark_paid"; paymentIntentId: string | null }
  | { action: "mark_refunded" };

const SETTLED = new Set(["paid", "paid_test", "refunded"]);

function sameCurrency(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function chargeMatchesOrder(
  amountCents: number | null,
  currency: string | null,
  order: OrderCharge | null,
): "ok" | "amount_mismatch" | "currency_mismatch" {
  if (!order || order.totalCents == null || amountCents == null || amountCents !== order.totalCents) {
    return "amount_mismatch";
  }
  if (!sameCurrency(currency, order.currency)) return "currency_mismatch";
  return "ok";
}

/** Pure decision for checkout.session.completed. A second delivery is a no-op. */
export function decideCheckoutCompleted(
  payment: PaymentSnapshot | null,
  session: CheckoutCompleted,
  order: OrderCharge | null,
): WebhookDecision {
  if (!payment) {
    return { action: "ignore", reason: "unknown_session" };
  }

  if (SETTLED.has(payment.status)) {
    return { action: "duplicate" };
  }

  if (session.orderId && session.orderId !== payment.orderId) {
    return { action: "fail", reason: "order_mismatch" };
  }

  const match = chargeMatchesOrder(session.amountCents, session.currency, order);
  if (match !== "ok") return { action: "fail", reason: match };

  if (payment.amountCents !== order?.totalCents) {
    return { action: "fail", reason: "amount_mismatch" };
  }

  if (payment.status !== "pending") {
    return { action: "ignore", reason: "not_pending" };
  }

  return { action: "mark_paid", paymentIntentId: session.paymentIntentId };
}

/**
 * Pure decision for charge.refunded.
 * A matching settled payment becomes refunded, which closes the download gate.
 */
export function decideChargeRefunded(
  payment: PaymentSnapshot | null,
  charge: RefundCharge,
  order: OrderCharge | null,
): WebhookDecision {
  if (!payment) return { action: "ignore", reason: "unknown_charge" };
  if (payment.status === "refunded") return { action: "duplicate" };
  if (payment.status !== "paid" && payment.status !== "paid_test") {
    return { action: "ignore", reason: "not_settled" };
  }

  const match = chargeMatchesOrder(charge.amountCents, charge.currency, order);
  if (match !== "ok") return { action: "fail", reason: match };
  if (payment.amountCents !== order?.totalCents) {
    return { action: "fail", reason: "amount_mismatch" };
  }

  return { action: "mark_refunded" };
}
