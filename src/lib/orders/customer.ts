import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { addonStripeLines, parseCheckoutBody, serviceCents } from "./addons";
import { rejectCustomerTotal } from "./direct-upload";
import { checkoutBlockReason } from "./equivalency";
import { downloadGate } from "./access";
import { checkoutPreviewImageUrl } from "./checkout-image";
import { checkoutLineProduct, checkoutProductDescription } from "./checkout-preview";
import {
  checkoutPriceLines,
  checkoutQuotePending,
  checkoutServiceCharge,
  customerServiceQuote,
  serviceChoiceFromBody,
} from "./evaluation-price";
import { orderHasEvaluation, resolveServices, selectionPricePatch, servicesWithTranslation } from "./service-selection";
import { bundleTranslationFile, deliveryFileTarget } from "./delivery-file";
import { withQuotedPages } from "./stored-pages";
import {
  DOWNLOAD_URL_SECONDS,
  FINALS_BUCKET,
  ORIGINALS_BUCKET,
  SOURCE_URL_SECONDS,
} from "./constants";
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
  latestPayment,
  latestReadyPreview,
  listBundleTranslationSignals,
  listDocuments,
  listPages,
  markDocuments,
  markPaymentExpired,
  markPaymentFailed,
  markPaymentPaid,
  markPaymentRefunded,
  paymentByIntent,
  paymentBySession,
  replaceOrderAddons,
  restorePreviewReadyOrder,
  setPageSkipped,
  settledPayment,
  updateDocument,
  updateOrder,
  withCombinedNumbers,
} from "./db";
import { HttpError } from "./errors";
import { paidWebhookEvent } from "./outbound-webhook";
import { assertUploadBudget, resolveUploadMime, safeFilename } from "./files";
import { replacementAllowed } from "./image-quality";
import {
  CONFIRMATION_FIELD_KEYS,
  EVALUATION_FIELD_KEYS,
  normalizeDateFormat,
  type ConfirmationFieldKey,
  type EvaluationFieldKey,
} from "./fields";
import { appOrigin } from "./email";
import { bundleTranslationDecision, resolveCustomerFinal } from "./final-file";
import { applySucceededSetupIntent } from "./saved-card";
import { normalizeLanguage } from "./languages";
import { compareCombinedPages } from "./page-order";
import { parseQuotePatch, quotePriceAfterSkip, sumQuotedBillable } from "./skip-pages";
import { loadCustomerOrder } from "./pipeline";
import { originalDownloadResponse, originalTargets } from "./originals";
import { sourceFileBody, sourceFileTarget, type SourceFileResponse } from "./source-file";
import { serviceDb, signedObjectUrl, uploadObject, type Db } from "./storage";
import { checkoutReturnUrl } from "./checkout-return";
import { parseCorrectionBody } from "./corrections";
import { decideChargeRefunded, decideCheckoutCompleted, decideCheckoutExpired } from "./webhook";
import { checkedProgress } from "./translation-watch";
import { orderForToken } from "./order-access";
import type { CustomerOrder } from "./view";

export async function getOrder(token: string): Promise<CustomerOrder> {
  const { db, order } = await orderForToken(token);
  return loadCustomerOrder(db, order);
}

