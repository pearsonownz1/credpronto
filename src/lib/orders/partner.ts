import { randomUUID } from "node:crypto";
import { EXPEDITED_UNIT, parseCheckoutBody, selectedAddonIds } from "./addons";
import { analyzeOrder } from "./analysis";
import {
  bearerApiKey,
  hashApiKey,
  liveOrderPostBlocked,
  type ApiKeyPrefix,
} from "./api-key";
import { consumeApiKeyRate } from "./api-rate-limit";
import { DOWNLOAD_URL_SECONDS, FINALS_BUCKET, IMAGE_QUALITY_REASON } from "./constants";
import { storeFiles } from "./create";
import {
  ensurePendingDelivery,
  getDelivery,
  getOrderById,
  hasEvent,
  insertEvent,
  insertOrder,
  insertPayment,
  latestPayment,
  latestReadyPreview,
  listDocuments,
  listQaRuns,
  replaceOrderAddons,
  settledPayment,
  updateOrder,
  upsertCustomer,
  type Db,
} from "./db";
import { orderDownloadFilename } from "./download-name";
import { HttpError } from "./errors";
import { partnerReviewReason } from "./equivalency";
import { EVALUATION_REVIEW_REASON } from "./evaluation-price";
import { assertUploadBudget, dedupeUploads, resolveUploadMime } from "./files";
import { findActiveApiKey, orderByExternalRef, touchApiKeyLastUsed, type ApiKeyRow } from "./integrations-db";
import { isSupportedSourceLanguage } from "./languages";
import { asOrderProgress, publicOrderProgress, UPLOADED_PROGRESS, type OrderProgress } from "./reading-progress";
import { chargeOffSession, type OffSessionCharge } from "./off-session";
import { notifyLifecycle, notifyOrder } from "./webhook-delivery";
import { originalTargets } from "./originals";
import type { QaRunRecord } from "./qa";
import { signedObjectUrl, serviceDb } from "./storage";
import { generateOrderToken, hashOrderToken } from "./token";
import type { OrderRecord } from "./types";
import { downloadGate } from "./access";
import { fulfillmentState, type FulfillmentState } from "./release-decision";
import { isPreviewDelayed } from "./translation-watch";

export { EVALUATION_REVIEW_REASON };

export type PartnerService = "translation" | "evaluation";

export type PartnerOrderBody = {
  id: string;
  status: string;
  service: string;
  sourceLanguage: string | null;
  targetLanguage: string;
  externalRef: string | null;
  billablePages: number | null;
  unitPriceCents: number;
  /** Kept for older clients. New orders omit Expedited from `addonOptions`. */
  expeditedUnit: typeof EXPEDITED_UNIT;
  totalCents: number | null;
  currency: string;
  payment: { status: string } | null;
  progress: Omit<OrderProgress, "retries">;
  delayed: boolean;
  paidAt: string | null;
  fulfillment: FulfillmentState | null;
  reviewReason?: string | null;
  qa?: ReturnType<typeof qaSummary>;
};

export type CreatedPartnerOrder = {
  status: 200 | 201;
  body: PartnerOrderBody;
  orderId: string;
  startTranslation: boolean;
};

type QuoteInput = {
  status: string;
  billablePages: number | null;
  totalCents: number | null;
  reviewReason: string | null;
  sourceLanguage: string | null;
  service: PartnerService;
};

/**
 * Analysis quotes a draft only while the language is still unconfirmed, the same pass the website runs.
 * `source_language` is stored for that pass and confirmed after the quote. Confirming it first skips
 * analysis and leaves billable pages empty, which is `quote_unavailable`.
 */
export function apiOrderBeforeQuote(sourceLanguage: string | null): {
  sourceLanguage: string | null;
  languageConfirmed: false;
} {
  return { sourceLanguage, languageConfirmed: false };
}

/** A fresh API order can be charged only after analysis has priced it. */
export function quotedForCharge<T extends { status: string; totalCents: number | null }>(
  order: T,
): order is T & { totalCents: number } {
  return order.status === "quoted" && order.totalCents != null;
}

/** `use` keeps a quote. `override` clears a language-only hold. Otherwise the order cannot be priced. */
export function partnerQuoteAction(input: QuoteInput): "use" | "override" | "unavailable" {
  if (input.billablePages == null || input.billablePages < 1 || input.totalCents == null) return "unavailable";
  if (input.status === "quoted") return "use";
  if (input.status !== "needs_review") return "unavailable";
  if (!languageOnlyHold(input.reviewReason)) return "unavailable";
  if (input.service === "translation" && !supportedSource(input.sourceLanguage)) return "unavailable";
  return "override";
}

