import { parseStoredPageOrder, compareCombinedPages } from "./page-order";
import type { Db } from "./storage";

export type { Db };
import { eventData } from "./events";
import { HttpError } from "./errors";
import type {
  ConfirmationRecord,
  CorrectionRecord,
  DeliveryRecord,
  DeliveryStatus,
  DocumentRecord,
  OrderEventType,
  OrderNoteRecord,
  OrderRecord,
  OrderStatus,
  PageRecord,
  PaymentRecord,
  PaymentStatus,
  PreviewRecord,
  TranslationRecord,
} from "./types";
import { type QaIssue, type QaRunRecord, type QaStatus } from "./qa";

type Row = Record<string, unknown>;

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function mapOrder(row: Row): OrderRecord {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    userId: str(row.user_id),
    status: String(row.status) as OrderStatus,
    sourceLanguage: str(row.source_language),
    targetLanguage: str(row.target_language) ?? "en",
    languageConfirmed: Boolean(row.language_confirmed),
    billablePages: num(row.billable_pages),
    unitPriceCents: num(row.unit_price_cents) ?? 995,
    totalCents: num(row.total_cents),
    currency: str(row.currency) ?? "usd",
    etaAt: str(row.eta_at),
    reviewReason: str(row.review_reason),
    combinedOriginalPath: str(row.combined_original_path),
    finalTranslationPath: str(row.final_translation_path),
    certificationPath: str(row.certification_path),
    pageOrderBasis: row.page_order_basis === "logical" || row.page_order_basis === "upload" ? row.page_order_basis : null,
    pageOrder: parseStoredPageOrder(row.page_order),
    createdAt: str(row.created_at) ?? new Date().toISOString(),
  };
}

function mapDocument(row: Row): DocumentRecord {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    originalPath: String(row.original_path),
    filename: String(row.filename),
    mime: str(row.mime),
    size: num(row.size),
    pageCount: num(row.page_count),
    status: String(row.status),
    detectedLanguage: str(row.detected_language),
    confidence: num(row.confidence),
    position: num(row.position) ?? 0,
    appliedPosition: num(row.applied_position),
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function mapPage(row: Row): PageRecord {
  return {
    id: String(row.id),
    documentId: String(row.document_id),
    pageNumber: num(row.page_number) ?? 1,
    wordCount: num(row.word_count),
    billableUnits: num(row.billable_units),
    billingBasis: row.billing_basis === "cjk" ? "cjk" : row.billing_basis === "words" ? "words" : null,
    ocrText: str(row.ocr_text),
    needsReview: Boolean(row.needs_review),
    widthPt: num(row.width_pt),
    heightPt: num(row.height_pt),
    uploadPage: num(row.upload_page),
    logicalPage: num(row.logical_page),
    orderHint: str(row.order_hint),
    qualityScore: num(row.quality_score),
    qualityFlags: stringList(row.quality_flags),
    qualityMessage: str(row.quality_message),
  };
}

function mapConfirmation(row: Row): ConfirmationRecord {
  return {
    id: String(row.id),
    documentId: str(row.document_id) ?? "",
    fieldKey: String(row.field_key),
    originalValue: str(row.original_value),
    confirmedValue: str(row.confirmed_value),
  };
}

function mapCorrection(row: Row): CorrectionRecord {
  return {
    id: String(row.id),
    documentId: str(row.document_id),
    pageNumber: num(row.page_number),
    passage: str(row.passage),
    note: str(row.note),
    status: String(row.status),
    resolvedPreviewVersion: num(row.resolved_preview_version),
    createdAt: str(row.created_at) ?? new Date().toISOString(),
  };
}

function mapPreview(row: Row): PreviewRecord {
  return {
    id: String(row.id),
    version: num(row.version) ?? 1,
    previewPath: String(row.preview_path),
    status: String(row.status),
  };
}

function mapPayment(row: Row): PaymentRecord {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    sessionId: String(row.stripe_checkout_session_id),
    paymentIntentId: str(row.stripe_payment_intent_id),
    amountCents: num(row.amount_cents) ?? 0,
    status: String(row.status) as PaymentStatus,
    paidAt: str(row.paid_at),
    createdAt: str(row.created_at) ?? "",
  };
}