export async function replaceOrderDocument(
  token: string,
  documentId: string,
  request: Request,
): Promise<CustomerOrder> {
  const { db, order } = await orderForToken(token);
  if (!replacementAllowed(order)) {
    throw new HttpError("Upload a replacement only while a photo needs to be retaken.", 409);
  }
  const documents = await listDocuments(db, order.id);
  const document = documents.find((item) => item.id === documentId);
  if (!document) throw new HttpError("Unknown document.", 400);

  const form = await request.formData();
  const entry = form.get("file") ?? form.get("files");
  if (!(entry instanceof File)) throw new HttpError("Upload a replacement file.", 400);
  const mime = resolveUploadMime(entry.name, entry.type || "");
  if (!mime) throw new HttpError(`Unsupported file type: ${entry.name}`, 415);
  const bytes = new Uint8Array(await entry.arrayBuffer());
  assertUploadBudget([{ size: bytes.byteLength }]);

  const path = `${order.id}/${document.id}/${randomUUID()}/${safeFilename(entry.name || "upload")}`;
  await uploadObject(db, ORIGINALS_BUCKET, path, bytes, mime);
  await updateDocument(db, document.id, {
    original_path: path,
    filename: entry.name || "upload",
    mime,
    size: bytes.byteLength,
    status: "uploaded",
    page_count: null,
    detected_language: null,
    confidence: null,
    applied_position: null,
  });
  await markDocuments(db, order.id, "uploaded");
  await updateOrder(db, order.id, {
    status: "draft",
    review_reason: null,
    page_order_basis: null,
    page_order: null,
    progress: { step: "uploaded", pagesRead: 0, pagesTotal: 0 },
  });

  const updated = await getOrderById(db, order.id);
  if (!updated) throw new HttpError("Order not found", 404);
  return loadCustomerOrder(db, updated);
}