export function toPartnerOrder(input: {
  order: OrderRecord;
  paymentStatus: string | null;
  detail: boolean;
  qa: ReturnType<typeof qaSummary>;
  previewVersion?: number | null;
  now?: number;
}): PartnerOrderBody {
  const progress = publicOrderProgress(asOrderProgress(input.order.progress) ?? UPLOADED_PROGRESS);
  const body: PartnerOrderBody = {
    id: input.order.id,
    status: input.order.status,
    service: input.order.serviceType,
    sourceLanguage: input.order.sourceLanguage,
    targetLanguage: input.order.targetLanguage,
    externalRef: input.order.externalRef,
    billablePages: input.order.billablePages,
    unitPriceCents: input.order.unitPriceCents,
    expeditedUnit: EXPEDITED_UNIT,
    totalCents: input.order.totalCents,
    currency: input.order.currency,
    payment: input.paymentStatus ? { status: input.paymentStatus } : null,
    progress,
    paidAt: input.order.paidAt,
    fulfillment: fulfillmentState(input.order),
    delayed: isPreviewDelayed({
      status: input.order.status,
      previewVersion: input.previewVersion ?? null,
      updatedAt: input.order.updatedAt,
      progress: input.order.progress,
      now: input.now ?? Date.now(),
      reviewReason: input.order.reviewReason,
    }),
  };
  if (!input.detail) return body;
  return { ...body, reviewReason: partnerReviewReason(input.order.reviewReason), qa: input.qa };
}

