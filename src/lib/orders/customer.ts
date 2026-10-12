import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { addonStripeLines, parseCheckoutBody, serviceCents } from "./addons";
import { checkoutBlockReason } from "./equivalency";
import { downloadGate } from "./access";
import { checkoutPreviewImageUrl } from "./checkout-image";
import { checkoutLineProduct, checkoutProductDescription } from "./checkout-preview";
import { checkoutPriceLines, evaluationQuote } from "./evaluation-price";
import { DOWNLOAD_URL_SECONDS, FINALS_BUCKET, ORIGINALS_BUCKET, PREVIEWS_BUCKET, PREVIEW_URL_SECONDS } from "./constants";
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
  listCorrections,
  listReadyPreviewPaths,
  listDocuments,
  listOrderAddons,
  listPages,
  updatePageQuote,
  markDocuments,
  markPaymentExpired,
  markPaymentFailed,
  markPaymentPaid,
  markPaymentRefunded,
  paymentByIntent,
  paymentBySession,
  replaceOrderAddons,
  restorePreviewReadyOrder,
  requireOrderByHash,
  settledPayment,
  updateDocument,
  updateOrder,
  withCombinedNumbers,
} from "./db";
import { HttpError } from "./errors";
import { assertUploadBudget, resolveUploadMime, safeFilename } from "./files";
import { replacementAllowed } from "./image-quality";
import { CONFIRMATION_FIELD_KEYS, normalizeDateFormat, type ConfirmationFieldKey } from "./fields";
import { appOrigin, orderLink, sendPaymentReceipt } from "./email";
import { formatPaymentMethod, receiptLineItems } from "./email-templates";
import { applySucceededSetupIntent } from "./saved-card";
import { retryEvaluation } from "./evaluation";
import { isSupportedTargetLanguage, languagesEqual, normalizeLanguage } from "./languages";
import { decideQuote, englishSourceWithoutTarget, etaFromNow, SAME_LANGUAGE_REASON } from "./quote";
import { previewOriginalPath, pricePage } from "./page-skip";
import { translateOrder } from "./translation";
import { loadCustomerOrder } from "./pipeline";
import { orderDownloadFilename } from "./download-name";
import { originalDownloadResponse, originalTargets } from "./originals";
import { evaluationPreviewSources } from "./preview-documents";
import { previewSignedTargets, type StorageTarget } from "./preview-targets";
import { serviceDb, signedObjectUrl, uploadObject, type Db } from "./storage";
import { assertOrderTokenShape, hashOrderToken } from "./token";
import { parseCorrectionBody } from "./corrections";
import { decideChargeRefunded, decideCheckoutCompleted, decideCheckoutExpired } from "./webhook";
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

const PAID_STATUSES = new Set(["paid", "approved", "delivered"]);

export function readTargetLanguage(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError("targetLanguage is required", 400);
  }
  const value = (body as { targetLanguage?: unknown }).targetLanguage;
  if (typeof value !== "string" || !value.trim()) throw new HttpError("targetLanguage is required", 400);
  const code = normalizeLanguage(value);
  if (!code || !isSupportedTargetLanguage(code)) {
    throw new HttpError("Choose a supported target language.", 400);
  }
  return code;
}

export function readOrderPatch(body: unknown): { targetLanguage: string | null; skipPages: number[] | null } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError("Expected a JSON body", 400);
  }
  const record = body as { targetLanguage?: unknown; skipPages?: unknown };
  const hasTarget = typeof record.targetLanguage === "string" && record.targetLanguage.trim().length > 0;
  const hasSkip = record.skipPages !== undefined;
  if (!hasTarget && !hasSkip) {
    throw new HttpError("targetLanguage or skipPages is required", 400);
  }
  return {
    targetLanguage: hasTarget ? readTargetLanguage({ targetLanguage: record.targetLanguage }) : null,
    skipPages: hasSkip ? readSkipPages(record.skipPages) : null,
  };
}

function readSkipPages(value: unknown): number[] {
  if (!Array.isArray(value)) throw new HttpError("skipPages must be a list of page numbers.", 400);
  const pages: number[] = [];
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 1) {
      throw new HttpError("skipPages must be a list of page numbers.", 400);
    }
    pages.push(entry);
  }
  if (new Set(pages).size !== pages.length) {
    throw new HttpError("skipPages must be a list of page numbers.", 400);
  }
  return pages;
}

/**
 * Saves a target language and the full skip list before payment, re-quotes,
 * and rebuilds a preview when the order already has a confirmed source.
 * Clears an en → en hold.
 */