export async function patchOrderQuote(token: string, body: unknown): Promise<CustomerOrder> {
  const { db, order } = await orderForToken(token);
  const patch = parseQuotePatch(body);
  if (order.status !== "quoted" && order.status !== "needs_review") {
    throw new HttpError("This quote can't be changed.", 409);
  }

  const orderPatch: Record<string, unknown> = {};
  if (patch.targetLanguage != null) {
    const language = normalizeLanguage(patch.targetLanguage);
    if (!language) throw new HttpError("Choose a target language.", 400);
    orderPatch.target_language = language;
  }

  let includeTranslation = order.includeTranslation;
  if (patch.includeTranslation != null && patch.services == null && patch.service == null) {
    if (!orderHasEvaluation(order) || order.degreeCount == null) {
      throw new HttpError("This order has no optional translation.", 400);
    }
    includeTranslation = patch.includeTranslation;
  }

  let degreeCount = order.degreeCount;
  if (patch.degreeCount != null && patch.services == null && patch.service == null) {
    if (!orderHasEvaluation(order)) {
      throw new HttpError("This order has no evaluation.", 400);
    }
    degreeCount = patch.degreeCount;
    orderPatch.degree_count = degreeCount;
  }

  const choice =
    patch.services || patch.service
      ? serviceChoiceFromBody(
          {
            ...(patch.services ? { services: patch.services } : {}),
            ...(patch.service ? { service: patch.service } : {}),
            ...(patch.includeTranslation != null ? { includeTranslation: patch.includeTranslation } : {}),
            ...(patch.degreeCount != null ? { degreeCount: patch.degreeCount } : {}),
          },
          order,
        )
      : null;
  const pricedOrder = choice
    ? {
        ...order,
        services: choice.services,
        service: choice.service,
        degreeCount: choice.degreeCount,
        includeTranslation: choice.includeTranslation,
        orderType: choice.orderType,
        serviceType: choice.orderType,
      }
    : { ...order, includeTranslation, degreeCount };

  if (patch.skipPages || patch.includeTranslation != null || patch.degreeCount != null || choice) {
    const documents = await listDocuments(db, order.id);
    const pages = [...(await listPages(db, documents.map((document) => document.id)))].sort((a, b) =>
      compareCombinedPages(documents, a, b),
    );
    let billablePages = order.billablePages ?? 0;
    if (patch.skipPages) {
      for (const index of patch.skipPages) {
        if (index >= pages.length) throw new HttpError("Unknown page.", 400);
      }
      const skip = new Set(patch.skipPages);
      for (const [index, page] of pages.entries()) {
        const skipped = skip.has(index);
        if ((page.skip === true) !== skipped) await setPageSkipped(db, page.id, skipped);
      }
      billablePages = sumQuotedBillable(
        pages.map((page, index) => ({
          billableUnits: page.billableUnits,
          skip: skip.has(index),
        })),
      );
    }
    const priced = quotePriceAfterSkip(pricedOrder, billablePages);
    orderPatch.billable_pages = priced.billablePages;
    orderPatch.total_cents = priced.totalCents;
    orderPatch.unit_price_cents = priced.unitPriceCents;
    if (choice) {
      orderPatch.services = choice.services;
      orderPatch.service = choice.service;
      orderPatch.degree_count = choice.degreeCount;
      orderPatch.order_type = choice.orderType;
      orderPatch.service_type = choice.orderType;
      orderPatch.include_translation = choice.includeTranslation;
      orderPatch.evaluation_cents = choice.orderType === "evaluation" ? priced.evaluationCents : null;
      orderPatch.translation_cents = choice.orderType === "evaluation" ? priced.translationCents : null;
    } else {
      if (priced.translationCents != null) orderPatch.translation_cents = priced.translationCents;
      if (priced.evaluationCents != null) orderPatch.evaluation_cents = priced.evaluationCents;
      if (orderHasEvaluation(pricedOrder)) {
        orderPatch.include_translation = priced.includeTranslation;
        orderPatch.services = servicesWithTranslation(
          resolveServices(pricedOrder),
          priced.includeTranslation,
        );
      }
    }
  }

  if (Object.keys(orderPatch).length > 0) await updateOrder(db, order.id, orderPatch);
  const updated = await getOrderById(db, order.id);
  if (!updated) throw new HttpError("Order not found", 404);
  return loadCustomerOrder(db, updated);
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
  const evaluation = orderHasEvaluation(order) && order.degreeCount != null;
  if (payload.documents == null) {
    if (!evaluation) throw new HttpError("Confirm the fields for every document.", 400);
  } else if (payload.documents.length !== documents.length) {
    throw new HttpError("Confirm the fields for every document.", 400);
  }

  const fields: Array<{ documentId: string; fieldKey: string; confirmedValue: string }> = [];
  const seen = new Set<string>();
  const includeTranslation = payload.includeTranslation ?? order.includeTranslation;
  for (const document of payload.documents ?? []) {
    if (!byId.has(document.documentId)) throw new HttpError("Unknown document.", 400);
    if (seen.has(document.documentId)) throw new HttpError("Confirm each document once.", 400);
    seen.add(document.documentId);
    if (document.kind === "evaluation") {
      for (const key of EVALUATION_FIELD_KEYS) {
        fields.push({
          documentId: document.documentId,
          fieldKey: key,
          confirmedValue: document.fields[key].trim(),
        });
      }
      continue;
    }
    for (const key of CONFIRMATION_FIELD_KEYS) {
      const value = document.fields[key];
      fields.push({
        documentId: document.documentId,
        fieldKey: key,
        confirmedValue: key === "date_format" ? normalizeDateFormat(value) : value.trim(),
      });
    }
  }

  if (fields.length > 0) await confirmFields(db, order.id, fields);
  const pricePatch: Record<string, unknown> = {};
  if (evaluation && order.degreeCount != null) {
    const services = servicesWithTranslation(resolveServices(order), includeTranslation);
    const priced = selectionPricePatch({
      services,
      includeTranslation,
      degreeCount: order.degreeCount,
      sourceLanguage: language,
      billablePages: order.billablePages ?? 0,
      addonCents: order.addonCents,
    });
    if (priced) Object.assign(pricePatch, priced, { services });
  }
  await updateOrder(db, order.id, {
    status: "confirmed",
    source_language: language,
    language_confirmed: true,
    progress: checkedProgress(order.progress, { step: "translating", retries: 0 }),
    ...pricePatch,
  });

  const updated = await getOrderById(db, order.id);
  if (!updated) throw new HttpError("Order not found", 404);
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
  await updateOrder(db, order.id, {
    ...(order.status === "preview_ready" ? { status: "correction_requested" } : {}),
    progress: checkedProgress(order.progress, { step: "translating", retries: 0 }),
  });

  return {
    id: correction.id,
    documentId: correction.documentId,
    page: correction.pageNumber,
    quote: correction.passage,
    note: correction.note,
    status: "correction_requested" as const,
  };
}

