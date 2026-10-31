import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { hashApiKey } from "@/lib/orders/api-key";
import { consumeApiKeyRate } from "@/lib/orders/api-rate-limit";
import { appOrigin } from "@/lib/orders/email";
import { EVALUATION_REVIEW_REASON } from "@/lib/orders/evaluation-price";
import { HttpError } from "@/lib/orders/errors";
import { assertWebhookUrl, generateWebhookSecret, paidWebhookEvent } from "@/lib/orders/outbound-webhook";
import { orderHasEvaluation, priceServices, resolveServices } from "@/lib/orders/service-selection";
import { apiOrderBeforeQuote, partnerFiles } from "@/lib/orders/partner";
import { previewForOwner } from "@/lib/orders/preview-read";
import { requestPreviewChange } from "@/lib/orders/customer";
import { analyzeOrder } from "@/lib/orders/analysis";
import { processOrderInBackground } from "@/lib/orders/pipeline";
import { settlePaidOrder } from "@/lib/orders/paid-release";
import { notifyLifecycle } from "@/lib/orders/webhook-delivery";
import { orderVerification } from "@/lib/orders/verification";
import {
  billingCustomerForUser,
  findActiveApiKey,
  orderByExternalRef,
  touchApiKeyLastUsed,
  upsertWebhookEndpoint,
  type ApiKeyRow,
} from "@/lib/orders/integrations-db";
import {
  ensurePendingDelivery,
  getDelivery,
  getOrderById,
  insertDocument,
  insertEvent,
  insertOrder,
  insertPayment,
  latestPayment,
  latestReadyPreview,
  listDocuments,
  listPages,
  settledPayment,
  updateOrder,
  upsertCustomer,
  withCombinedNumbers,
} from "@/lib/orders/db";
import { MCP_HOLD_REF, isMcpHold } from "@/lib/orders/mcp-hold";
import { ORIGINALS_BUCKET } from "@/lib/orders/constants";
import { uploadObjectPath } from "@/lib/orders/direct-upload";
import { safeFilename } from "@/lib/orders/file-type";
import { serviceDb, uploadObject, type Db } from "@/lib/orders/storage";
import { generateOrderToken, hashOrderToken, isOrderId } from "@/lib/orders/token";
import type { OrderRecord } from "@/lib/orders/types";
import {
  accountBilling,
  billingChargePlan,
  billingRequiredError,
  chargeAccount,
  liveCardCharger,
  liveInvoiceCharger,
  publicCharge,
  type ChargeReceipt,
} from "./billing";
import { getQuote, listServices, quoteInput, quoteServices } from "./catalog";
import { decodeBase64File, downloadPublicFile, fileMime, sha256Hex } from "./files";
import { bearerMcpApiKey } from "./keys";
import { assertMcpOrder, rejectIdentityFields } from "./scope";
import { customerStage, matchesStatusFilter } from "./status";

export type McpContext = { userId: string; keyId: string };

export async function requireMcpKey(request: Request): Promise<ApiKeyRow> {
  const secret = bearerMcpApiKey(request.headers.get("authorization"));
  if (!secret) throw new HttpError("Invalid API key", 401, "invalid_api_key");
  const db = serviceDb();
  const row = await findActiveApiKey(db, hashApiKey(secret));
  if (!row || row.prefix !== "cpk_live_") throw new HttpError("Invalid API key", 401, "invalid_api_key");
  const rate = consumeApiKeyRate(row.id);
  if (!rate.allowed) {
    throw new HttpError("Too many requests", 429, "rate_limited", { retryAfterSeconds: rate.retryAfterSeconds });
  }
  await touchApiKeyLastUsed(db, row.id);
  return row;
}

