import Stripe from "stripe";
import { HttpError } from "./errors";
import {
  billingCustomerForUser,
  billingUserForStripeCustomer,
  clearBillingMethod,
  insertBillingCustomer,
  saveBillingMethod,
} from "./integrations-db";
import type { Db } from "./storage";

export function requireStripeTestKey(): string {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_")) {
    throw new HttpError("Payments not configured", 503, "payments_not_configured");
  }
  return key;
}

export function billingCardBody(card: { brand: string | null; last4: string | null } | null): {
  card: { brand: string; last4: string } | null;
} {
  if (!card?.brand || !card.last4) return { card: null };
  return { card: { brand: card.brand, last4: card.last4 } };
}

export function setupIntentCreateParams(customerId: string, userId: string) {
  return {
    customer: customerId,
    usage: "off_session" as const,
    payment_method_types: ["card"],
    metadata: { user_id: userId },
  };
}

export async function currentBillingCard(db: Db, userId: string) {
  return billingCardBody(await billingCustomerForUser(db, userId));
}

export async function createSetupIntent(db: Db, user: { id: string; email: string | null }) {
  const stripe = new Stripe(requireStripeTestKey());
  let row = await billingCustomerForUser(db, user.id);
  if (!row) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { user_id: user.id },
    });
    await insertBillingCustomer(db, user.id, customer.id);
    row = (await billingCustomerForUser(db, user.id)) ?? {
      userId: user.id,
      stripeCustomerId: customer.id,
      paymentMethodId: null,
      brand: null,
      last4: null,
    };
  }
  const intent = await stripe.setupIntents.create(setupIntentCreateParams(row.stripeCustomerId, user.id));
  if (!intent.client_secret) throw new HttpError("Stripe did not return a client secret", 502);
  return { clientSecret: intent.client_secret, customerId: row.stripeCustomerId };
}

export async function removeSavedCard(db: Db, userId: string) {
  const key = requireStripeTestKey();
  const row = await billingCustomerForUser(db, userId);
  if (row?.paymentMethodId) {
    const stripe = new Stripe(key);
    try {
      await stripe.paymentMethods.detach(row.paymentMethodId);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code !== "resource_missing") {
        throw new HttpError("Payments not configured", 503, "payments_not_configured");
      }
    }
  }
  if (row) await clearBillingMethod(db, userId);
  return { card: null as null };
}

export async function applySucceededSetupIntent(db: Db, stripe: Stripe, intent: Stripe.SetupIntent) {
  const paymentMethodId =
    typeof intent.payment_method === "string" ? intent.payment_method : (intent.payment_method?.id ?? null);
  if (!paymentMethodId) return { received: true as const };
  const customerId = typeof intent.customer === "string" ? intent.customer : (intent.customer?.id ?? null);
  const userId =
    intent.metadata?.user_id || (customerId ? await billingUserForStripeCustomer(db, customerId) : null);
  if (!userId) return { received: true as const };
  const method = await stripe.paymentMethods.retrieve(paymentMethodId);
  const brand = method.card?.brand ?? null;
  const last4 = method.card?.last4 ?? null;
  if (!brand || !last4) return { received: true as const };
  await saveBillingMethod(db, userId, { paymentMethodId, brand, last4 });
  return { received: true as const };
}