export async function downloadOrderFile(
  token: string,
  file: string | null,
  documentId: string | null = null,
) {
  if (file === "original") return downloadOriginals(token, documentId);
  if (file !== "translation" && file !== "certification" && file !== "evaluation") {
    throw new HttpError("file must be translation, certification, evaluation, or original", 400);
  }
  const { db, order } = await orderForToken(token);
  const payment = await settledPayment(db, order.id);
  const documents = await listDocuments(db, order.id);
  const names = documents.map((document) => document.filename);
  const bundled = bundleTranslationFile({
    includeTranslation: order.includeTranslation,
    file,
    translationPath: order.finalTranslationPath,
    documentNames: names,
    targetLanguage: order.targetLanguage,
  });
  if (bundled) {
    const delivery = await getDelivery(db, order.id);
    const signals = (await listBundleTranslationSignals(db, [order.id])).get(order.id);
    const decision = bundleTranslationDecision({
      includeTranslation: order.includeTranslation,
      status: order.status,
      paymentStatus: payment?.status ?? null,
      finalTranslationPath: order.finalTranslationPath,
      certificationPath: order.certificationPath,
      reviewReason: order.reviewReason,
      qa: signals?.qa ?? null,
      languageConfidence: signals?.languageConfidence ?? null,
      pageNeedsReview: signals?.pageNeedsReview === true,
      openCorrections: signals?.openCorrections === true,
      deliveryStatus: delivery?.status ?? null,
      deliveryFinalPath: delivery?.finalPath ?? null,
    });
    if (!decision.ok) throw new HttpError(decision.error, decision.status);
    const url = await signedObjectUrl(db, FINALS_BUCKET, bundled.path, DOWNLOAD_URL_SECONDS, {
      download: bundled.filename,
    });
    await insertEvent(db, order.id, "downloaded", { file });
    return { url, filename: bundled.filename, expiresInSeconds: DOWNLOAD_URL_SECONDS };
  }

  const delivery = await getDelivery(db, order.id);
  const gate = downloadGate({
    paymentStatus: payment?.status ?? null,
    deliveryStatus: delivery?.status ?? null,
  });
  if (!gate.ok) throw new HttpError(gate.error, gate.status);

  const allowed = deliveryFileTarget({
    file,
    service: order.service,
    services: order.services,
    orderType: order.orderType,
    serviceType: order.serviceType,
    finalPath: delivery?.finalPath ?? null,
    certificationPath: delivery?.certificationPath ?? null,
    documentNames: names,
    targetLanguage: order.targetLanguage,
    includeTranslation: order.includeTranslation,
  });
  if (!allowed || !delivery) throw new HttpError("That file is not ready", 404);
  const target = await resolveCustomerFinal(db, order, {
    finalPath: delivery.finalPath,
    certificationPath: delivery.certificationPath,
  });
  if (!target) throw new HttpError("That file is not ready", 404);
  const { path, filename } = target;
  const url = await signedObjectUrl(db, FINALS_BUCKET, path, DOWNLOAD_URL_SECONDS, { download: filename });
  await insertEvent(db, order.id, "downloaded", { file });
  return { url, filename, expiresInSeconds: DOWNLOAD_URL_SECONDS };
}

/** Original upload for one file on this order. The token is the same grant as GET /api/orders/[token]. */
export async function getSourceFile(token: string, fileId: string): Promise<SourceFileResponse> {
  const { db, order } = await orderForToken(token);
  const target = sourceFileTarget(await listDocuments(db, order.id), fileId);
  const url = await signedObjectUrl(db, target.bucket, target.path, SOURCE_URL_SECONDS);
  return sourceFileBody(url);
}

/** The customer's own uploads. The token is enough at any status; payment is not required. */
async function downloadOriginals(token: string, documentId: string | null) {
  const { db, order } = await orderForToken(token);
  const targets = originalTargets(await listDocuments(db, order.id), documentId);
  const signed = await Promise.all(
    targets.map(async (target) => ({
      documentId: target.documentId,
      documentIndex: target.documentIndex,
      documentName: target.documentName,
      filename: target.filename,
      url: await signedObjectUrl(db, target.bucket, target.path, DOWNLOAD_URL_SECONDS, {
        download: target.filename,
      }),
    })),
  );
  await insertEvent(db, order.id, "downloaded", {
    file: "original",
    documentIds: signed.map((item) => item.documentId),
  });
  return originalDownloadResponse(signed, DOWNLOAD_URL_SECONDS, documentId);
}