export async function submitMcpDocument(ctx: McpContext, args: unknown) {
  rejectIdentityFields(args);
  const record = objectArgs(args);
  const filename = typeof record.filename === "string" ? record.filename.trim() : "";
  if (!filename) throw new HttpError("filename is required", 400, "validation_error");
  const content = typeof record.content === "string" ? record.content : "";
  const url = typeof record.url === "string" ? record.url.trim() : "";
  if (Boolean(content) === Boolean(url)) {
    throw new HttpError("Send content or url", 400, "validation_error");
  }
  const downloaded = content ? { bytes: decodeBase64File(content), mime: "" } : await downloadPublicFile(url);
  const mime = fileMime(filename, typeof record.mime === "string" ? record.mime : downloaded.mime);
  const sha256 = sha256Hex(downloaded.bytes);
  const db = serviceDb();
  const holdId = await ensureHold(db, ctx.userId);
  const fileId = randomUUID();
  const path = uploadObjectPath(holdId, fileId, safeFilename(filename));
  await uploadObject(db, ORIGINALS_BUCKET, path, downloaded.bytes, mime);
  const existing = await listDocuments(db, holdId);
  await insertDocument(db, {
    id: fileId,
    orderId: holdId,
    originalPath: path,
    filename: safeFilename(filename),
    mime,
    size: downloaded.bytes.byteLength,
    position: existing.length + 1,
    contentSha256: sha256,
  });
  return { fileId, sha256, filename: safeFilename(filename), size: downloaded.bytes.byteLength };
}

export async function placeMcpOrder(ctx: McpContext, args: unknown) {
  rejectIdentityFields(args);
  const input = quoteInput(args);
  const record = objectArgs(args);
  const externalRef = optionalRef(record.externalRef ?? record.external_ref);
  if (isMcpHold(externalRef)) throw new HttpError("externalRef is not allowed", 400, "validation_error");
  const fileIds = stringList(record.fileIds ?? record.file_ids);
  if (fileIds.length < 1) throw new HttpError("fileIds is required", 400, "validation_error");
  const db = serviceDb();
  const account = accountBilling(await billingCustomerForUser(db, ctx.userId));
  const planKey = process.env.STRIPE_SECRET_KEY ?? null;
  if (externalRef) {
    const existingId = await orderByExternalRef(db, ctx.userId, externalRef);
    if (existingId) return resumeOrder(db, ctx, existingId);
  }
  const priced = priceServices({
    services: quoteServices(input),
    degreeCount: input.degreeCount,
    sourceLanguage: input.sourceLanguage ?? null,
    billablePages: input.pageCount,
  });
  if (!priced || priced.totalCents < 1) throw new HttpError("This order cannot be priced", 409, "quote_unavailable");
  const plan = billingChargePlan({ account, stripeKey: planKey });
  if (plan.action === "refuse") {
    if (plan.code === "billing_required") throw billingRequiredError(appOrigin());
    throw new HttpError(plan.message, 503, plan.code);
  }
  const email = await emailForUser(db, ctx.userId);
  const customer = await upsertCustomer(db, email);
  const quoteLanguage = apiOrderBeforeQuote(input.sourceLanguage ?? null);
  const order = await insertOrder(db, {
    tokenHash: hashOrderToken(generateOrderToken()),
    customerId: customer.id,
    userId: ctx.userId,
    apiKeyId: ctx.keyId,
    externalRef,
    orderType: priced.orderType,
    serviceType: priced.orderType,
    service: priced.service,
    degreeCount: priced.degreeCount,
    includeTranslation: priced.includeTranslation,
    services: priced.services,
    evaluationCents: priced.evaluationCents,
    translationCents: priced.translationCents,
    totalCents: priced.totalCents,
    unitPriceCents: priced.unitPriceCents,
    sourceLanguage: quoteLanguage.sourceLanguage,
    targetLanguage: input.targetLanguage ?? "en",
    languageConfirmed: quoteLanguage.languageConfirmed,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    gclid: null,
    landingPath: "/api/mcp",
  });
  await claimFiles(db, ctx.userId, fileIds, order.id);
  await insertEvent(db, order.id, "upload_done", { fileCount: fileIds.length, mcp: true });
  await analyzeOrder(db, order.id);
  if (input.sourceLanguage) {
    await updateOrder(db, order.id, {
      source_language: input.sourceLanguage,
      target_language: input.targetLanguage ?? "en",
      language_confirmed: true,
    });
  }
  const analyzed = await owned(db, ctx.userId, order.id);
  const amount = analyzed.totalCents && analyzed.totalCents > 0 ? analyzed.totalCents : priced.totalCents;
  const receipt = await chargeAccount({
    db,
    userId: ctx.userId,
    orderId: analyzed.id,
    amountCents: amount,
    currency: analyzed.currency || "usd",
    account,
    stripeKey: planKey,
    card: liveCardCharger(),
    invoice: liveInvoiceCharger(),
  });
  const finished = await finishPaid(db, analyzed, receipt);
  if (finished.startTranslation) after(() => processOrderInBackground(analyzed.id, null));
  return publicCharge(receipt, analyzed.id, finished.status);
}