export async function updateOrderTarget(token: string, body: unknown): Promise<CustomerOrder> {
  const { db, order, token: rawToken } = await orderForToken(token);
  if (order.status === "cancelled") throw new HttpError("This order can no longer be changed", 409);
  if (PAID_STATUSES.has(order.status) || (await settledPayment(db, order.id))) {
    throw new HttpError("This order is already paid", 409);
  }
  const patch = readOrderPatch(body);
  const targetLanguage = patch.targetLanguage ?? order.targetLanguage;
  if (patch.targetLanguage && order.sourceLanguage && languagesEqual(order.sourceLanguage, patch.targetLanguage)) {
    throw new HttpError("Choose a target language that is different from the source.", 400);
  }

  if (order.service && order.degreeCount != null) {
    return updateEvaluationTarget(db, order, targetLanguage, patch.skipPages);
  }
  return updateTranslationTarget(db, order, rawToken, targetLanguage, patch.skipPages);
}

async function updateTranslationTarget(
  db: Db,
  order: Awaited<ReturnType<typeof orderForToken>>["order"],
  token: string,
  targetLanguage: string,
  skipPages: number[] | null,
): Promise<CustomerOrder> {
  const documents = await listDocuments(db, order.id);
  const repriced = await applyPageQuote(db, order, targetLanguage, skipPages);
  const detected = [
    ...new Set(documents.map((document) => document.detectedLanguage).filter((language): language is string => Boolean(language))),
  ];
  const confidences = documents
    .map((document) => document.confidence)
    .filter((confidence): confidence is number => confidence != null);
  const decision = decideQuote({
    billableUnits:
      repriced.priced.length > 0
        ? repriced.priced.map((page) => page.billableUnits)
        : order.billablePages != null
          ? [order.billablePages]
          : [],
    pageNeedsReview: repriced.pageNeedsReview,
    language: order.sourceLanguage,
    confidence: confidences.length > 0 ? Math.min(...confidences) : order.sourceLanguage ? 1 : null,
    detectionAvailable: order.sourceLanguage != null,
    languagesDisagree: detected.length > 1,
    imageQuality: order.reviewReason === "image_quality",
    unitPriceCents: order.unitPriceCents,
    targetLanguage,
  });
  const startPreview = decision.status === "quoted" && order.languageConfirmed && decision.billablePages > 0;
  await updateOrder(db, order.id, {
    target_language: targetLanguage,
    status: startPreview ? "confirmed" : decision.status,
    review_reason: decision.reviewReason,
    billable_pages: repriced.priced.length > 0 ? decision.billablePages : order.billablePages,
    total_cents: decision.totalCents + order.addonCents,
    eta_at: etaFromNow(decision.etaHours),
  });
  if (startPreview) await translateOrder(db, order.id, token);
  const updated = await getOrderById(db, order.id);
  if (!updated) throw new HttpError("Order not found", 404);
  return loadCustomerOrder(db, updated);
}

async function applyPageQuote(
  db: Db,
  order: Awaited<ReturnType<typeof orderForToken>>["order"],
  targetLanguage: string,
  skipPages: number[] | null,
): Promise<{
  billablePages: number;
  pageNeedsReview: boolean[];
  priced: Array<{ billableUnits: number }>;
}> {
  const documents = await listDocuments(db, order.id);
  const pages = withCombinedNumbers(
    documents,
    await listPages(
      db,
      documents.map((document) => document.id),
    ),
  );
  if (pages.length === 0) {
    return { billablePages: order.billablePages ?? 0, pageNeedsReview: [], priced: [] };
  }
  const known = new Set(pages.map((page) => page.number));
  if (skipPages) {
    for (const index of skipPages) {
      if (!known.has(index)) throw new HttpError("Unknown page.", 400);
    }
  }
  const pageNeedsReview: boolean[] = [];
  const priced: Array<{ billableUnits: number }> = [];
  for (const page of pages) {
    const quote = pricePage({
      text: page.ocrText ?? "",
      targetLanguage,
      pageIndex: page.number,
      skipPages,
    });
    pageNeedsReview.push(quote.skip ? false : page.needsReview);
    priced.push({ billableUnits: quote.billableUnits });
    await updatePageQuote(db, page.id, {
      wordCount: quote.units,
      billableUnits: quote.billableUnits,
      billingBasis: "units",
      skip: quote.skip,
      skipReason: quote.skipReason,
    });
  }
  return {
    billablePages: priced.reduce((sum, page) => sum + page.billableUnits, 0),
    pageNeedsReview,
    priced,
  };
}

