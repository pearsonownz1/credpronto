import Stripe from "stripe";
import { HttpError } from "@/lib/orders/errors";
import { offSessionPaymentParams } from "@/lib/orders/off-session";
import { requireStripeSecret } from "@/lib/orders/saved-card";
import { saveOpenInvoiceId, type BillingCustomerRow, type BillingTerms } from "@/lib/orders/integrations-db";
import type { Db } from "@/lib/orders/storage";
import { billingPageUrl } from "./catalog";

export const NET_DAYS_UNTIL_DUE = 30;

export type AccountBilling = {
  terms: BillingTerms;
  customerId: string | null;
  paymentMethodId: string | null;
  openInvoiceId: string | null;
};

export type BillingPlan =
  | { action: "card"; customerId: string; paymentMethodId: string }
  | { action: "invoice"; customerId: string; openInvoiceId: string | null }
  | { action: "refuse"; code: "billing_required" | "payments_not_configured"; message: string };

export function accountBilling(row: BillingCustomerRow | null): AccountBilling | null {
  if (!row) return null;
  return {
    terms: row.terms,
    customerId: row.stripeCustomerId || null,
    paymentMethodId: row.paymentMethodId,
    openInvoiceId: row.openInvoiceId,
  };
}

export function billingChargePlan(input: {
  account: AccountBilling | null;
  stripeKey: string | null;
}): BillingPlan {
  const key = input.stripeKey ?? "";
  const configured = key.startsWith("sk_test_") || key.startsWith("sk_live_");
  if (!configured) {
    return { action: "refuse", code: "payments_not_configured", message: "Payments not configured" };
  }
  const account = input.account;
  if (account?.terms === "net" && account.customerId) {
    return { action: "invoice", customerId: account.customerId, openInvoiceId: account.openInvoiceId };
  }
  if (account?.customerId && account.paymentMethodId) {
    return { action: "card", customerId: account.customerId, paymentMethodId: account.paymentMethodId };
  }
  return {
    action: "refuse",
    code: "billing_required",
    message: "Add a payment method before placing an order.",
  };
}

export function billingRequiredError(origin?: string): HttpError {
  const billingUrl = billingPageUrl(origin);
  return new HttpError("Add a payment method before placing an order.", 402, "billing_required", { billingUrl });
}

export type ChargeReceipt = {
  payment: "card" | "invoice";
  amountCents: number;
  currency: string;
  receiptId: string | null;
  invoiceId: string | null;
  paymentIntentId: string | null;
};

export type CardCharger = {
  charge(input: {
    customerId: string;
    paymentMethodId: string;
    amountCents: number;
    currency: string;
    orderId: string;
  }): Promise<{ paymentIntentId: string; receiptId: string }>;
};

export type InvoiceCharger = {
  add(input: {
    customerId: string;
    openInvoiceId: string | null;
    amountCents: number;
    currency: string;
    orderId: string;
    userId: string;
    db: Db;
  }): Promise<{ invoiceId: string }>;
};

export function assertBillableAmount(amountCents: number): void {
  if (!Number.isInteger(amountCents) || amountCents < 1) {
    throw new HttpError("This order cannot be priced", 409, "quote_unavailable");
  }
}

export async function chargeAccount(input: {
  db: Db;
  userId: string;
  orderId: string;
  amountCents: number;
  currency: string;
  account: AccountBilling | null;
  stripeKey: string | null;
  card: CardCharger;
  invoice: InvoiceCharger;
}): Promise<ChargeReceipt> {
  assertBillableAmount(input.amountCents);
  const plan = billingChargePlan({ account: input.account, stripeKey: input.stripeKey });
  if (plan.action === "refuse") {
    if (plan.code === "billing_required") throw billingRequiredError();
    throw new HttpError(plan.message, 503, plan.code);
  }
  if (plan.action === "invoice") {
    const added = await input.invoice.add({
      customerId: plan.customerId,
      openInvoiceId: plan.openInvoiceId,
      amountCents: input.amountCents,
      currency: input.currency,
      orderId: input.orderId,
      userId: input.userId,
      db: input.db,
    });
    return {
      payment: "invoice",
      amountCents: input.amountCents,
      currency: input.currency,
      receiptId: null,
      invoiceId: added.invoiceId,
      paymentIntentId: null,
    };
  }
  try {
    const charged = await input.card.charge({
      customerId: plan.customerId,
      paymentMethodId: plan.paymentMethodId,
      amountCents: input.amountCents,
      currency: input.currency,
      orderId: input.orderId,
    });
    return {
      payment: "card",
      amountCents: input.amountCents,
      currency: input.currency,
      receiptId: charged.receiptId,
      invoiceId: null,
      paymentIntentId: charged.paymentIntentId,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Stripe.errors.StripeCardError) {
      throw new HttpError("The card was declined", 402, "card_declined");
    }
    throw new HttpError("The card was declined", 402, "card_declined");
  }
}

export function liveCardCharger(): CardCharger {
  return {
    async charge(input) {
      const stripe = new Stripe(requireStripeSecret());
      try {
        const intent = await stripe.paymentIntents.create(
          { ...offSessionPaymentParams(input), expand: ["latest_charge"] },
          { idempotencyKey: `mcp-order-${input.orderId}` },
        );
        if (intent.status !== "succeeded") {
          throw new HttpError("The card was declined", 402, "card_declined");
        }
        const charge = intent.latest_charge;
        const receiptId = typeof charge === "string" ? charge : charge?.id || intent.id;
        return { paymentIntentId: intent.id, receiptId };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (error instanceof Stripe.errors.StripeCardError) {
          throw new HttpError("The card was declined", 402, "card_declined");
        }
        throw new HttpError("Payments not configured", 503, "payments_not_configured");
      }
    },
  };
}

export function liveInvoiceCharger(): InvoiceCharger {
  return {
    async add(input) {
      const stripe = new Stripe(requireStripeSecret());
      let invoiceId = input.openInvoiceId;
      if (invoiceId) {
        try {
          const existing = await stripe.invoices.retrieve(invoiceId);
          if (existing.status !== "draft") invoiceId = null;
        } catch {
          invoiceId = null;
        }
      }
      if (!invoiceId) {
        const created = await stripe.invoices.create(
          {
            customer: input.customerId,
            collection_method: "send_invoice",
            days_until_due: NET_DAYS_UNTIL_DUE,
            auto_advance: false,
            pending_invoice_items_behavior: "exclude",
            metadata: { user_id: input.userId },
          },
          { idempotencyKey: `mcp-invoice-${input.orderId}` },
        );
        invoiceId = created.id;
        await saveOpenInvoiceId(input.db, input.userId, invoiceId);
      }
      await stripe.invoiceItems.create(
        {
          customer: input.customerId,
          invoice: invoiceId,
          amount: input.amountCents,
          currency: input.currency,
          description: `CredPronto order ${input.orderId}`,
          metadata: { order_id: input.orderId },
        },
        { idempotencyKey: `mcp-invoice-item-${input.orderId}` },
      );
      return { invoiceId };
    },
  };
}

export function publicCharge(receipt: ChargeReceipt, orderId: string, status: string) {
  return {
    orderId,
    status,
    amountCents: receipt.amountCents,
    currency: receipt.currency,
    payment: receipt.payment,
    receiptId: receipt.receiptId,
    invoiceId: receipt.invoiceId,
    paymentIntentId: receipt.paymentIntentId,
  };
}