export async function getMcpOrderStatus(ctx: McpContext, args: unknown) {
  const order = await owned(serviceDb(), ctx.userId, requiredId(args, "orderId"));
  return statusBody(serviceDb(), order);
}

export async function listMcpOrders(ctx: McpContext, args: unknown) {
  rejectIdentityFields(args);
  const record = objectArgs(args ?? {});
  const filter = typeof record.status === "string" && record.status.trim() ? record.status.trim() : null;
  const db = serviceDb();
  const { data, error } = await db
    .from("orders")
    .select(
      "id, status, service_type, include_translation, eta_at, total_cents, currency, created_at, external_ref, billable_pages, user_id",
    )
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as Array<Record<string, unknown>>).filter(
    (row) => row.user_id === ctx.userId && !isMcpHold(typeof row.external_ref === "string" ? row.external_ref : null),
  );
  const orders = [];
  for (const row of rows) {
    const stageInput = {
      id: String(row.id),
      status: String(row.status),
      serviceType: String(row.service_type),
      etaAt: typeof row.eta_at === "string" ? row.eta_at : null,
      includeTranslation: row.include_translation === true,
      totalCents: typeof row.total_cents === "number" ? row.total_cents : null,
      billablePages: typeof row.billable_pages === "number" ? row.billable_pages : null,
    };
    if (!matchesStatusFilter(stageInput, filter)) continue;
    const stage = customerStage(stageInput);
    orders.push({ orderId: stageInput.id, status: stageInput.status, ...stage, amountCents: stageInput.totalCents });
  }
  return { orders };
}

export async function getMcpPreview(ctx: McpContext, args: unknown) {
  const orderId = requiredId(args, "orderId");
  await owned(serviceDb(), ctx.userId, orderId);
  const preview = await previewForOwner(ctx.userId, orderId);
  return {
    orderId,
    url: preview.body.translation.url,
    pageCount: preview.body.translation.pageCount,
    version: preview.body.translation.version,
    reportUrl: preview.body.report?.url ?? null,
    watermarked: true,
  };
}

export async function approveMcpPreview(ctx: McpContext, args: unknown) {
  rejectIdentityFields(args);
  const db = serviceDb();
  const order = await owned(db, ctx.userId, requiredId(args, "orderId"));
  if (order.status !== "preview_ready") {
    throw new HttpError("A preview has to be ready before you can approve it.", 409, "preview_not_ready");
  }
  const preview = await latestReadyPreview(db, order.id);
  if (!preview) throw new HttpError("A preview has to be ready before you can approve it.", 409, "preview_not_ready");
  await insertEvent(db, order.id, "preview_viewed", { accepted: true, mcp: true });
  const stage = customerStage({
    status: order.status,
    serviceType: order.serviceType,
    includeTranslation: order.includeTranslation,
    etaAt: order.etaAt,
  });
  return { accepted: true, orderId: order.id, status: order.status, ...stage };
}

export async function requestMcpChanges(ctx: McpContext, args: unknown) {
  rejectIdentityFields(args);
  const db = serviceDb();
  const order = await owned(db, ctx.userId, requiredId(args, "orderId"));
  const record = objectArgs(args);
  const notes = typeof record.notes === "string" ? record.notes.trim() : "";
  if (!notes) throw new HttpError("notes is required", 400, "validation_error");
  const documents = await listDocuments(db, order.id);
  const documentId = typeof record.documentId === "string" && record.documentId ? record.documentId : documents[0]?.id;
  if (!documentId) throw new HttpError("Unknown document.", 400, "validation_error");
  const pages = withCombinedNumbers(documents, await listPages(db, documents.map((item) => item.id)));
  const requested = typeof record.page === "number" ? record.page : Number(record.page);
  const page = Number.isInteger(requested) && requested >= 1 ? requested : pages.find((item) => item.documentId === documentId)?.number;
  const correction = await requestPreviewChange(db, order, {
    documentId,
    page,
    note: notes,
  });
  return { orderId: order.id, ...correction };
}

