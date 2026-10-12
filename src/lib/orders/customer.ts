import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { downloadGate } from "./access";
import { DOWNLOAD_URL_SECONDS, FINALS_BUCKET, PREVIEW_URL_SECONDS } from "./constants";
import {
  confirmFields,
  customerEmail,
  ensurePendingDelivery,
  getDelivery,
  getOrderById,
  hasEvent,
  insertCorrection,
  insertEvent,
  insertPayment,
  latestReadyPreview,
  listCorrections,
  listDocuments,
  listPages,
  markPaymentFailed,
  markPaymentPaid,
  markPaymentRefunded,
  paymentByIntent,
  paymentBySession,
  requireOrderByHash,
  settledPayment,
  updateOrder,
  withCombinedNumbers,
} from "./db";
import { HttpError } from "./errors";
import { CONFIRMATION_FIELD_KEYS, normalizeDateFormat, type ConfirmationFieldKey } from "./fields";
import { appOrigin } from "./email";
import { normalizeLanguage } from "./languages";
import { loadCustomerOrder } from "./pipeline";
import { previewSignedTargets } from "./preview-targets";
import { serviceDb, signedObjectUrl, type Db } from "./storage";
import { assertOrderTokenShape, hashOrderToken } from "./token";
import { parseCorrectionBody } from "./corrections";
import { decideChargeRefunded, decideCheckoutCompleted } from "./webhook";
import { previewPages, type CustomerOrder, type PreviewResponse } from "./view";

async function orderForToken(token: string) {
  assertOrderTokenShape(token);
  const db = serviceDb();
  const order = await requireOrderByHash(db, hashOrderToken(token));
  return { db, order, token };
}

export async function getOrder(token: string): Promise<CustomerOrder> {
  const { db, order } = await orderForToken(token);
  return loadCustomerOrder(db, order);
}

export async function confirmOrder(token: string, body: unknown): Promise<CustomerOrder> {
  const { db, order } = await orderForToken(token);
  if (order.status !== "quoted") {
    throw new HttpError("This order is not ready to confirm.", 409);
  }

  const payload = readConfirmBody(body);
  const language = normalizeLanguage(payload.sourceLanguage);
  if (!language) throw new HttpError("Choose a source language.", 400);

  const documents = await listDocuments(db, order.id);
  const byId = new Map(documents.map((document) => [document.id, document]));
  if (payload.documents.length !== documents.length) {
    throw new HttpError("Confirm the fields for every document.", 400);
  }

  const fields: Array<{ documentId: string; fieldKey: string; confirmedValue: string }> = [];
  const seen = new Set<string>();
  for (const document of payload.documents) {
    if (!byId.has(document.documentId)) throw new HttpError("Unknown document.", 400);
    if (seen.has(document.documentId)) throw new HttpError("Confirm each document once.", 400);
    seen.add(document.documentId);
    for (const key of CONFIRMATION_FIELD_KEYS) {
      const value = document.fields[key];
      fields.push({
        documentId: document.documentId,
        fieldKey: key,
        confirmedValue: key === "date_format" ? normalizeDateFormat(value) : value.trim(),
      });
    }
  }

  await confirmFields(db, order.id, fields);
  await updateOrder(db, order.id, {
    status: "confirmed",
    source_language: language,
    language_confirmed: true,
  });

  const updated = await requireOrderByHash(db, hashOrderToken(token));
  return loadCustomerOrder(db, updated);
}

export async function addCorrection(token: string, body: unknown) {
  const { db, order } = await orderForToken(token);
  if (order.status !== "preview_ready" && order.status !== "correction_requested" && order.status !== "processing") {
    throw new HttpError("A preview has to be ready before you can request a correction.", 409);
  }

  const payload = parseCorrectionBody(body);
  const documents = await listDocuments(db, order.id);
  const document = documents.find((item) => item.id === payload.documentId);
  if (!document) throw new HttpError("Unknown document.", 400);
  const pages = withCombinedNumbers(documents, await listPages(db, documents.map((item) => item.id)));
  const page = pages.find((item) => item.number === payload.page);
  if (!page || page.documentId !== document.id) {
    throw new HttpError("That page is not part of the document.", 400);
  }

  const correction = await insertCorrection(db, {
    orderId: order.id,
    documentId: document.id,
    pageNumber: payload.page,
    passage: payload.passage,
    note: payload.note,
  });
  if (order.status === "preview_ready") {
    await updateOrder(db, order.id, { status: "correction_requested" });
  }

  return {
    id: correction.id,
    documentId: correction.documentId,
    page: correction.pageNumber,
    quote: correction.passage,
    note: correction.note,
    status: "correction_requested" as const,
  };
}