async function updateEvaluationTarget(
  db: Db,
  order: Awaited<ReturnType<typeof orderForToken>>["order"],
  targetLanguage: string,
  skipPages: number[] | null,
): Promise<CustomerOrder> {
  if (!order.service || order.degreeCount == null) throw new HttpError("This order is not an evaluation", 409);
  const repriced = await applyPageQuote(db, order, targetLanguage, skipPages);
  const quote = evaluationQuote({
    service: order.service,
    degreeCount: order.degreeCount,
    sourceLanguage: order.sourceLanguage,
    targetLanguage,
    billablePages: repriced.billablePages,
  });
  const clearing =
    order.reviewReason === SAME_LANGUAGE_REASON ||
    (order.reviewReason ?? "").startsWith("The document appears to already be in English") ||
    englishSourceWithoutTarget(order.sourceLanguage, order.targetLanguage);
  const keepHold = order.reviewReason === "image_quality";
  await updateOrder(db, order.id, {
    target_language: targetLanguage,
    billable_pages: repriced.priced.length > 0 ? repriced.billablePages : order.billablePages,
    evaluation_cents: quote.evaluationCents,
    translation_cents: quote.translationCents,
    total_cents: quote.totalCents + order.addonCents,
    ...(clearing && !keepHold ? { review_reason: null } : {}),
  });
  const next = {
    ...order,
    targetLanguage,
    evaluationCents: quote.evaluationCents,
    translationCents: quote.translationCents,
    totalCents: quote.totalCents + order.addonCents,
    reviewReason: clearing && !keepHold ? null : order.reviewReason,
  };
  if (order.sourceLanguage && !keepHold && order.status !== "draft") {
    await retryEvaluation(db, next, order.sourceLanguage);
  }
  const updated = await getOrderById(db, order.id);
  if (!updated) throw new HttpError("Order not found", 404);
  return loadCustomerOrder(db, updated);
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
  });

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
  const included = pages.filter((item) => item.skip !== true);
  const page = included[payload.page - 1];
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

/** One signature per preview object, so two links to the same path share one URL. */
async function signPreviewPaths(
  db: Db,
  combinedOriginalPath: string,
  paths: readonly string[],
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    paths.map(async (path) => {
      const target = previewSignedTargets({
        combinedOriginalPath,
        previewPath: path,
      }).translation;
      const url = await signedObjectUrl(db, target.bucket, target.path, PREVIEW_URL_SECONDS);
      return [path, url] as const;
    }),
  );
  return new Map(entries);
}