function mapDelivery(row: Row): DeliveryRecord {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    status: String(row.status) as DeliveryStatus,
    finalPath: str(row.final_path),
    certificationPath: str(row.certification_path),
    approvedBy: str(row.approved_by),
    approvedAt: str(row.approved_at),
    deliveredAt: str(row.delivered_at),
  };
}

export async function upsertCustomer(db: Db, email: string): Promise<{ id: string }> {
  const existing = await db.from("customers").select("id").eq("email", email).maybeSingle();
  fail(existing.error);
  if (existing.data?.id) return { id: String(existing.data.id) };

  const inserted = await db.from("customers").insert({ email }).select("id").single();
  if (inserted.error?.code === "23505") {
    const again = await db.from("customers").select("id").eq("email", email).single();
    fail(again.error);
    if (!again.data?.id) throw new Error("Customer was not created");
    return { id: String(again.data.id) };
  }
  fail(inserted.error);
  if (!inserted.data?.id) throw new Error("Customer was not created");
  return { id: String(inserted.data.id) };
}

export async function customerEmail(db: Db, customerId: string): Promise<string | null> {
  const { data, error } = await db.from("customers").select("email").eq("id", customerId).maybeSingle();
  fail(error);
  return data?.email ? String(data.email) : null;
}

export async function insertOrder(
  db: Db,
  input: {
    tokenHash: string;
    customerId: string;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    gclid: string | null;
    landingPath: string | null;
  },
): Promise<OrderRecord> {
  const { data, error } = await db
    .from("orders")
    .insert({
      public_token_hash: input.tokenHash,
      customer_id: input.customerId,
      service_type: "translation",
      status: "draft",
      utm_source: input.utmSource,
      utm_medium: input.utmMedium,
      utm_campaign: input.utmCampaign,
      gclid: input.gclid,
      landing_path: input.landingPath,
    })
    .select("*")
    .single();
  fail(error);
  return mapOrder(data as Row);
}

export async function getOrderById(db: Db, orderId: string): Promise<OrderRecord | null> {
  const { data, error } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  fail(error);
  return data ? mapOrder(data as Row) : null;
}

export async function getOrderByHash(db: Db, tokenHash: string): Promise<OrderRecord | null> {
  const { data, error } = await db
    .from("orders")
    .select("*")
    .eq("public_token_hash", tokenHash)
    .maybeSingle();
  fail(error);
  return data ? mapOrder(data as Row) : null;
}

export async function requireOrderByHash(db: Db, tokenHash: string): Promise<OrderRecord> {
  const order = await getOrderByHash(db, tokenHash);
  if (!order) throw new HttpError("Order not found", 404);
  return order;
}

export async function updateOrder(
  db: Db,
  orderId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from("orders").update(patch).eq("id", orderId);
  fail(error);
}

export async function insertDocument(
  db: Db,
  input: {
    id: string;
    orderId: string;
    originalPath: string;
    filename: string;
    mime: string;
    size: number;
    position: number;
  },
): Promise<void> {
  const { error } = await db.from("documents").insert({
    id: input.id,
    order_id: input.orderId,
    original_path: input.originalPath,
    filename: input.filename,
    mime: input.mime,
    size: input.size,
    position: input.position,
    status: "uploaded",
  });
  fail(error);
}

export async function listDocuments(db: Db, orderId: string): Promise<DocumentRecord[]> {
  const { data, error } = await db.from("documents").select("*").eq("order_id", orderId);
  fail(error);
  return ((data ?? []) as Row[])
    .map(mapDocument)
    .sort((a, b) => a.position - b.position || a.filename.localeCompare(b.filename));
}