function serviceStripeLines(input: {
  order: {
    currency: string;
    billablePages: number | null;
    service: Parameters<typeof checkoutPriceLines>[0]["service"];
    services?: Parameters<typeof checkoutPriceLines>[0]["services"];
    includeTranslation?: boolean;
    orderType?: string | null;
    serviceType?: string | null;
    sourceLanguage?: string | null;
    degreeCount: number | null;
    evaluationCents: number | null;
    translationCents: number | null;
  };
  base: number;
  description: string;
  imageUrl: string | null;
}) {
  const lines = checkoutPriceLines({
    service: input.order.service,
    services: input.order.services,
    includeTranslation: input.order.includeTranslation,
    orderType: input.order.orderType,
    serviceType: input.order.serviceType,
    sourceLanguage: input.order.sourceLanguage,
    degreeCount: input.order.degreeCount,
    evaluationCents: input.order.evaluationCents,
    translationCents: input.order.translationCents,
    billablePages: input.order.billablePages,
    description: input.description,
    imageUrl: input.imageUrl,
  });
  if (!lines) {
    return [
      {
        quantity: 1,
        price_data: {
          currency: input.order.currency,
          unit_amount: input.base,
          product_data: checkoutLineProduct({
            billablePages: input.order.billablePages ?? 1,
            description: input.description,
            imageUrl: input.imageUrl,
          }),
        },
      },
    ];
  }
  return lines.map((line) => ({
    quantity: line.quantity,
    price_data: {
      currency: input.order.currency,
      unit_amount: line.unitAmountCents,
      product_data: {
        name: line.name,
        description: line.description,
        ...(line.imageUrl ? { images: [line.imageUrl] } : {}),
      },
    },
  }));
}