export async function downloadMcpCertified(ctx: McpContext, args: unknown) {
  const orderId = requiredId(args, "orderId");
  await owned(serviceDb(), ctx.userId, orderId);
  const files = await partnerFiles(ctx.userId, orderId);
  const file = files.certification ?? files.translation;
  if (!files.downloadAvailable || !file) throw new HttpError("That file is not ready", 404, "not_ready");
  return { orderId, url: file.url, filename: file.filename, expiresInSeconds: file.expiresInSeconds };
}

export async function verifyMcpCertificate(ctx: McpContext, args: unknown) {
  rejectIdentityFields(args);
  const record = objectArgs(args);
  const db = serviceDb();
  const orderId = typeof record.orderId === "string" ? record.orderId.trim() : "";
  const hash = typeof record.documentHash === "string" ? record.documentHash.trim().toLowerCase() : "";
  if (Boolean(orderId) === Boolean(hash)) {
    throw new HttpError("Send orderId or documentHash", 400, "validation_error");
  }
  const id = orderId || (await orderIdForHash(db, ctx.userId, hash));
  if (!id) throw new HttpError("Order not found", 404, "not_found");
  await owned(db, ctx.userId, id);
  return { orderId: id, documents: await orderVerification(db, id) };
}

export async function registerMcpWebhook(ctx: McpContext, args: unknown) {
  rejectIdentityFields(args);
  const url = assertWebhookUrl(objectArgs(args).url);
  const secret = generateWebhookSecret();
  const endpoint = await upsertWebhookEndpoint(serviceDb(), { userId: ctx.userId, url, signingSecret: secret });
  return { url: endpoint.url, secret };
}

export { listServices, getQuote };

async function resumeOrder(db: Db, ctx: McpContext, orderId: string) {
  const order = await owned(db, ctx.userId, orderId);
  const payment = await settledPayment(db, order.id);
  if (payment) {
    const invoice = payment.sessionId.startsWith("invoice:") ? payment.sessionId.split(":")[1] ?? null : null;
    return publicCharge(
      {
        payment: invoice ? "invoice" : "card",
        amountCents: payment.amountCents,
        currency: order.currency,
        receiptId: invoice ? null : payment.paymentIntentId,
        invoiceId: invoice,
        paymentIntentId: payment.paymentIntentId,
      },
      order.id,
      order.status,
    );
  }
  const account = accountBilling(await billingCustomerForUser(db, ctx.userId));
  if (!order.totalCents || order.totalCents < 1) {
    throw new HttpError("This order cannot be priced", 409, "quote_unavailable");
  }
  const receipt = await chargeAccount({
    db,
    userId: ctx.userId,
    orderId: order.id,
    amountCents: order.totalCents,
    currency: order.currency,
    account,
    stripeKey: process.env.STRIPE_SECRET_KEY ?? null,
    card: liveCardCharger(),
    invoice: liveInvoiceCharger(),
  });
  const finished = await finishPaid(db, order, receipt);
  if (finished.startTranslation) after(() => processOrderInBackground(order.id, null));
  return publicCharge(receipt, order.id, finished.status);
}

async function finishPaid(db: Db, order: OrderRecord, receipt: ChargeReceipt) {
  const paidAt = new Date().toISOString();
  await insertPayment(db, {
    orderId: order.id,
    sessionId:
      receipt.payment === "invoice" && receipt.invoiceId
        ? `invoice:${receipt.invoiceId}:${order.id}`
        : `offsession_${receipt.paymentIntentId}`,
    paymentIntentId: receipt.paymentIntentId,
    amountCents: receipt.amountCents,
    status: "paid",
    paidAt,
  });
  await insertEvent(db, order.id, "paid", { mcp: true, payment: receipt.payment });
  const evaluationOnly = orderHasEvaluation(order) && !resolveServices(order).includes("translation");
  if (evaluationOnly) {
    await updateOrder(db, order.id, { status: "needs_review", review_reason: EVALUATION_REVIEW_REASON });
  } else {
    await updateOrder(db, order.id, { status: "paid" });
    await ensurePendingDelivery(db, order.id);
  }
  await notifyLifecycle(db, order.id, paidWebhookEvent(order));
  await settlePaidOrder(db, order.id);
  const fresh = await getOrderById(db, order.id);
  return { status: fresh?.status ?? order.status, startTranslation: !evaluationOnly };
}

