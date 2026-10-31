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

/** Test or live secret. Partner off-session charges stay on the test-only gate. */
export function requireStripeSecret(): string {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (key.startsWith("sk_test_") || key.startsWith("sk_live_")) return key;
  throw new HttpError("Payments not configured", 503, "payments_not_configured");
}

export function shouldReadCardExpiry(stripeKey: string | null | undefined): boolean {
  return Boolean(stripeKey?.startsWith("sk_test_") || stripeKey?.startsWith("sk_live_"));
}

/** Stripe test-mode PaymentMethod card expiry. Invalid values stay unknown. */
export function cardExpiryFromStripe(card: { exp_month?: number | null; exp_year?: number | null } | null | undefined): {
  expMonth: number | null;
  expYear: number | null;
} {
  const month = card?.exp_month;
  const year = card?.exp_year;
  if (typeof month !== "number" || typeof year !== "number") return { expMonth: null, expYear: null };
  if (!Number.isInteger(month) || month < 1 || month > 12) return { expMonth: null, expYear: null };
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { expMonth: null, expYear: null };
  return { expMonth: month, expYear: year };
}

export type BillingMethodView = {
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
  email: string | null;
  wallet: "link" | null;
};

export function billingCardBody(
  card: {
    brand: string | null;
    last4: string | null;
    expMonth?: number | null;
    expYear?: number | null;
    email?: string | null;
    wallet?: "link" | null;
  } | null,
): { card: BillingMethodView | null } {
  if (!card?.brand || !card.last4) return { card: null };
  const expiry = cardExpiryFromStripe({ exp_month: card.expMonth, exp_year: card.expYear });
  return {
    card: {
      brand: card.brand,
      last4: card.last4,
      expMonth: expiry.expMonth,
      expYear: expiry.expYear,
      email: card.email ?? null,
      wallet: card.wallet ?? null,
    },
  };
}

const LINK_LAST4 = "link";

export type StripeMethodLike = {
  type?: string | null;
  link?: { email?: string | null } | null;
  card?: {
    brand?: string | null;
    last4?: string | null;
    exp_month?: number | null;
    exp_year?: number | null;
    wallet?: { type?: string | null } | null;
  } | null;
};

/** Card details, or a Link payment method when Stripe omits the underlying card. */
export function savedMethodFromStripe(method: StripeMethodLike): {
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
} | null {
  const card = method.card;
  const last4 = card?.last4?.trim() ?? "";
  if (/^\d{4}$/.test(last4)) {
    const link = method.type === "link" || card?.wallet?.type === "link";
    const brand = (card?.brand || (link ? "link" : "card")).trim();
    if (!brand) return null;
    const expiry = cardExpiryFromStripe(card);
    return { brand, last4, expMonth: expiry.expMonth, expYear: expiry.expYear };
  }
  if (method.type === "link" || card?.wallet?.type === "link") {
    return { brand: "link", last4: LINK_LAST4, expMonth: null, expYear: null };
  }
  return null;
}

export function setupIntentBelongsToUser(
  intent: { metadata?: { user_id?: string | null } | null; customer?: string | { id?: string | null } | null },
  userId: string,
  stripeCustomerId: string | null,
): boolean {
  if (intent.metadata?.user_id && intent.metadata.user_id === userId) return true;
  const customerId = typeof intent.customer === "string" ? intent.customer : (intent.customer?.id ?? null);
  return Boolean(stripeCustomerId && customerId && customerId === stripeCustomerId);
}

export function setupIntentCreateParams(customerId: string, userId: string) {
  return {
    customer: customerId,
    usage: "off_session" as const,
    payment_method_types: ["card"] as ["card"],
    metadata: { user_id: userId },
  };
}

type CardDigits = {
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
};

function digitsFromCard(card: StripeMethodLike["card"]): CardDigits | null {
  const last4 = card?.last4?.trim() ?? "";
  if (!/^\d{4}$/.test(last4)) return null;
  const expiry = cardExpiryFromStripe(card);
  return { brand: (card?.brand || "card").trim() || "card", last4, expMonth: expiry.expMonth, expYear: expiry.expYear };
}

async function underlyingCard(
  stripe: Stripe,
  customerId: string,
  paymentMethodId: string,
): Promise<CardDigits | null> {
  const intents = await stripe.setupIntents.list({ customer: customerId, limit: 10 });
  for (const intent of intents.data) {
    const id = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
    if (id !== paymentMethodId) continue;
    const attempts = await stripe.setupAttempts.list({ setup_intent: intent.id, limit: 3 });
    for (const attempt of attempts.data) {
      const card = digitsFromCard(attempt.payment_method_details?.card);
      if (card) return card;
    }
  }
  const charges = await stripe.charges.list({ customer: customerId, limit: 10 });
  for (const charge of charges.data) {
    if (charge.payment_method !== paymentMethodId) continue;
    const card = digitsFromCard(charge.payment_method_details?.card ?? null);
    if (card) return card;
  }
  return null;
}