export async function claimDocuments(db: Db, orderId: string): Promise<DocumentRecord[]> {
  const { data, error } = await db
    .from("documents")
    .update({ status: "processing" })
    .eq("order_id", orderId)
    .in("status", ["uploaded", "failed", "processing"])
    .select("*");
  fail(error);
  return ((data ?? []) as Row[])
    .map(mapDocument)
    .sort((a, b) => a.position - b.position || a.filename.localeCompare(b.filename));
}

export async function markDocuments(
  db: Db,
  orderId: string,
  status: "ready" | "failed" | "uploaded",
): Promise<void> {
  const { error } = await db.from("documents").update({ status }).eq("order_id", orderId);
  fail(error);
}

export async function updateDocument(
  db: Db,
  documentId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from("documents").update(patch).eq("id", documentId);
  fail(error);
}

export async function replacePages(
  db: Db,
  documentId: string,
  pages: Array<{
    pageNumber: number;
    wordCount: number;
    billableUnits: number;
    billingBasis: "words" | "cjk";
    ocrText: string;
    needsReview: boolean;
    widthPt: number;
    heightPt: number;
    uploadPage: number;
    logicalPage: number | null;
    orderHint: string | null;
    qualityScore: number | null;
    qualityFlags: string[];
    qualityMessage: string | null;
  }>,
): Promise<void> {
  const deleted = await db.from("document_pages").delete().eq("document_id", documentId);
  fail(deleted.error);
  if (pages.length === 0) return;
  const { error } = await db.from("document_pages").insert(
    pages.map((page) => ({
      document_id: documentId,
      page_number: page.pageNumber,
      word_count: page.wordCount,
      billable_units: page.billableUnits,
      billing_basis: page.billingBasis,
      ocr_text: page.ocrText,
      needs_review: page.needsReview,
      width_pt: page.widthPt,
      height_pt: page.heightPt,
      upload_page: page.uploadPage,
      logical_page: page.logicalPage,
      order_hint: page.orderHint,
      quality_score: page.qualityScore,
      quality_flags: page.qualityFlags,
      quality_message: page.qualityMessage,
    })),
  );
  fail(error);
}

export async function listPages(db: Db, documentIds: string[]): Promise<PageRecord[]> {
  if (documentIds.length === 0) return [];
  const { data, error } = await db.from("document_pages").select("*").in("document_id", documentIds);
  fail(error);
  return ((data ?? []) as Row[]).map(mapPage);
}

export function withCombinedNumbers(documents: DocumentRecord[], pages: PageRecord[]) {
  const sorted = [...pages].sort((a, b) => compareCombinedPages(documents, a, b));
  return sorted.map((page, index) => ({ ...page, number: index + 1 }));
}

export async function listConfirmations(db: Db, orderId: string): Promise<ConfirmationRecord[]> {
  const { data, error } = await db.from("confirmations").select("*").eq("order_id", orderId);
  fail(error);
  return ((data ?? []) as Row[]).map(mapConfirmation);
}

export async function replaceExtractedConfirmations(
  db: Db,
  orderId: string,
  fields: Array<{ documentId: string; fieldKey: string; originalValue: string | null }>,
): Promise<void> {
  const deleted = await db
    .from("confirmations")
    .delete()
    .eq("order_id", orderId)
    .is("confirmed_value", null);
  fail(deleted.error);
  if (fields.length === 0) return;
  const { error } = await db.from("confirmations").insert(
    fields.map((field) => ({
      order_id: orderId,
      document_id: field.documentId,
      field_key: field.fieldKey,
      original_value: field.originalValue,
    })),
  );
  fail(error);
}