export async function getPreview(token: string): Promise<PreviewResponse> {
  const { db, order } = await orderForToken(token);
  const preview = await latestReadyPreview(db, order.id);
  if (!preview || !order.combinedOriginalPath) {
    throw new HttpError("Preview is not ready", 409);
  }

  const documents = await listDocuments(db, order.id);
  const pages = previewPages(
    withCombinedNumbers(documents, await listPages(db, documents.map((document) => document.id))),
  );
  const targets = previewSignedTargets({
    combinedOriginalPath: order.combinedOriginalPath,
    previewPath: preview.previewPath,
  });
  const [originalUrl, translationUrl] = await Promise.all([
    signedObjectUrl(db, targets.original.bucket, targets.original.path, PREVIEW_URL_SECONDS),
    signedObjectUrl(db, targets.translation.bucket, targets.translation.path, PREVIEW_URL_SECONDS),
  ]);
  await insertEvent(db, order.id, "preview_viewed", { version: preview.version });

  const corrections = await listCorrections(db, order.id);
  return {
    status: order.status,
    totalCents: order.totalCents,
    unitPriceCents: order.unitPriceCents,
    billablePages: order.billablePages,
    original: { url: originalUrl, pageCount: pages.length, pages },
    translation: {
      url: translationUrl,
      pageCount: pages.length,
      pages,
      version: preview.version,
    },
    corrections: corrections.map((correction) => ({
      id: correction.id,
      documentId: correction.documentId,
      page: correction.pageNumber,
      quote: correction.passage,
      note: correction.note,
      status: correction.status,
      createdAt: correction.createdAt,
    })),
  };
}

export async function downloadOrderFile(token: string, file: string | null) {
  if (file !== "translation" && file !== "certification") {
    throw new HttpError("file must be translation or certification", 400);
  }
  const { db, order } = await orderForToken(token);
  const payment = await settledPayment(db, order.id);
  const delivery = await getDelivery(db, order.id);
  const gate = downloadGate({
    paymentStatus: payment?.status ?? null,
    deliveryStatus: delivery?.status ?? null,
  });
  if (!gate.ok) throw new HttpError(gate.error, gate.status);

  const path = file === "translation" ? delivery?.finalPath : delivery?.certificationPath;
  if (!path) throw new HttpError("That file is not ready", 404);
  const url = await signedObjectUrl(db, FINALS_BUCKET, path, DOWNLOAD_URL_SECONDS);
  await insertEvent(db, order.id, "downloaded", { file });
  return { url, expiresInSeconds: DOWNLOAD_URL_SECONDS };
}

export async function startCheckout(token: string) {
  const { db, order } = await orderForToken(token);
  if (order.status !== "preview_ready") throw new HttpError("Preview is not ready", 409);
  if (!order.languageConfirmed || !order.billablePages || order.totalCents == null) {
    throw new HttpError("This order is not ready to pay", 409);
  }
  if (await settledPayment(db, order.id)) throw new HttpError("This order is already paid", 409);

  if (process.env.CHECKOUT_PLACEHOLDER === "1") {
    await insertEvent(db, order.id, "checkout_started", { mode: "paid_test" });
    const sessionId = `paid_test_${randomUUID()}`;
    await insertPayment(db, {
      orderId: order.id,
      sessionId,
      amountCents: order.totalCents,
      status: "paid_test",
      paidAt: new Date().toISOString(),
    });
    await ensurePendingDelivery(db, order.id);
    await updateOrder(db, order.id, { status: "paid" });
    await insertEvent(db, order.id, "paid", { mode: "paid_test" });
    return { mode: "paid_test" as const, paymentStatus: "paid_test" as const, orderStatus: "paid" as const };
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new HttpError("Payments not configured", 503);

  await insertEvent(db, order.id, "checkout_started", { mode: "stripe" });
  const stripe = new Stripe(secret);
  const email = await customerEmail(db, order.customerId);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: email ?? undefined,
    client_reference_id: order.id,
    metadata: { order_id: order.id },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: order.currency,
          unit_amount: order.totalCents,
          product_data: {
            name: `CredPronto certified translation (${order.billablePages} pages)`,
          },
        },
      },
    ],
    success_url: `${appOrigin()}/order/${token}?checkout=success`,
    cancel_url: `${appOrigin()}/order/${token}?checkout=cancel`,
  });
  if (!session.url) throw new HttpError("Stripe did not return a checkout URL", 502);
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : null;
  await insertPayment(db, {
    orderId: order.id,
    sessionId: session.id,
    paymentIntentId: paymentIntent,
    amountCents: order.totalCents,
    status: "pending",
  });
  return { url: session.url, sessionId: session.id };
}