async function describeSavedMethod(
  paymentMethodId: string,
  customerId: string,
): Promise<BillingMethodView | null> {
  try {
    const stripe = new Stripe(requireStripeSecret());
    const method = await stripe.paymentMethods.retrieve(paymentMethodId);
    const saved = savedMethodFromStripe(method);
    if (!saved) return null;
    const link = method.type === "link" || method.card?.wallet?.type === "link";
    const email = method.link?.email?.trim() || null;
    const found = /^\d{4}$/.test(saved.last4) ? null : await underlyingCard(stripe, customerId, paymentMethodId);
    return {
      brand: found?.brand ?? saved.brand,
      last4: found?.last4 ?? saved.last4,
      expMonth: found?.expMonth ?? saved.expMonth,
      expYear: found?.expYear ?? saved.expYear,
      email,
      wallet: link ? "link" : null,
    };
  } catch (error) {
    console.error(error instanceof Error ? error.message : "billing method lookup failed");
    return null;
  }
}

export async function currentBillingCard(db: Db, userId: string) {
  let row = await billingCustomerForUser(db, userId);
  if (row?.stripeCustomerId && !row.paymentMethodId) {
    await adoptStripeMethod(db, row);
    row = await billingCustomerForUser(db, userId);
  }
  const terms = row?.terms ?? "card";
  if (!row?.brand || !row.last4) return { ...billingCardBody(row), terms };
  if (!row.paymentMethodId) {
    return { ...billingCardBody({ ...row, wallet: row.brand === "link" ? "link" : null }), terms };
  }
  const described = await describeSavedMethod(row.paymentMethodId, row.stripeCustomerId);
  return {
    ...billingCardBody({
      brand: described?.brand ?? row.brand,
      last4: described?.last4 ?? row.last4,
      expMonth: described?.expMonth ?? null,
      expYear: described?.expYear ?? null,
      email: described?.email ?? null,
      wallet: described?.wallet ?? (row.brand === "link" ? "link" : null),
    }),
    terms,
  };
}

export async function createSetupIntent(db: Db, user: { id: string; email: string | null }) {
  const stripe = new Stripe(requireStripeSecret());
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
      terms: "card",
      openInvoiceId: null,
    };
  }
  const intent = await stripe.setupIntents.create(setupIntentCreateParams(row.stripeCustomerId, user.id));
  if (!intent.client_secret) throw new HttpError("Stripe did not return a client secret", 502);
  return { clientSecret: intent.client_secret, customerId: row.stripeCustomerId };
}

export async function removeSavedCard(db: Db, userId: string) {
  const key = requireStripeSecret();
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
  const saved = savedMethodFromStripe(method);
  if (!saved) return { received: true as const };
  if (customerId) {
    const attached = typeof method.customer === "string" ? method.customer : (method.customer?.id ?? null);
    if (attached !== customerId) {
      try {
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
      } catch (error) {
        const code = stripeErrorCode(error);
        if (code !== "resource_already_exists") {
          console.error(error instanceof Error ? error.message : "payment method was not attached");
        }
      }
    }
    try {
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : "default payment method was not set");
    }
  }
  await saveBillingMethod(db, userId, { paymentMethodId, brand: saved.brand, last4: saved.last4 });
  return { received: true as const };
}

export async function completeSetupIntent(db: Db, user: { id: string }, setupIntentId: string) {
  const id = setupIntentId.trim();
  if (!/^seti_[A-Za-z0-9]+$/.test(id)) throw new HttpError("Unknown setup", 400, "validation_error");
  const stripe = new Stripe(requireStripeSecret());
  const intent = await stripe.setupIntents.retrieve(id);
  const row = await billingCustomerForUser(db, user.id);
  if (!setupIntentBelongsToUser(intent, user.id, row?.stripeCustomerId ?? null)) {
    throw new HttpError("Unknown setup", 404, "not_found");
  }
  if (intent.status === "processing") throw new HttpError("The card is still confirming", 409, "setup_processing");
  if (intent.status !== "succeeded") throw new HttpError("The card was not saved", 409, "setup_failed");
  await applySucceededSetupIntent(db, stripe, intent);
  return currentBillingCard(db, user.id);
}

async function adoptStripeMethod(
  db: Db,
  row: { userId: string; stripeCustomerId: string },
): Promise<void> {
  try {
    const stripe = new Stripe(requireStripeSecret());
    const customer = await stripe.customers.retrieve(row.stripeCustomerId);
    if (customer.deleted) return;
    const intents = await stripe.setupIntents.list({ customer: row.stripeCustomerId, limit: 5 });
    const succeeded = intents.data.find((intent) => intent.status === "succeeded" && intent.payment_method);
    if (succeeded) {
      await applySucceededSetupIntent(db, stripe, succeeded);
      return;
    }
    const defaultMethod = customer.invoice_settings?.default_payment_method;
    const paymentMethodId = typeof defaultMethod === "string" ? defaultMethod : (defaultMethod?.id ?? null);
    if (!paymentMethodId) return;
    const method = await stripe.paymentMethods.retrieve(paymentMethodId);
    const saved = savedMethodFromStripe(method);
    if (!saved) return;
    await saveBillingMethod(db, row.userId, { paymentMethodId, brand: saved.brand, last4: saved.last4 });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "billing method lookup failed");
  }
}

function stripeErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String((error as { code?: unknown }).code ?? "");
}