export async function confirmFields(
  db: Db,
  orderId: string,
  fields: Array<{ documentId: string; fieldKey: string; confirmedValue: string }>,
): Promise<void> {
  const existing = await listConfirmations(db, orderId);
  const byKey = new Map(existing.map((field) => [`${field.documentId}:${field.fieldKey}`, field]));
  for (const field of fields) {
    const current = byKey.get(`${field.documentId}:${field.fieldKey}`);
    if (current) {
      const { error } = await db
        .from("confirmations")
        .update({ confirmed_value: field.confirmedValue })
        .eq("id", current.id);
      fail(error);
    } else {
      const { error } = await db.from("confirmations").insert({
        order_id: orderId,
        document_id: field.documentId,
        field_key: field.fieldKey,
        confirmed_value: field.confirmedValue,
      });
      fail(error);
    }
  }
}

export async function listCorrections(db: Db, orderId: string): Promise<CorrectionRecord[]> {
  const { data, error } = await db
    .from("corrections")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  fail(error);
  return ((data ?? []) as Row[]).map(mapCorrection);
}

export async function insertCorrection(
  db: Db,
  input: {
    orderId: string;
    documentId: string;
    pageNumber: number;
    passage: string | null;
    note: string | null;
  },
): Promise<CorrectionRecord> {
  const { data, error } = await db
    .from("corrections")
    .insert({
      order_id: input.orderId,
      document_id: input.documentId,
      page_number: input.pageNumber,
      passage: input.passage,
      note: input.note,
      status: "open",
    })
    .select("*")
    .single();
  fail(error);
  return mapCorrection(data as Row);
}

export async function resolveCorrections(
  db: Db,
  ids: string[],
  previewVersion: number,
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await db
    .from("corrections")
    .update({ status: "resolved", resolved_preview_version: previewVersion })
    .in("id", ids);
  fail(error);
}

export async function dismissCorrections(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await db
    .from("corrections")
    .update({ status: "dismissed", resolved_preview_version: null })
    .in("id", ids)
    .eq("status", "open");
  fail(error);
}

export async function latestReadyPreview(db: Db, orderId: string): Promise<PreviewRecord | null> {
  const { data, error } = await db
    .from("previews")
    .select("*")
    .eq("order_id", orderId)
    .eq("status", "ready")
    .order("version", { ascending: false })
    .limit(1);
  fail(error);
  const row = (data ?? [])[0] as Row | undefined;
  return row ? mapPreview(row) : null;
}

export async function nextPreviewVersion(db: Db, orderId: string): Promise<number> {
  const { data, error } = await db
    .from("previews")
    .select("version")
    .eq("order_id", orderId)
    .order("version", { ascending: false })
    .limit(1);
  fail(error);
  const row = (data ?? [])[0] as Row | undefined;
  return (num(row?.version) ?? 0) + 1;
}

export async function insertPreview(
  db: Db,
  input: { orderId: string; version: number; previewPath: string },
): Promise<"inserted" | "exists"> {
  const { error } = await db.from("previews").insert({
    order_id: input.orderId,
    version: input.version,
    preview_path: input.previewPath,
    status: "pending",
  });
  if (error?.code === "23505") return "exists";
  fail(error);
  return "inserted";
}