export async function startCheckout(token: string, body: unknown = {}) {
  const { db, order: stored } = await orderForToken(token);
  if (body && typeof body === "object" && !Array.isArray(body)) {
    rejectCustomerTotal(body as Record<string, unknown>);
  }
  const choice = serviceChoiceFromBody(body, stored);
  let order = stored;
  if (choice) {
    order = {
      ...stored,
      services: choice.services,
      service: choice.service,
      degreeCount: choice.degreeCount,
      includeTranslation: choice.includeTranslation,
      orderType: choice.orderType,
      serviceType: choice.orderType,
      ...(choice.orderType === "translation" ? { evaluationCents: null, translationCents: null } : {}),
    };
  }
  order = await withQuotedPages(db, order);
  if (choice) {
    await updateOrder(db, order.id, {
      services: choice.services,
      service: choice.service,
      degree_count: choice.degreeCount,
      include_translation: choice.includeTranslation,
      order_type: choice.orderType,
      service_type: choice.orderType,
      ...(choice.orderType === "translation" ? { evaluation_cents: null, translation_cents: null } : {}),
    });
  }
  const blocked = checkoutBlockReason(order);
  if (blocked) throw new HttpError(blocked, 409);
  if (await settledPayment(db, order.id)) throw new HttpError("This order is already paid", 409);
  if (checkoutQuotePending(order)) {
    throw new HttpError("We're still counting pages.", 409);
  }
  const selection = parseCheckoutBody(body, order.billablePages, order);
  const quoted = customerServiceQuote(order);
  const charge = checkoutServiceCharge(order);
  const base = charge?.serviceCents ?? (quoted.evaluation ? null : serviceCents(order));
  if (base == null) throw new HttpError("This order is not ready to pay", 409);
  const total = base + selection.addonCents;
  if (charge) {
    await updateOrder(db, order.id, {
      unit_price_cents: charge.unitPriceCents,
      evaluation_cents: charge.evaluationCents,
      translation_cents: charge.translationCents,
      include_translation: charge.includeTranslation,
      total_cents: charge.serviceCents + order.addonCents,
      ...(order.billablePages != null ? { billable_pages: order.billablePages } : {}),
    });
    order.unitPriceCents = charge.unitPriceCents;
    order.evaluationCents = charge.evaluationCents;
    order.translationCents = charge.translationCents;
    order.includeTranslation = charge.includeTranslation;
    order.totalCents = total;
  }
  await replaceOrderAddons(db, order.id, {
    addons: selection.addons,
    shippingAddress: selection.shippingAddress,
    addonCents: selection.addonCents,
    totalCents: total,
  });

  if (process.env.CHECKOUT_PLACEHOLDER === "1") {
    await insertEvent(db, order.id, "checkout_started", { mode: "paid_test" });
    const sessionId = `paid_test_${randomUUID()}`;
    const paidAt = new Date().toISOString();
    const payment = await insertPayment(db, {
      orderId: order.id,
      sessionId,
      amountCents: total,
      status: "paid_test",
      paidAt,
    });
    await ensurePendingDelivery(db, order.id);
    await updateOrder(db, order.id, { status: "paid" });
    await insertEvent(db, order.id, "paid", { mode: "paid_test" });
    const { notifyLifecycle } = await import("./webhook-delivery");
    await notifyLifecycle(db, order.id, paidWebhookEvent(order));
    const { settlePaidOrder } = await import("./paid-release");
    await settlePaidOrder(db, order.id);
    return { mode: "paid_test" as const, paymentStatus: "paid_test" as const, orderStatus: "paid" as const };
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new HttpError("Payments not configured", 503);

  await insertEvent(db, order.id, "checkout_started", { mode: "stripe" });
  const stripe = new Stripe(secret);
  const pending = await latestPayment(db, order.id);
  if (pending?.status === "pending" && pending.sessionId) {
    if (pending.amountCents === total) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(pending.sessionId);
        if (existing.status === "open" && existing.url) {
          return { url: existing.url, sessionId: existing.id };
        }
      } catch {
        // The stored session cannot be reopened. A new one is created below.
      }
    } else {
      try {
        await stripe.checkout.sessions.expire(pending.sessionId);
      } catch {
        // Already closed or expired.
      }
      await markPaymentExpired(db, pending.id);
    }
  }
  const email = await customerEmail(db, order.customerId);
  const documents = await listDocuments(db, order.id);
  const description = checkoutProductDescription({
    sourceLanguage: order.sourceLanguage,
    targetLanguage: order.targetLanguage,
    documentNames: documents.map((document) => document.filename),
    pages: order.billablePages ?? 0,
  });
  const preview = await latestReadyPreview(db, order.id);
  const imageUrl = preview ? await checkoutPreviewImageUrl(db, order.id, preview.previewPath) : null;
  const addonKey = selection.addons.map((item) => item.id).join(",");
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer_email: email ?? undefined,
      client_reference_id: order.id,
      metadata: { order_id: order.id, order_token: token },
      line_items: [
        ...serviceStripeLines({
          order,
          base,
          description,
          imageUrl,
        }),
        ...addonStripeLines(selection.addons).map((line) => ({
          quantity: line.quantity,
          price_data: {
            currency: order.currency,
            unit_amount: line.unitAmountCents,
            product_data: { name: line.name },
          },
        })),
      ],
      success_url: checkoutReturnUrl(appOrigin(), token, "success"),
      cancel_url: checkoutReturnUrl(appOrigin(), token, "cancel"),
    },
    { idempotencyKey: `checkout-${order.id}-${total}-${addonKey}` },
  );
  if (!session.url) throw new HttpError("Stripe did not return a checkout URL", 502);
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : null;
  try {
    await insertPayment(db, {
      orderId: order.id,
      sessionId: session.id,
      paymentIntentId: paymentIntent,
      amountCents: total,
      status: "pending",
    });
  } catch (error) {
    const recorded = await paymentBySession(db, session.id);
    if (!recorded) throw error;
  }
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
  if (event.type === "checkout.session.expired") {
    return expireCheckoutSession(db, event.data.object as Stripe.Checkout.Session);
  }
  if (event.type === "setup_intent.succeeded") {
    return applySucceededSetupIntent(db, stripe, event.data.object as Stripe.SetupIntent);
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
    if (decision.action === "duplicate" && payment) {
      const { settlePaidOrder } = await import("./paid-release");
      await settlePaidOrder(db, payment.orderId);
    }
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
    const { notifyLifecycle } = await import("./webhook-delivery");
    await notifyLifecycle(db, payment.orderId, paidWebhookEvent(paidOrder ?? chargedOrder));
  }
  const { settlePaidOrder } = await import("./paid-release");
  await settlePaidOrder(db, payment.orderId);
  return { received: true };
}

