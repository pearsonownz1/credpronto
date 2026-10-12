import Stripe from "stripe";
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

export function offSessionPaymentParams(input: {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  orderId: string;
}) {
  return {
    amount: input.amountCents,
    currency: input.currency,
    customer: input.customerId,
    payment_method: input.paymentMethodId,
    confirm: true as const,
    off_session: true as const,
    metadata: { order_id: input.orderId },
  };
}

/** Confirms a test-mode PaymentIntent off session. Declines stay card_declined. */
export async function createOffSessionPaymentIntent(input: {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  orderId: string;
}): Promise<OffSessionCharge> {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_")) {
    return { ok: false, code: "payments_not_configured", message: "Payments not configured" };
  }
  try {
    const stripe = new Stripe(key);
    const intent = await stripe.paymentIntents.create(offSessionPaymentParams(input));
    if (intent.status !== "succeeded") {
      return { ok: false, code: "card_declined", message: "The card was declined" };
    }
    return { ok: true, paymentIntentId: intent.id };
  } catch (error) {
    if (error instanceof Stripe.errors.StripeCardError) {
      return { ok: false, code: "card_declined", message: "The card was declined" };
    }
    return { ok: false, code: "payments_not_configured", message: "Payments not configured" };
  }
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