export async function markPreview(
  db: Db,
  orderId: string,
  version: number,
  status: "ready" | "failed",
): Promise<void> {
  const { error } = await db
    .from("previews")
    .update({ status, generated_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .eq("version", version);
  fail(error);
}

export async function nextTranslationVersion(db: Db, documentIds: string[]): Promise<number> {
  if (documentIds.length === 0) return 1;
  const { data, error } = await db
    .from("translations")
    .select("version")
    .in("document_id", documentIds)
    .order("version", { ascending: false })
    .limit(1);
  fail(error);
  const row = (data ?? [])[0] as Row | undefined;
  return (num(row?.version) ?? 0) + 1;
}

export async function insertTranslation(
  db: Db,
  input: {
    documentId: string;
    version: number;
    model: string;
    output: unknown;
    status: "ready" | "failed" | "pending";
  },
): Promise<void> {
  const { error } = await db.from("translations").insert({
    document_id: input.documentId,
    version: input.version,
    model: input.model,
    output: input.output,
    status: input.status,
  });
  if (error?.code === "23505") return;
  fail(error);
}

export async function latestPayment(db: Db, orderId: string): Promise<PaymentRecord | null> {
  const { data, error } = await db
    .from("payments")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1);
  fail(error);
  const row = (data ?? [])[0] as Row | undefined;
  return row ? mapPayment(row) : null;
}

export async function settledPayment(db: Db, orderId: string): Promise<PaymentRecord | null> {
  const { data, error } = await db
    .from("payments")
    .select("*")
    .eq("order_id", orderId)
    .in("status", ["paid", "paid_test"])
    .limit(1);
  fail(error);
  const row = (data ?? [])[0] as Row | undefined;
  return row ? mapPayment(row) : null;
}

export async function paymentByIntent(db: Db, paymentIntentId: string): Promise<PaymentRecord | null> {
  const { data, error } = await db
    .from("payments")
    .select("*")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .order("created_at", { ascending: false })
    .limit(5);
  fail(error);
  const rows = ((data ?? []) as Row[]).map(mapPayment);
  return rows.find((row) => row.status === "paid" || row.status === "paid_test") ?? rows[0] ?? null;
}

export async function paymentBySession(db: Db, sessionId: string): Promise<PaymentRecord | null> {
  const { data, error } = await db
    .from("payments")
    .select("*")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  fail(error);
  return data ? mapPayment(data as Row) : null;
}

export async function insertPayment(
  db: Db,
  input: {
    orderId: string;
    sessionId: string;
    paymentIntentId?: string | null;
    amountCents: number;
    status: PaymentStatus;
    paidAt?: string | null;
  },
): Promise<PaymentRecord> {
  const { data, error } = await db
    .from("payments")
    .insert({
      order_id: input.orderId,
      stripe_checkout_session_id: input.sessionId,
      stripe_payment_intent_id: input.paymentIntentId ?? null,
      amount_cents: input.amountCents,
      status: input.status,
      paid_at: input.paidAt ?? null,
    })
    .select("*")
    .single();
  fail(error);
  return mapPayment(data as Row);
}

export async function markPaymentPaid(
  db: Db,
  paymentId: string,
  paymentIntentId: string | null,
): Promise<void> {
  const { error } = await db
    .from("payments")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      stripe_payment_intent_id: paymentIntentId,
    })
    .eq("id", paymentId)
    .eq("status", "pending");
  fail(error);
}

export async function markPaymentRefunded(db: Db, paymentId: string): Promise<void> {
  const { error } = await db
    .from("payments")
    .update({ status: "refunded" })
    .eq("id", paymentId)
    .in("status", ["paid", "paid_test"]);
  fail(error);
}

export async function markPaymentFailed(db: Db, paymentId: string): Promise<void> {
  const { error } = await db.from("payments").update({ status: "failed" }).eq("id", paymentId);
  fail(error);
}

export async function markPaymentExpired(db: Db, paymentId: string): Promise<void> {
  const { error } = await db
    .from("payments")
    .update({ status: "expired" })
    .eq("id", paymentId)
    .eq("status", "pending");
  fail(error);
}

/** Sets an order that is still on the preview step back to preview_ready. A later status is left alone. */
export async function restorePreviewReadyOrder(db: Db, orderId: string): Promise<void> {
  const { error } = await db
    .from("orders")
    .update({ status: "preview_ready" })
    .eq("id", orderId)
    .eq("status", "preview_ready");
  fail(error);
}

export async function getDelivery(db: Db, orderId: string): Promise<DeliveryRecord | null> {
  const { data, error } = await db.from("deliveries").select("*").eq("order_id", orderId).maybeSingle();
  fail(error);
  return data ? mapDelivery(data as Row) : null;
}