export async function getPreview(token: string): Promise<PreviewResponse> {
  const { db, order } = await orderForToken(token);
  const preview = await latestReadyPreview(db, order.id);
  if (!preview || !order.combinedOriginalPath) {
    throw new HttpError("Preview is not ready", 409);
  }

  const documents = await listDocuments(db, order.id);
  const numbered = withCombinedNumbers(documents, await listPages(db, documents.map((document) => document.id)));
  const included = numbered.filter((page) => page.skip !== true);
  const pages = previewPages(
    documents,
    included.map((page, index) => ({ ...page, number: index + 1 })),
  );
  const skipped = included.length !== numbered.length;
  const sources = evaluationPreviewSources({
    service: order.service,
    previewPath: preview.previewPath,
    previewPaths: await listReadyPreviewPaths(db, order.id),
  });
  const signedTargets = previewSignedTargets({
    combinedOriginalPath: order.combinedOriginalPath,
    previewPath: sources.viewerPath,
  });
  const originalTarget: StorageTarget = skipped
    ? { bucket: PREVIEWS_BUCKET, path: previewOriginalPath(order.id, preview.version) }
    : signedTargets.original;
  const previewPaths = [
    ...new Set(
      [sources.viewerPath, sources.reportPath, sources.translationPath].filter(
        (path): path is string => Boolean(path),
      ),
    ),
  ];
  const [originalUrl, signedPreviews] = await Promise.all([
    signedObjectUrl(db, originalTarget.bucket, originalTarget.path, PREVIEW_URL_SECONDS),
    signPreviewPaths(db, order.combinedOriginalPath, previewPaths),
  ]);
  const translationUrl = signedPreviews.get(sources.viewerPath);
  if (!translationUrl) throw new HttpError("Preview is not ready", 409);
  const reportUrl = sources.reportPath ? signedPreviews.get(sources.reportPath) ?? null : null;
  await insertEvent(db, order.id, "preview_viewed", { version: preview.version });

  const corrections = await listCorrections(db, order.id);
  return {
    status: order.status,
    totalCents: order.totalCents,
    unitPriceCents: order.unitPriceCents,
    billablePages: order.billablePages,
    original: { url: originalUrl, pageCount: pages.length, pages },
    translation: {
      url: sources.translationPath ? signedPreviews.get(sources.translationPath) ?? translationUrl : translationUrl,
      pageCount: pages.length,
      pages,
      version: preview.version,
    },
    report: reportUrl
      ? { url: reportUrl, pageCount: order.evaluationResult?.pageCount ?? pages.length }
      : null,
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
  const delivery = await getDelivery(db, order.id);
  const gate = downloadGate({
    paymentStatus: payment?.status ?? null,
    deliveryStatus: delivery?.status ?? null,
  });
  if (!gate.ok) throw new HttpError(gate.error, gate.status);

  const path = file === "certification" ? delivery?.certificationPath : delivery?.finalPath;
  if (!path) throw new HttpError("That file is not ready", 404);
  const documents = await listDocuments(db, order.id);
  const filename = orderDownloadFilename(
    file,
    documents.map((document) => document.filename),
    order.targetLanguage,
  );
  const url = await signedObjectUrl(db, FINALS_BUCKET, path, DOWNLOAD_URL_SECONDS, { download: filename });
  await insertEvent(db, order.id, "downloaded", { file });
  return { url, filename, expiresInSeconds: DOWNLOAD_URL_SECONDS };
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
  const { db, order } = await orderForToken(token);
  const blocked = checkoutBlockReason(order);
  if (blocked) throw new HttpError(blocked, 409);
  if (await settledPayment(db, order.id)) throw new HttpError("This order is already paid", 409);
  const selection = parseCheckoutBody(body, order.billablePages);
  const base = serviceCents(order);
  if (base == null) throw new HttpError("This order is not ready to pay", 409);
  const total = base + selection.addonCents;
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
    await emailPaymentReceipt(db, {
      order,
      token,
      receiptNumber: payment.id,
      paidAt: payment.paidAt ?? paidAt,
      totalCents: total,
      paymentLabel: "Test checkout",
      addons: selection.addons,
    });
    return { mode: "paid_test" as const, paymentStatus: "paid_test" as const, orderStatus: "paid" as const };
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new HttpError("Payments not configured", 503);

  await insertEvent(db, order.id, "checkout_started", { mode: "stripe" });
  const stripe = new Stripe(secret);
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
  const session = await stripe.checkout.sessions.create({
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
    success_url: `${appOrigin()}/order/${token}?checkout=success`,
    cancel_url: `${appOrigin()}/order/${token}?checkout=cancel`,
  });
  if (!session.url) throw new HttpError("Stripe did not return a checkout URL", 502);
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : null;
  await insertPayment(db, {
    orderId: order.id,
    sessionId: session.id,
    paymentIntentId: paymentIntent,
    amountCents: total,
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
  const receiptOrder = paidOrder ?? chargedOrder;
  if (receiptOrder) {
    const paidAt = new Date().toISOString();
    await emailPaymentReceipt(db, {
      order: receiptOrder,
      token: session.metadata?.order_token ?? orderTokenFromSuccessUrl(session.success_url),
      receiptNumber: payment.id,
      paidAt,
      totalCents: payment.amountCents,
      paymentLabel: await stripePaymentLabel(stripe, decision.paymentIntentId),
    });
  }
  return { received: true };
}

function orderTokenFromSuccessUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const match = /^\/order\/([^/]+)$/.exec(parsed.pathname);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

async function stripePaymentLabel(stripe: Stripe, paymentIntentId: string | null): Promise<string | null> {
  if (!paymentIntentId) return null;
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["payment_method"] });
    const method = intent.payment_method;
    if (!method || typeof method === "string") return null;
    return formatPaymentMethod(method.card?.brand, method.card?.last4);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "card lookup failed");
    return null;
  }
}

async function emailPaymentReceipt(
  db: Db,
  input: {
    order: NonNullable<Awaited<ReturnType<typeof getOrderById>>>;
    token: string | null;
    receiptNumber: string;
    paidAt: string;
    totalCents: number;
    paymentLabel: string | null;
    addons?: Awaited<ReturnType<typeof listOrderAddons>>;
  },
): Promise<void> {
  if (!input.token) return;
  const email = await customerEmail(db, input.order.customerId);
  if (!email) return;
  const addons = input.addons ?? (await listOrderAddons(db, input.order.id));
  try {
    await sendPaymentReceipt(email, {
      downloadUrl: orderLink(input.token),
      receiptNumber: input.receiptNumber,
      paidAt: input.paidAt,
      paymentLabel: input.paymentLabel,
      totalCents: input.totalCents,
      lines: receiptLineItems({
        service: input.order.service,
        degreeCount: input.order.degreeCount,
        evaluationCents: input.order.evaluationCents,
        translationCents: input.order.translationCents,
        billablePages: input.order.billablePages,
        unitPriceCents: input.order.unitPriceCents,
        addons,
      }),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "receipt email failed");
  }
}

type ConfirmDocument = {
  documentId: string;
  fields: Record<ConfirmationFieldKey, string>;
};

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