async function statusBody(db: Db, order: OrderRecord) {
  const [payment, delivery] = await Promise.all([latestPayment(db, order.id), getDelivery(db, order.id)]);
  const stage = customerStage({
    status: order.status,
    serviceType: order.serviceType,
    paymentStatus: payment?.status ?? null,
    etaAt: order.etaAt,
    includeTranslation: order.includeTranslation,
    downloadAvailable: delivery?.status === "approved" || delivery?.status === "delivered",
    totalCents: order.totalCents,
    billablePages: order.billablePages,
  });
  return { orderId: order.id, status: order.status, ...stage, amountCents: order.totalCents, currency: order.currency };
}

async function owned(db: Db, userId: string, orderId: string): Promise<OrderRecord> {
  if (!isOrderId(orderId)) throw new HttpError("Order not found", 404, "not_found");
  return assertMcpOrder(await getOrderById(db, orderId), userId);
}

async function ensureHold(db: Db, userId: string): Promise<string> {
  const existing = await db
    .from("orders")
    .select("id")
    .eq("user_id", userId)
    .eq("external_ref", MCP_HOLD_REF)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.id) return String(existing.data.id);
  const email = await emailForUser(db, userId);
  const customer = await upsertCustomer(db, email);
  const id = randomUUID();
  try {
    await insertOrder(db, {
      id,
      tokenHash: hashOrderToken(generateOrderToken()),
      customerId: customer.id,
      userId,
      externalRef: MCP_HOLD_REF,
      serviceType: "translation",
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      gclid: null,
      landingPath: null,
    });
    return id;
  } catch (error) {
    const again = await db.from("orders").select("id").eq("user_id", userId).eq("external_ref", MCP_HOLD_REF).maybeSingle();
    if (again.data?.id) return String(again.data.id);
    throw error;
  }
}

async function claimFiles(db: Db, userId: string, fileIds: string[], orderId: string): Promise<void> {
  const hold = await db.from("orders").select("id").eq("user_id", userId).eq("external_ref", MCP_HOLD_REF).maybeSingle();
  if (hold.error) throw new Error(hold.error.message);
  const holdId = hold.data?.id ? String(hold.data.id) : "";
  const listed = await db.from("documents").select("id, order_id").in("id", fileIds);
  if (listed.error) throw new Error(listed.error.message);
  const rows = (listed.data ?? []) as Array<{ id: string; order_id: string }>;
  if (rows.length !== fileIds.length || rows.some((row) => row.order_id !== holdId)) {
    throw new HttpError("File not found", 404, "not_found");
  }
  for (let index = 0; index < fileIds.length; index += 1) {
    const fileId = fileIds[index];
    const updated = await db
      .from("documents")
      .update({ order_id: orderId, position: index + 1 })
      .eq("id", fileId)
      .eq("order_id", holdId);
    if (updated.error) throw new Error(updated.error.message);
  }
}

async function orderIdForHash(db: Db, userId: string, hash: string): Promise<string | null> {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new HttpError("documentHash must be a sha256 hex digest", 400, "validation_error");
  const listed = await db.from("documents").select("order_id").eq("content_sha256", hash);
  if (listed.error) throw new Error(listed.error.message);
  for (const row of (listed.data ?? []) as Array<{ order_id?: string }>) {
    if (!row.order_id) continue;
    const order = await getOrderById(db, row.order_id);
    if (order?.userId === userId && !isMcpHold(order.externalRef)) return order.id;
  }
  return null;
}

async function emailForUser(db: Db, userId: string): Promise<string> {
  const { data, error } = await db.auth.admin.getUserById(userId);
  const email = data.user?.email?.trim() ?? "";
  if (error || !email) throw new HttpError("This API key is not tied to an email", 400, "validation_error");
  return email;
}

function objectArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError("Expected a JSON object", 400, "validation_error");
  }
  return value as Record<string, unknown>;
}

function requiredId(args: unknown, field: string): string {
  rejectIdentityFields(args);
  const value = objectArgs(args)[field];
  if (typeof value !== "string" || !value.trim()) throw new HttpError(`${field} is required`, 400, "validation_error");
  return value.trim();
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function optionalRef(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new HttpError("externalRef is too long", 400, "validation_error");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 200) throw new HttpError("externalRef is too long", 400, "validation_error");
  return trimmed;
}