export async function ensurePendingDelivery(db: Db, orderId: string): Promise<void> {
  const existing = await getDelivery(db, orderId);
  if (existing) return;
  const { error } = await db.from("deliveries").insert({ order_id: orderId, status: "pending" });
  if (error?.code === "23505") return;
  fail(error);
}

export async function updateDelivery(
  db: Db,
  orderId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from("deliveries").update(patch).eq("order_id", orderId);
  fail(error);
}

export type { QaIssue, QaRunRecord, QaStatus } from "./qa";

function mapQaRun(row: Row): QaRunRecord {
  const issues = Array.isArray(row.issues) ? (row.issues as QaIssue[]) : [];
  const status = row.status === "pass" || row.status === "fail" || row.status === "retranslated" ? row.status : "fail";
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    attempt: num(row.attempt) ?? 1,
    status,
    score: num(row.score) ?? 0,
    issues,
    createdAt: str(row.created_at) ?? new Date().toISOString(),
  };
}

export async function listQaRuns(db: Db, orderId: string): Promise<QaRunRecord[]> {
  const { data, error } = await db
    .from("order_qa_runs")
    .select("*")
    .eq("order_id", orderId)
    .order("attempt", { ascending: true });
  fail(error);
  return ((data ?? []) as Row[]).map(mapQaRun);
}

export async function insertQaRun(
  db: Db,
  input: { orderId: string; attempt: number; status: QaStatus; score: number; issues: QaIssue[] },
): Promise<void> {
  const { error } = await db.from("order_qa_runs").insert({
    order_id: input.orderId,
    attempt: input.attempt,
    status: input.status,
    score: input.score,
    issues: input.issues,
  });
  fail(error);
}

export async function insertEvent(
  db: Db,
  orderId: string | null,
  type: OrderEventType,
  data: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db.from("order_events").insert({
    order_id: orderId,
    type,
    data: eventData(data),
  });
  fail(error);
}

export async function hasEvent(db: Db, orderId: string, type: OrderEventType): Promise<boolean> {
  const { data, error } = await db
    .from("order_events")
    .select("id")
    .eq("order_id", orderId)
    .eq("type", type)
    .limit(1);
  fail(error);
  return (data ?? []).length > 0;
}

function mapTranslation(row: Row): TranslationRecord {
  return {
    id: String(row.id),
    documentId: String(row.document_id),
    version: num(row.version) ?? 1,
    model: str(row.model),
    status: String(row.status),
    output: row.output ?? null,
  };
}

function mapNote(row: Row): OrderNoteRecord {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    authorId: String(row.author_id),
    body: String(row.body),
    createdAt: str(row.created_at) ?? new Date().toISOString(),
  };
}