export async function requireApiKey(request: Request): Promise<ApiKeyRow> {
  const secret = bearerApiKey(request.headers.get("authorization"));
  if (!secret) throw new HttpError("Invalid API key", 401, "invalid_api_key");
  const row = await findActiveApiKey(serviceDb(), hashApiKey(secret));
  if (!row) throw new HttpError("Invalid API key", 401, "invalid_api_key");
  const rate = consumeApiKeyRate(row.id);
  if (!rate.allowed) {
    throw new HttpError("Too many requests", 429, "rate_limited", {
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }
  await touchApiKeyLastUsed(serviceDb(), row.id);
  return row;
}

export function assertLiveOrderAllowed(prefix: ApiKeyPrefix): void {
  if (liveOrderPostBlocked(prefix, process.env.STRIPE_SECRET_KEY)) {
    throw new HttpError("Live mode is disabled", 403, "live_mode_disabled");
  }
}

/** Optional checkout add-ons on `POST /api/v1/orders`. Expedited is not offered. */
export function readPartnerAddonBody(form: FormData, service: PartnerService): Record<string, unknown> | null {
  if (!form.has("addons")) return null;
  try {
    const entries = form.getAll("addons").filter((entry): entry is string => typeof entry === "string");
    let addons: unknown = entries;
    if (entries.length === 1 && entries[0].trim().startsWith("[")) {
      try {
        addons = JSON.parse(entries[0]) as unknown;
      } catch {
        throw new HttpError("Unknown add-on", 400);
      }
    }
    const body: Record<string, unknown> = { addons };
    const rawAddress = form.get("shippingAddress");
    if (typeof rawAddress === "string" && rawAddress.trim()) {
      try {
        body.shippingAddress = JSON.parse(rawAddress) as unknown;
      } catch {
        throw new HttpError("Mail requires a US shipping address", 400);
      }
    }
    selectedAddonIds(addons, { serviceType: service });
    return body;
  } catch (error) {
    rethrowValidation(error);
  }
}

export async function createV1Order(request: Request, key: ApiKeyRow): Promise<CreatedPartnerOrder> {
  assertLiveOrderAllowed(key.prefix);
  const form = await readForm(request);
  const externalRef = parseExternalRef(form.get("external_ref"));
  const db = serviceDb();

  if (externalRef) {
    const existingId = await orderByExternalRef(db, key.userId, externalRef);
    if (existingId) {
      const existing = await ownedOrder(db, key.userId, existingId);
      const finished = await finishPartnerOrder(db, existing, false);
      return { status: 200, ...finished };
    }
  }

  const service = parseService(form.get("service"));
  const addonBody = readPartnerAddonBody(form, service);
  const sourceLanguage = parseLanguage(form.get("source_language"), "source_language", service === "translation");
  if (service === "translation" && !supportedSource(sourceLanguage)) {
    throw new HttpError("source_language is not supported", 400, "validation_error");
  }
  const targetLanguage = parseLanguage(form.get("target_language"), "target_language", false) ?? "en";
  const quoteInput = apiOrderBeforeQuote(sourceLanguage);
  const files = await prepareFiles(form);
  const email = await emailForUser(db, key.userId);
  const customer = await upsertCustomer(db, email);
  const order = await insertOrder(db, {
    tokenHash: hashOrderToken(generateOrderToken()),
    customerId: customer.id,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    gclid: null,
    landingPath: null,
    userId: key.userId,
    serviceType: service,
    externalRef,
    apiKeyId: key.id,
    sourceLanguage: quoteInput.sourceLanguage,
    targetLanguage,
    languageConfirmed: quoteInput.languageConfirmed,
  });

  await insertEvent(db, order.id, "upload_started", { fileCount: files.length, api: true });
  await storeFiles(db, order.id, files);
  await insertEvent(db, order.id, "upload_done", { fileCount: files.length, api: true });
  await insertEvent(db, order.id, "staff_notified", { channel: "event" });
  await analyzeOrder(db, order.id);

  const analyzed = await ownedOrder(db, key.userId, order.id);
  const quoted = await applyPartnerQuote(db, analyzed, service, sourceLanguage);
  let ready = quoted;
  if (addonBody) {
    try {
      const selection = parseCheckoutBody(addonBody, quoted.billablePages, quoted);
      if (quoted.totalCents == null) {
        throw new HttpError("This order cannot be priced", 409, "quote_unavailable");
      }
      await replaceOrderAddons(db, quoted.id, {
        addons: selection.addons,
        shippingAddress: selection.shippingAddress,
        addonCents: selection.addonCents,
        totalCents: quoted.totalCents + selection.addonCents,
      });
      ready = await ownedOrder(db, key.userId, quoted.id);
    } catch (error) {
      rethrowValidation(error);
    }
  }
  const finished = await finishPartnerOrder(db, ready, true);
  return { status: 201, ...finished };
}

export async function partnerOrder(userId: string, orderId: string, detail: boolean): Promise<PartnerOrderBody> {
  const db = serviceDb();
  const order = await ownedOrder(db, userId, orderId);
  const [payment, runs, preview] = await Promise.all([
    latestPayment(db, order.id),
    listQaRuns(db, order.id),
    latestReadyPreview(db, order.id),
  ]);
  return toPartnerOrder({
    order,
    paymentStatus: payment?.status ?? null,
    detail,
    qa: detail ? qaSummary(runs) : null,
    previewVersion: preview?.version ?? null,
  });
}

export async function partnerFiles(userId: string, orderId: string) {
  const db = serviceDb();
  const order = await ownedOrder(db, userId, orderId);
  const documents = await listDocuments(db, order.id);
  let targets: ReturnType<typeof originalTargets> = [];
  try {
    targets = originalTargets(documents, null);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
  }
  const originals = await Promise.all(
    targets.map(async (target) => ({
      documentId: target.documentId,
      filename: target.filename,
      url: await signedObjectUrl(db, target.bucket, target.path, DOWNLOAD_URL_SECONDS, {
        download: target.filename,
      }),
      expiresInSeconds: DOWNLOAD_URL_SECONDS,
    })),
  );

  const payment = await settledPayment(db, order.id);
  const delivery = await getDelivery(db, order.id);
  const gate = downloadGate({
    paymentStatus: payment?.status ?? null,
    deliveryStatus: delivery?.status ?? null,
  });
  if (!gate.ok) {
    return { downloadAvailable: false, originals, translation: null, certification: null };
  }

  const names = documents.map((document) => document.filename);
  const translation = await signedFinal(
    db,
    delivery?.finalPath ?? null,
    orderDownloadFilename("translation", names, order.targetLanguage),
  );
  const certification = await signedFinal(
    db,
    delivery?.certificationPath ?? null,
    orderDownloadFilename("certification", names, order.targetLanguage),
  );
  await insertEvent(db, order.id, "downloaded", { file: "api" });
  return { downloadAvailable: true, originals, translation, certification };
}

function languageOnlyHold(reviewReason: string | null): boolean {
  const reason = reviewReason ?? "";
  if (!reason) return false;
  const blocks = [IMAGE_QUALITY_REASON, "No pages could be read", "could not be read clearly", "different languages"];
  return !blocks.some((part) => reason.includes(part));
}

function supportedSource(value: string | null): value is string {
  return Boolean(value && isSupportedSourceLanguage(value));
}

function qaSummary(runs: QaRunRecord[]) {
  const latest = runs.at(-1);
  if (!latest) return null;
  return {
    status: latest.status,
    score: latest.score,
    checkedAt: latest.createdAt,
    attempts: runs.length,
    issues: latest.issues,
  };
}

async function applyPartnerQuote(
  db: Db,
  order: OrderRecord,
  service: PartnerService,
  sourceLanguage: string | null,
): Promise<OrderRecord> {
  const action = partnerQuoteAction({
    status: order.status,
    billablePages: order.billablePages,
    totalCents: order.totalCents,
    reviewReason: order.reviewReason,
    sourceLanguage,
    service,
  });
  if (action === "unavailable") {
    throw new HttpError("This order cannot be priced", 409, "quote_unavailable");
  }

  const patch: Record<string, unknown> = {};
  if (sourceLanguage && (order.sourceLanguage !== sourceLanguage || !order.languageConfirmed)) {
    patch.source_language = sourceLanguage;
    patch.language_confirmed = true;
  }
  if (action === "override") {
    patch.status = "quoted";
    patch.review_reason = null;
  }
  if (Object.keys(patch).length > 0) await updateOrder(db, order.id, patch);
  const next = await ownedOrder(db, order.userId ?? "", order.id);

  if (action === "override") {
    if (!(await hasEvent(db, order.id, "quote_shown"))) {
      await insertEvent(db, order.id, "quote_shown", {
        billablePages: next.billablePages,
        totalCents: next.totalCents,
        api: true,
      });
    }
    await notifyOrder(db, order.id, "order.quoted");
  }
  return next;
}

async function finishPartnerOrder(
  db: Db,
  order: OrderRecord,
  fresh: boolean,
): Promise<Omit<CreatedPartnerOrder, "status">> {
  const settled = await settledPayment(db, order.id);
  if (settled) {
    return {
      body: await present(db, order, false),
      orderId: order.id,
      startTranslation: order.serviceType === "translation" && order.status === "paid" && !order.finalTranslationPath,
    };
  }

  if (!quotedForCharge(order)) {
    if (!fresh) {
      return { body: await present(db, order, false), orderId: order.id, startTranslation: false };
    }
    throw new HttpError("This order cannot be priced", 409, "quote_unavailable");
  }

  const charged = await chargeOffSession({
    db,
    userId: order.userId ?? "",
    orderId: order.id,
    amountCents: order.totalCents,
    currency: order.currency,
  });
  if (!charged.ok) {
    if (charged.code === "card_declined") await recordFailedPayment(db, order);
    throw chargeError(charged, order);
  }

  await insertPayment(db, {
    orderId: order.id,
    sessionId: `offsession_${charged.paymentIntentId}`,
    paymentIntentId: charged.paymentIntentId,
    amountCents: order.totalCents,
    status: "paid",
    paidAt: new Date().toISOString(),
  });
  await insertEvent(db, order.id, "paid", { api: true });

  if (order.serviceType === "evaluation") {
    await updateOrder(db, order.id, {
      status: "needs_review",
      review_reason: EVALUATION_REVIEW_REASON,
    });
    await notifyLifecycle(db, order.id, "order.paid");
    const { settlePaidOrder } = await import("./paid-release");
    await settlePaidOrder(db, order.id);
    const reviewed = await ownedOrder(db, order.userId ?? "", order.id);
    return { body: await present(db, reviewed, false), orderId: order.id, startTranslation: false };
  }

  if (!order.languageConfirmed || !order.sourceLanguage) {
    throw new HttpError("This order cannot be priced", 409, "quote_unavailable");
  }
  await updateOrder(db, order.id, { status: "paid" });
  await notifyLifecycle(db, order.id, "order.paid");
  await ensurePendingDelivery(db, order.id);
  const { settlePaidOrder } = await import("./paid-release");
  await settlePaidOrder(db, order.id);
  const paid = await ownedOrder(db, order.userId ?? "", order.id);
  return {
    body: await present(db, paid, false),
    orderId: order.id,
    startTranslation: paid.serviceType === "translation" && paid.status === "paid" && !paid.finalTranslationPath,
  };
}

async function present(db: Db, order: OrderRecord, detail: boolean): Promise<PartnerOrderBody> {
  const [payment, runs, preview] = await Promise.all([
    latestPayment(db, order.id),
    detail ? listQaRuns(db, order.id) : Promise.resolve([]),
    latestReadyPreview(db, order.id),
  ]);
  return toPartnerOrder({
    order,
    paymentStatus: payment?.status ?? null,
    detail,
    qa: detail ? qaSummary(runs) : null,
    previewVersion: preview?.version ?? null,
  });
}

async function recordFailedPayment(db: Db, order: OrderRecord): Promise<void> {
  await insertPayment(db, {
    orderId: order.id,
    sessionId: `offsession_${randomUUID()}`,
    amountCents: order.totalCents ?? 0,
    status: "failed",
  });
}

function chargeError(result: Extract<OffSessionCharge, { ok: false }>, order: OrderRecord): HttpError {
  if (result.code === "card_required") {
    return new HttpError("A saved card is required", 402, "card_required", {
      orderId: order.id,
      totalCents: order.totalCents,
      currency: order.currency,
    });
  }
  if (result.code === "card_declined") {
    return new HttpError("The card was declined", 402, "card_declined", { orderId: order.id });
  }
  return new HttpError("Payments not configured", 503, "payments_not_configured");
}

async function ownedOrder(db: Db, userId: string, orderId: string): Promise<OrderRecord> {
  const order = await getOrderById(db, orderId);
  if (!order || order.userId !== userId) throw new HttpError("Order not found", 404, "not_found");
  return order;
}

async function emailForUser(db: Db, userId: string): Promise<string> {
  const { data, error } = await db.auth.admin.getUserById(userId);
  const email = data.user?.email?.trim() ?? "";
  if (error || !email) throw new HttpError("This API key is not tied to an email", 400, "validation_error");
  return email;
}

async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new HttpError("Expected multipart form data", 400, "validation_error");
  }
}

