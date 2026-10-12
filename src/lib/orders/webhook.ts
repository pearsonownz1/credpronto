export type PaymentSnapshot = {
  status: "pending" | "paid" | "paid_test" | "failed" | "canceled" | "expired" | "refunded";
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
  | { action: "mark_refunded" }
  | { action: "expire"; reopenOrder: boolean };

export type CheckoutExpiredOrder = {
  status: string;
  /** A paid or paid_test payment already exists on the order. */
  settled: boolean;
  /** This checkout session is the newest payment row on the order. */
  isLatestPayment: boolean;
};

const PAID_ORDER = new Set(["paid", "approved", "delivered"]);

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

/**
 * Pure decision for checkout.session.expired.
 * A pending payment for that session becomes expired. When the order is still
 * waiting on that session and has not been paid, it goes back to preview_ready.
 * A second delivery is a no-op. Unknown sessions are ignored.
 */
export function decideCheckoutExpired(
  payment: PaymentSnapshot | null,
  order: CheckoutExpiredOrder | null,
): WebhookDecision {
  if (!payment) return { action: "ignore", reason: "unknown_session" };
  if (payment.status === "expired") return { action: "duplicate" };
  if (payment.status !== "pending") return { action: "ignore", reason: "not_pending" };

  const awaitingThisSession =
    order != null &&
    order.status === "preview_ready" &&
    order.isLatestPayment &&
    !order.settled &&
    !PAID_ORDER.has(order.status);

  return { action: "expire", reopenOrder: awaitingThisSession };
}