export async function listOrders(
  db: Db,
  status: OrderStatus | null,
  page: { limit: number; offset: number },
) {
  let query = db
    .from("orders")
    .select(
      "id, status, service_type, source_language, billable_pages, total_cents, currency, created_at, review_reason, customer_id, customers(email)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (status) query = query.eq("status", status);
  const { data, error, count } = await query;
  fail(error);
  const orders = ((data ?? []) as Row[]).map((row) => {
    const customer = row.customers as { email?: string } | { email?: string }[] | null;
    const email = Array.isArray(customer) ? customer[0]?.email : customer?.email;
    return {
      id: String(row.id),
      status: String(row.status),
      serviceType: String(row.service_type),
      sourceLanguage: str(row.source_language),
      billablePages: num(row.billable_pages),
      totalCents: num(row.total_cents),
      currency: str(row.currency),
      createdAt: str(row.created_at),
      reviewReason: str(row.review_reason),
      email: email ?? null,
    };
  });
  return { orders, total: count ?? orders.length };
}

export async function listTranslations(db: Db, documentIds: string[]): Promise<TranslationRecord[]> {
  if (documentIds.length === 0) return [];
  const { data, error } = await db
    .from("translations")
    .select("*")
    .in("document_id", documentIds)
    .order("version", { ascending: false });
  fail(error);
  return ((data ?? []) as Row[]).map(mapTranslation);
}

export async function paymentForRefund(db: Db, orderId: string): Promise<PaymentRecord | null> {
  const { data, error } = await db
    .from("payments")
    .select("*")
    .eq("order_id", orderId)
    .in("status", ["paid", "paid_test", "refunded"])
    .order("created_at", { ascending: false })
    .limit(5);
  fail(error);
  const rows = ((data ?? []) as Row[]).map(mapPayment);
  return (
    rows.find((row) => row.status === "paid" || row.status === "paid_test") ??
    rows.find((row) => row.status === "refunded") ??
    null
  );
}

export async function listOrderNotes(db: Db, orderId: string): Promise<OrderNoteRecord[]> {
  const { data, error } = await db
    .from("order_notes")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  fail(error);
  return ((data ?? []) as Row[]).map(mapNote);
}

export async function insertOrderNote(
  db: Db,
  input: { orderId: string; authorId: string; body: string },
): Promise<OrderNoteRecord> {
  const { data, error } = await db
    .from("order_notes")
    .insert({
      order_id: input.orderId,
      author_id: input.authorId,
      body: input.body,
    })
    .select("*")
    .single();
  fail(error);
  return mapNote(data as Row);
}

export type OwnedOrderRow = {
  id: string;
  status: string;
  serviceType: string;
  billablePages: number | null;
  unitPriceCents: number;
  totalCents: number | null;
  currency: string;
  createdAt: string;
};

export async function listOwnedOrderRows(db: Db, userId: string): Promise<OwnedOrderRow[]> {
  const { data, error } = await db
    .from("orders")
    .select(
      "id, status, service_type, billable_pages, unit_price_cents, total_cents, currency, created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  fail(error);
  return ((data ?? []) as Row[]).map((row) => ({
    id: String(row.id),
    status: String(row.status),
    serviceType: String(row.service_type),
    billablePages: num(row.billable_pages),
    unitPriceCents: num(row.unit_price_cents) ?? 995,
    totalCents: num(row.total_cents),
    currency: str(row.currency) ?? "usd",
    createdAt: str(row.created_at) ?? new Date().toISOString(),
  }));
}

export async function listReadyPreviewOrderIds(db: Db, orderIds: string[]): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const { data, error } = await db
    .from("previews")
    .select("order_id")
    .in("order_id", orderIds)
    .eq("status", "ready");
  fail(error);
  return new Set(((data ?? []) as Row[]).map((row) => String(row.order_id)));
}

export async function listPaymentsForOrders(db: Db, orderIds: string[]): Promise<PaymentRecord[]> {
  if (orderIds.length === 0) return [];
  const { data, error } = await db.from("payments").select("*").in("order_id", orderIds);
  fail(error);
  return ((data ?? []) as Row[]).map(mapPayment);
}

export async function listDeliveriesForOrders(db: Db, orderIds: string[]): Promise<DeliveryRecord[]> {
  if (orderIds.length === 0) return [];
  const { data, error } = await db.from("deliveries").select("*").in("order_id", orderIds);
  fail(error);
  return ((data ?? []) as Row[]).map(mapDelivery);
}

export async function claimOrdersByCustomerEmail(
  db: Db,
  userId: string,
  email: string,
): Promise<string[]> {
  const customers = await db.from("customers").select("id").eq("email", email);
  fail(customers.error);
  const customerIds = ((customers.data ?? []) as Row[]).map((row) => String(row.id));
  if (customerIds.length === 0) return [];

  const updated = await db
    .from("orders")
    .update({ user_id: userId })
    .in("customer_id", customerIds)
    .is("user_id", null)
    .select("id");
  fail(updated.error);
  return ((updated.data ?? []) as Row[]).map((row) => String(row.id));
}