function parseService(value: FormDataEntryValue | null): PartnerService {
  if (value === "translation" || value === "evaluation") return value;
  throw new HttpError("service must be translation or evaluation", 400, "validation_error");
}

function parseLanguage(value: FormDataEntryValue | null, field: string, required: boolean): string | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!text) {
    if (required) throw new HttpError(`${field} is required`, 400, "validation_error");
    return null;
  }
  if (!/^[a-z]{2,8}$/.test(text)) throw new HttpError(`${field} is not supported`, 400, "validation_error");
  return text;
}

function parseExternalRef(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 200) throw new HttpError("external_ref is too long", 400, "validation_error");
  return trimmed;
}

async function prepareFiles(form: FormData): Promise<Array<{ filename: string; mime: string; bytes: Uint8Array }>> {
  const uploads = [...form.getAll("files"), ...form.getAll("file")].filter(
    (entry): entry is File => entry instanceof File,
  );
  try {
    assertUploadBudget(uploads.map((file) => ({ size: file.size })));
  } catch (error) {
    rethrowValidation(error);
  }
  const prepared: Array<{ filename: string; mime: string; bytes: Uint8Array }> = [];
  for (const file of uploads) {
    const mime = resolveUploadMime(file.name, file.type || "");
    if (!mime) throw new HttpError(`Unsupported file type: ${file.name}`, 415, "unsupported_type");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) throw new HttpError("Empty files are not accepted", 400, "validation_error");
    prepared.push({ filename: file.name || "upload", mime, bytes });
  }
  const files = dedupeUploads(prepared);
  try {
    assertUploadBudget(files.map((file) => ({ size: file.bytes.byteLength })));
  } catch (error) {
    rethrowValidation(error);
  }
  return files;
}

function rethrowValidation(error: unknown): never {
  if (error instanceof HttpError) {
    throw new HttpError(error.message, error.status, error.code ?? "validation_error");
  }
  throw error;
}

async function signedFinal(db: Db, path: string | null, filename: string) {
  if (!path) return null;
  return {
    url: await signedObjectUrl(db, FINALS_BUCKET, path, DOWNLOAD_URL_SECONDS, { download: filename }),
    filename,
    expiresInSeconds: DOWNLOAD_URL_SECONDS,
  };
}
