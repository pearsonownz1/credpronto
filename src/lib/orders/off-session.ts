import type { Db } from "./storage";
import { findBillingCard } from "./integrations-db";

export type OffSessionCode = "card_required" | "card_declined" | "payments_not_configured";

export type OffSessionDecision =
  | { action: "charge" }
  | { action: "refuse"; code: OffSessionCode; message: string };

/** A missing card is 402. A charge only runs against an sk_test_ key. */
export function offSessionDecision(input: { hasCard: boolean; stripeKey: string | null }): OffSessionDecision {
  if (!input.hasCard) {
    return { action: "refuse", code: "card_required", message: "A saved card is required" };
  }
  if (!input.stripeKey?.startsWith("sk_test_")) {
    return { action: "refuse", code: "payments_not_configured", message: "Payments not configured" };
  }
  return { action: "charge" };
}

export type OffSessionCharge =
  | { ok: true; paymentIntentId: string }
  | { ok: false; code: OffSessionCode; message: string };

/**
 * Stripe PaymentIntent confirmation. The billing PR performs the test-mode charge.
 * Until then a saved card still cannot be captured.
 */
export async function createOffSessionPaymentIntent(input: {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  orderId: string;
}): Promise<OffSessionCharge> {
  void input;
  return { ok: false, code: "payments_not_configured", message: "Payments not configured" };
}

export async function chargeOffSession(input: {
  db: Db;
  userId: string;
  orderId: string;
  amountCents: number;
  currency: string;
}): Promise<OffSessionCharge> {
  const card = await findBillingCard(input.db, input.userId);
  const decision = offSessionDecision({
    hasCard: card != null,
    stripeKey: process.env.STRIPE_SECRET_KEY ?? null,
  });
  if (decision.action === "refuse") return { ok: false, code: decision.code, message: decision.message };
  if (!card) return { ok: false, code: "card_required", message: "A saved card is required" };
  return createOffSessionPaymentIntent({
    customerId: card.customerId,
    paymentMethodId: card.paymentMethodId,
    amountCents: input.amountCents,
    currency: input.currency,
    orderId: input.orderId,
  });
}