export async function handleStripeWebhook(request: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !secret) throw new HttpError("Payments not configured", 503);

  const stripe = new Stripe(key);
  const signature = request.headers.get("stripe-signature");
  if (!signature) throw new HttpError("Missing signature", 400);
  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    throw new HttpError("Invalid signature", 400);
  }
  const db = serviceDb();
  if (event.type === "charge.refunded") {
    return refundCharge(db, event.data.object as Stripe.Charge);
  }
  if (event.type !== "checkout.session.completed") return { received: true };

  const session = event.data.object as Stripe.Checkout.Session;
  const payment = await paymentBySession(db, session.id);
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : null;
  const chargedOrder = payment ? await getOrderById(db, payment.orderId) : null;
  const decision = decideCheckoutCompleted(
    payment
      ? { status: payment.status, amountCents: payment.amountCents, orderId: payment.orderId }
      : null,
    {
      sessionId: session.id,
      amountCents: session.amount_total,
      currency: session.currency,
      paymentIntentId: paymentIntent,
      orderId: session.metadata?.order_id ?? null,
    },
    chargedOrder ? { totalCents: chargedOrder.totalCents, currency: chargedOrder.currency } : null,
  );

  if (decision.action === "duplicate" || decision.action === "ignore") {
    return { received: true, duplicate: decision.action === "duplicate" };
  }
  if (decision.action === "fail") {
    if (payment) await markPaymentFailed(db, payment.id);
    return { received: true };
  }
  if (decision.action !== "mark_paid" || !payment) return { received: true };

  await markPaymentPaid(db, payment.id, decision.paymentIntentId);
  await ensurePendingDelivery(db, payment.orderId);
  const paidOrder = await getOrderById(db, payment.orderId);
  if (
    paidOrder &&
    paidOrder.status !== "paid" &&
    paidOrder.status !== "approved" &&
    paidOrder.status !== "delivered" &&
    paidOrder.status !== "cancelled"
  ) {
    await updateOrder(db, paidOrder.id, { status: "paid" });
  }
  if (!(await hasEvent(db, payment.orderId, "paid"))) {
    await insertEvent(db, payment.orderId, "paid", { mode: "stripe" });
  }
  return { received: true };
}

type ConfirmDocument = {
  documentId: string;
  fields: Record<ConfirmationFieldKey, string>;
};

async function refundCharge(db: Db, charge: Stripe.Charge) {
  const paymentIntent =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null;
  const payment = paymentIntent ? await paymentByIntent(db, paymentIntent) : null;
  const order = payment ? await getOrderById(db, payment.orderId) : null;
  const decision = decideChargeRefunded(
    payment
      ? { status: payment.status, amountCents: payment.amountCents, orderId: payment.orderId }
      : null,
    { amountCents: charge.amount, currency: charge.currency },
    order ? { totalCents: order.totalCents, currency: order.currency } : null,
  );
  if (decision.action === "duplicate" || decision.action === "ignore") {
    return { received: true, duplicate: decision.action === "duplicate" };
  }
  if (decision.action !== "mark_refunded" || !payment) return { received: true };

  await markPaymentRefunded(db, payment.id);
  if (!(await hasEvent(db, payment.orderId, "refunded"))) {
    await insertEvent(db, payment.orderId, "refunded", { mode: "stripe" });
  }
  return { received: true };
}

function readConfirmBody(body: unknown): { sourceLanguage: string; documents: ConfirmDocument[] } {
  if (!body || typeof body !== "object") throw new HttpError("Expected a JSON body", 400);
  const record = body as Record<string, unknown>;
  if (typeof record.sourceLanguage !== "string") throw new HttpError("sourceLanguage is required", 400);
  if (!Array.isArray(record.documents)) throw new HttpError("documents is required", 400);

  const documents = record.documents.map((entry) => {
    if (!entry || typeof entry !== "object") throw new HttpError("Invalid document confirmation", 400);
    const document = entry as Record<string, unknown>;
    if (typeof document.documentId !== "string") throw new HttpError("documentId is required", 400);
    const fields = {} as Record<ConfirmationFieldKey, string>;
    for (const key of CONFIRMATION_FIELD_KEYS) {
      const value = document[key];
      if (typeof value !== "string") throw new HttpError(`${key} is required`, 400);
      fields[key] = value;
    }
    return { documentId: document.documentId, fields };
  });

  return { sourceLanguage: record.sourceLanguage, documents };
}