type ConfirmDocument =
  | { kind: "translation"; documentId: string; fields: Record<ConfirmationFieldKey, string> }
  | { kind: "evaluation"; documentId: string; fields: Record<EvaluationFieldKey, string> };

async function expireCheckoutSession(db: Db, session: Stripe.Checkout.Session) {
  const payment = await paymentBySession(db, session.id);
  const order = payment ? await getOrderById(db, payment.orderId) : null;
  const settled = payment ? await settledPayment(db, payment.orderId) : null;
  const latest = payment ? await latestPayment(db, payment.orderId) : null;
  const decision = decideCheckoutExpired(
    payment
      ? { status: payment.status, amountCents: payment.amountCents, orderId: payment.orderId }
      : null,
    order
      ? {
          status: order.status,
          settled: Boolean(settled),
          isLatestPayment: latest?.id === payment?.id,
        }
      : null,
  );

  if (decision.action === "duplicate" || decision.action === "ignore") {
    return { received: true, duplicate: decision.action === "duplicate" };
  }
  if (decision.action !== "expire" || !payment) return { received: true };

  await markPaymentExpired(db, payment.id);
  if (decision.reopenOrder) await restorePreviewReadyOrder(db, payment.orderId);
  return { received: true };
}

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

function readConfirmDocument(entry: unknown): ConfirmDocument {
  if (!entry || typeof entry !== "object") throw new HttpError("Invalid document confirmation", 400);
  const document = entry as Record<string, unknown>;
  if (typeof document.documentId !== "string") throw new HttpError("documentId is required", 400);
  const evaluation = EVALUATION_FIELD_KEYS.some((key) => key in document);
  if (evaluation) {
    const fields = {} as Record<EvaluationFieldKey, string>;
    for (const key of EVALUATION_FIELD_KEYS) {
      const value = document[key];
      if (typeof value !== "string") throw new HttpError(`${key} is required`, 400);
      fields[key] = value;
    }
    return { kind: "evaluation", documentId: document.documentId, fields };
  }
  const fields = {} as Record<ConfirmationFieldKey, string>;
  for (const key of CONFIRMATION_FIELD_KEYS) {
    const value = document[key];
    if (typeof value !== "string") throw new HttpError(`${key} is required`, 400);
    fields[key] = value;
  }
  return { kind: "translation", documentId: document.documentId, fields };
}

function readConfirmBody(body: unknown): {
  sourceLanguage: string;
  documents: ConfirmDocument[] | null;
  includeTranslation?: boolean;
} {
  if (!body || typeof body !== "object") throw new HttpError("Expected a JSON body", 400);
  const record = body as Record<string, unknown>;
  if (typeof record.sourceLanguage !== "string") throw new HttpError("sourceLanguage is required", 400);
  if ("includeTranslation" in record && typeof record.includeTranslation !== "boolean") {
    throw new HttpError("includeTranslation must be true or false.", 400);
  }
  const includeTranslation =
    typeof record.includeTranslation === "boolean" ? record.includeTranslation : undefined;
  if (record.documents == null) return { sourceLanguage: record.sourceLanguage, documents: null, includeTranslation };
  if (!Array.isArray(record.documents)) throw new HttpError("documents is required", 400);

  const documents = record.documents.map((entry) => readConfirmDocument(entry));

  return { sourceLanguage: record.sourceLanguage, documents, includeTranslation };
}
