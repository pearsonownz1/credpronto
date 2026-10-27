import { ADDON_CATALOG, expeditedFlagForAddons, type PricedAddon } from "./addons";
import { fulfillmentState, WAITING_FOR_STAFF_STATUSES } from "./release-decision";
import {
  countrySlugFallbackFilter,
  mapEdgeCredentialRow,
  mapEdgeEquivalencyRow,
  mapEdgeGradingScaleRow,
  resolveStoredCountrySlug,
  type EdgeCredentialRecord,
  type EdgeEquivalencyRecord,
  type EdgeGradingScaleRecord,
} from "./edge";
import { evaluationPrice, parseEvaluationResult } from "./evaluation-price";
import { normalizeCatalogServices } from "./service-selection";
import { readStoredEvalStatus } from "../evalStatus";
import { parseStoredPageOrder, compareCombinedPages } from "./page-order";
import { asOrderProgress, type OrderProgress } from "./reading-progress";
import type { Db } from "./storage";

export type { Db };
import { eventData } from "./events";
import { HttpError } from "./errors";
import { assertEmail } from "./files";
import type {
  ConfirmationRecord,
  CorrectionRecord,
  FinalCorrectionRecord,
  FinalCorrectionStatus,
  DeliveryRecord,
  DeliveryStatus,
  DocumentRecord,
  AddonId,
  OrderEventType,
  OrderNoteRecord,
  OrderRecord,
  OrderStatus,
  ShippingAddress,
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
    brand: row.brand === "gcs" ? "gcs" : "credpronto",
    serviceType: str(row.service_type) ?? "translation",
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
    externalRef: str(row.external_ref),
    orderType:
      row.order_type === "evaluation" || row.order_type === "expert_letter" ? row.order_type : "translation",
    service: row.service === "diploma" || row.service === "course_by_course" ? row.service : null,
    services: storedServices(row.services),
    serviceFiles: storedServiceFiles(row.service_files),
    evaluationResults: storedEvaluationResults(row.evaluation_results),
    degreeCount: num(row.degree_count),
    evaluationCents: num(row.evaluation_cents),
    translationCents: num(row.translation_cents),
    includeTranslation: row.include_translation === true,
    evaluationResult: parseEvaluationResult(row.evaluation_result),
    addonCents: num(row.addon_cents) ?? 0,
    expedited: row.expedited === true,
    shippingAddress: mapShipping(row),
    mailStatus: row.mail_status === "pending" || row.mail_status === "shipped" ? row.mail_status : null,
    mailTracking: str(row.mail_tracking),
    mailCarrier: str(row.mail_carrier),
    mailShippedAt: str(row.mail_shipped_at),
    notarizationStatus:
      row.notarization_status === "pending" ||
      row.notarization_status === "notarized" ||
      row.notarization_status === "done"
        ? row.notarization_status
        : null,
    edgeCredentialId: str(row.edge_credential_id),
    edgeGradingScaleId: str(row.edge_grading_scale_id),
    edgeMatchMethod:
      row.edge_match_method === "base" || row.edge_match_method === "fuzzy" ? row.edge_match_method : null,
    createdAt: str(row.created_at) ?? new Date().toISOString(),
    updatedAt: str(row.updated_at) ?? str(row.created_at) ?? new Date().toISOString(),
    paidAt: str(row.paid_at),
    underReviewAt: str(row.under_review_at),
    performingEvaluationAt: str(row.performing_evaluation_at),
    performingLayoutAt: str(row.performing_layout_at),
    evaluationCompleteAt: str(row.evaluation_complete_at),
    staffAlertSentAt: str(row.staff_alert_sent_at),
    staffUrgentAlertSentAt: str(row.staff_urgent_alert_sent_at),
    progress: asOrderProgress(row.progress) ?? { step: "uploaded", pagesRead: 0, pagesTotal: 0 },
    ...readStoredEvalStatus(row),
  };
}

function storedServices(value: unknown): Array<"translation" | "diploma" | "course_by_course"> | null {
  if (!Array.isArray(value)) return null;
  return normalizeCatalogServices(value.filter((item): item is string => typeof item === "string"));
}

function storedServiceFiles(value: unknown): Partial<Record<"diploma" | "course_by_course", string>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const files: Partial<Record<"diploma" | "course_by_course", string>> = {};
  if (typeof record.diploma === "string" && record.diploma.trim()) files.diploma = record.diploma;
  if (typeof record.course_by_course === "string" && record.course_by_course.trim()) {
    files.course_by_course = record.course_by_course;
  }
  return files.diploma || files.course_by_course ? files : null;
}

function storedEvaluationResults(value: unknown) {
  if (!Array.isArray(value)) return null;
  const results = [];
  for (const item of value) {
    const parsed = parseEvaluationResult(item);
    if (!parsed) return null;
    results.push(parsed);
  }
  return results.length > 0 ? results : null;
}

function mapShipping(row: Row): ShippingAddress | null {
  const name = str(row.shipping_name);
  const line1 = str(row.shipping_line1);
  const city = str(row.shipping_city);
  const state = str(row.shipping_state);
  const postalCode = str(row.shipping_postal_code);
  if (!name || !line1 || !city || !state || !postalCode || row.shipping_country !== "US") return null;
  return {
    name,
    line1,
    line2: str(row.shipping_line2),
    city,
    state,
    postalCode,
    country: "US",
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
    createdAt: str(row.created_at),
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
    ...(typeof row.skipped === "boolean" ? { skip: row.skipped } : {}),
    ...(str(row.skip_reason) ? { skipReason: str(row.skip_reason) } : {}),
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

/** Address on the order's customer now. Signup may have moved `customer_id` since the row was loaded. */
export async function orderCustomerEmail(db: Db, orderId: string): Promise<string | null> {
  const order = await getOrderById(db, orderId);
  if (!order) return null;
  return customerEmail(db, order.customerId);
}

/** One customer row per guest quote that has no address yet. */
export async function insertCustomerWithoutEmail(db: Db): Promise<{ id: string }> {
  const inserted = await db.from("customers").insert({ email: null }).select("id").single();
  fail(inserted.error);
  if (!inserted.data?.id) throw new Error("Customer was not created");
  return { id: String(inserted.data.id) };
}

/**
 * Write `email` onto a quote that does not have one.
 * An address already stored on that customer stays.
 * When another customer already owns the address, the order points at that row.
 */
export async function assignOrderEmail(
  db: Db,
  orderId: string,
  customerId: string,
  email: string,
): Promise<{ attached: boolean; customerId: string }> {
  const address = assertEmail(email);
  const current = await customerEmail(db, customerId);
  if (current) return { attached: false, customerId };

  const existing = await db.from("customers").select("id").eq("email", address).maybeSingle();
  fail(existing.error);
  const existingId = existing.data?.id ? String(existing.data.id) : null;
  if (existingId && existingId !== customerId) {
    await updateOrder(db, orderId, { customer_id: existingId });
    return { attached: true, customerId: existingId };
  }

  const updated = await db
    .from("customers")
    .update({ email: address })
    .eq("id", customerId)
    .is("email", null)
    .select("id");
  if (updated.error?.code === "23505") {
    const winner = await db.from("customers").select("id").eq("email", address).maybeSingle();
    fail(winner.error);
    const winnerId = winner.data?.id ? String(winner.data.id) : null;
    if (!winnerId) return { attached: false, customerId };
    await updateOrder(db, orderId, { customer_id: winnerId });
    return { attached: true, customerId: winnerId };
  }
  fail(updated.error);
  const wrote = ((updated.data ?? []) as Row[]).some((row) => row.id);
  if (wrote) return { attached: true, customerId };
  return { attached: false, customerId };
}

export async function insertOrder(
  db: Db,
  input: {
    id?: string;
    tokenHash: string;
    customerId: string;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    gclid: string | null;
    landingPath: string | null;
    userId?: string | null;
    serviceType?: "translation" | "evaluation" | "expert_letter";
    orderType?: "translation" | "evaluation" | "expert_letter";
    service?: "diploma" | "course_by_course" | null;
    degreeCount?: number | null;
    includeTranslation?: boolean;
    services?: Array<"translation" | "diploma" | "course_by_course"> | null;
    evaluationCents?: number | null;
    translationCents?: number | null;
    totalCents?: number | null;
    unitPriceCents?: number | null;
    externalRef?: string | null;
    apiKeyId?: string | null;
    sourceLanguage?: string | null;
    targetLanguage?: string | null;
    languageConfirmed?: boolean;
    brand?: "gcs";
  },
): Promise<OrderRecord> {
  const { data, error } = await db
    .from("orders")
    .insert({
      ...(input.id ? { id: input.id } : {}),
      public_token_hash: input.tokenHash,
      customer_id: input.customerId,
      service_type: input.serviceType ?? (input.orderType === "evaluation" ? "evaluation" : "translation"),
      order_type: input.orderType ?? "translation",
      service: input.service ?? null,
      degree_count: input.degreeCount ?? null,
      include_translation: input.includeTranslation === true,
      ...(input.services ? { services: input.services } : {}),
      ...(input.evaluationCents != null ? { evaluation_cents: input.evaluationCents } : {}),
      ...(input.translationCents != null ? { translation_cents: input.translationCents } : {}),
      ...(input.totalCents != null ? { total_cents: input.totalCents } : {}),
      ...(input.unitPriceCents != null ? { unit_price_cents: input.unitPriceCents } : {}),
      status: "draft",
      expedited: false,
      utm_source: input.utmSource,
      utm_medium: input.utmMedium,
      utm_campaign: input.utmCampaign,
      gclid: input.gclid,
      landing_path: input.landingPath,
      ...(input.userId ? { user_id: input.userId } : {}),
      ...(input.serviceType ? { service_type: input.serviceType, order_type: input.orderType ?? input.serviceType } : {}),
      ...(input.externalRef ? { external_ref: input.externalRef } : {}),
      ...(input.apiKeyId ? { api_key_id: input.apiKeyId } : {}),
      ...(input.sourceLanguage ? { source_language: input.sourceLanguage } : {}),
      ...(input.targetLanguage ? { target_language: input.targetLanguage } : {}),
      ...(input.languageConfirmed ? { language_confirmed: true } : {}),
      ...(input.brand ? { brand: input.brand } : {}),
    })
    .select("*")
    .single();
  fail(error);
  return mapOrder(data as Row);
}

/** Remove an order that never received its files. Child rows cascade. */
export async function deleteOrder(db: Db, id: string): Promise<void> {
  const { error } = await db.from("orders").delete().eq("id", id);
  fail(error);
}

export async function getPreviewOrderById(db: Db, orderId: string): Promise<PreviewOrderRow | null> {
  const { data, error } = await db.from("orders").select(PREVIEW_ORDER_COLUMNS).eq("id", orderId).maybeSingle();
  fail(error);
  return data ? mapPreviewOrder(data as Row) : null;
}

export async function requirePreviewOrderByHash(db: Db, tokenHash: string): Promise<PreviewOrderRow> {
  const { data, error } = await db
    .from("orders")
    .select(PREVIEW_ORDER_COLUMNS)
    .eq("public_token_hash", tokenHash)
    .maybeSingle();
  fail(error);
  if (!data) throw new HttpError("Order not found", 404);
  return mapPreviewOrder(data as Row);
}

export async function listPreviewFrames(
  db: Db,
  orderId: string,
): Promise<{ documents: PreviewDocumentFrame[]; pages: PageRecord[] }> {
  const { data, error } = await db.from("documents").select(PREVIEW_DOCUMENT_COLUMNS).eq("order_id", orderId);
  fail(error);
  const documents = ((data ?? []) as Row[])
    .map((row) => ({
      id: String(row.id),
      filename: String(row.filename),
      position: num(row.position) ?? 0,
      appliedPosition: num(row.applied_position),
      pages: nestedRows(row.document_pages),
    }))
    .sort((a, b) => a.position - b.position || a.filename.localeCompare(b.filename));
  return {
    documents: documents.map((document) => ({
      id: document.id,
      filename: document.filename,
      position: document.position,
      appliedPosition: document.appliedPosition,
    })),
    pages: documents.flatMap((document) => document.pages.map(mapPage)),
  };
}

export async function listPreviewCorrections(db: Db, orderId: string): Promise<CorrectionRecord[]> {
  const { data, error } = await db
    .from("corrections")
    .select(PREVIEW_CORRECTION_COLUMNS)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  fail(error);
  return ((data ?? []) as Row[]).map(mapCorrection);
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
  options?: { statuses?: readonly string[] },
): Promise<boolean> {
  let query = db.from("orders").update(patch).eq("id", orderId);
  if (options?.statuses && options.statuses.length > 0) query = query.in("status", [...options.statuses]);
  const { data, error } = await query.select("id");
  fail(error);
  if (!options?.statuses) return true;
  return ((data ?? []) as { id?: string }[]).length > 0;
}

/** Sets paid_at once. A later call leaves the original timestamp. */
export async function markOrderPaidAt(db: Db, orderId: string, paidAt: string): Promise<void> {
  const { error } = await db.from("orders").update({ paid_at: paidAt }).eq("id", orderId).is("paid_at", null);
  fail(error);
}

/** Moves status only when it is still `from`. False means another worker won. */
export async function claimOrderStatus(db: Db, orderId: string, from: string, to: string): Promise<boolean> {
  const { data, error } = await db.from("orders").update({ status: to }).eq("id", orderId).eq("status", from).select("id");
  fail(error);
  return ((data ?? []) as { id?: string }[]).length > 0;
}

export async function claimOrderColumn(
  db: Db,
  orderId: string,
  column: "staff_alert_sent_at" | "staff_urgent_alert_sent_at" | "delivery_email_sent_at",
  at: string,
  statuses?: string[],
): Promise<boolean> {
  let query = db.from("orders").update({ [column]: at }).eq("id", orderId).is(column, null);
  if (statuses && statuses.length > 0) query = query.in("status", statuses);
  const { data, error } = await query.select("id");
  fail(error);
  return ((data ?? []) as { id?: string }[]).length > 0;
}

/** Claims the paid-evaluation staff webhook once. False means it was already claimed. */
export async function claimEvalPaidAlert(db: Db, orderId: string, at: string): Promise<boolean> {
  const { data, error } = await db
    .from("orders")
    .update({ eval_paid_alert_sent_at: at })
    .eq("id", orderId)
    .is("eval_paid_alert_sent_at", null)
    .select("id");
  fail(error);
  return ((data ?? []) as { id?: string }[]).length > 0;
}

export async function clearOrderColumn(
  db: Db,
  orderId: string,
  column: "staff_alert_sent_at" | "staff_urgent_alert_sent_at" | "delivery_email_sent_at",
  at: string,
): Promise<void> {
  const { error } = await db.from("orders").update({ [column]: null }).eq("id", orderId).eq(column, at);
  fail(error);
}

/**
 * Paid orders the cron may still need to email.
 * `paidBefore` is the two-minute translation cutoff. That query is translations,
 * plus evaluations that never received the first staff email.
 * `evaluationPaidBefore` is four clock hours ago, the soonest four business hours
 * can elapse. Evaluations already on the staff queue are loaded from there, and
 * the caller still checks Los Angeles business hours before the urgent email.
 */
export async function listStaffAlertCandidates(
  db: Db,
  paidBefore: string,
  evaluationPaidBefore: string,
): Promise<OrderRecord[]> {
  const waiting = [...WAITING_FOR_STAFF_STATUSES];
  const [translations, evaluations] = await Promise.all([
    db
      .from("orders")
      .select("*")
      .in("status", waiting)
      .not("paid_at", "is", null)
      .lte("paid_at", paidBefore)
      .is("staff_urgent_alert_sent_at", null)
      .or("service.is.null,staff_alert_sent_at.is.null")
      .order("paid_at", { ascending: true })
      .limit(40),
    db
      .from("orders")
      .select("*")
      .in("status", waiting)
      .not("paid_at", "is", null)
      .lte("paid_at", evaluationPaidBefore)
      .is("staff_urgent_alert_sent_at", null)
      .or("service.not.is.null,services.ov.{diploma,course_by_course}")
      .not("staff_alert_sent_at", "is", null)
      .order("paid_at", { ascending: true })
      .limit(40),
  ]);
  fail(translations.error);
  fail(evaluations.error);
  const byId = new Map<string, OrderRecord>();
  for (const row of [...((translations.data ?? []) as Row[]), ...((evaluations.data ?? []) as Row[])]) {
    const order = mapOrder(row);
    byId.set(order.id, order);
  }
  return [...byId.values()].sort((a, b) => (a.paidAt ?? "").localeCompare(b.paidAt ?? ""));
}

/** One column. The quote pipeline calls this once per extracted page and once per later step. */
export async function setOrderProgress(db: Db, orderId: string, progress: OrderProgress): Promise<void> {
  const { error } = await db.from("orders").update({ progress }).eq("id", orderId);
  fail(error);
}

export type StoredAddon = {
  id: AddonId;
  unitCents: number;
  quantity: number;
  totalCents: number;
};

export async function listOrderAddons(db: Db, orderId: string): Promise<StoredAddon[]> {
  const { data, error } = await db.from("order_addons").select("*").eq("order_id", orderId);
  fail(error);
  const rank = new Map<AddonId, number>(ADDON_CATALOG.map((item, index) => [item.id, index]));
  return ((data ?? []) as Row[])
    .flatMap((row): StoredAddon[] => {
      const id = str(row.addon_id);
      if (id !== "notarization" && id !== "mail" && id !== "expedited") return [];
      return [
        {
          id,
          unitCents: num(row.unit_cents) ?? 0,
          quantity: num(row.quantity) ?? 1,
          totalCents: num(row.total_cents) ?? 0,
        },
      ];
    })
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}

export async function replaceOrderAddons(
  db: Db,
  orderId: string,
  input: { addons: PricedAddon[]; shippingAddress: ShippingAddress | null; addonCents: number; totalCents: number },
): Promise<void> {
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  const expedited = expeditedFlagForAddons(order, input.addons);
  const { error: deleted } = await db.from("order_addons").delete().eq("order_id", orderId);
  fail(deleted);
  if (input.addons.length > 0) {
    const { error } = await db.from("order_addons").insert(
      input.addons.map((item) => ({
        order_id: orderId,
        addon_id: item.id,
        unit_cents: item.unitCents,
        quantity: item.quantity,
        total_cents: item.totalCents,
      })),
    );
    fail(error);
  }
  const mail = input.addons.some((item) => item.id === "mail");
  const notarization = input.addons.some((item) => item.id === "notarization");
  const address = input.shippingAddress;
  await updateOrder(db, orderId, {
    total_cents: input.totalCents,
    addon_cents: input.addonCents,
    expedited,
    shipping_name: address?.name ?? null,
    shipping_line1: address?.line1 ?? null,
    shipping_line2: address?.line2 ?? null,
    shipping_city: address?.city ?? null,
    shipping_state: address?.state ?? null,
    shipping_postal_code: address?.postalCode ?? null,
    shipping_country: address?.country ?? null,
    mail_status: mail ? "pending" : null,
    mail_tracking: null,
    notarization_status: notarization ? "pending" : null,
  });
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
    pageCount?: number | null;
  },
): Promise<void> {
  const pageCount = input.pageCount != null && input.pageCount > 0 ? input.pageCount : null;
  const { error } = await db.from("documents").insert({
    id: input.id,
    order_id: input.orderId,
    original_path: input.originalPath,
    filename: input.filename,
    mime: input.mime,
    size: input.size,
    position: input.position,
    status: "uploaded",
    ...(pageCount != null ? { page_count: pageCount } : {}),
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
    skipped?: boolean;
    skipReason?: string | null;
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
      skipped: page.skipped ?? false,
      skip_reason: page.skipReason ?? null,
    })),
  );
  fail(error);
}

export async function setPageSkipped(db: Db, pageId: string, skipped: boolean): Promise<void> {
  const { error } = await db.from("document_pages").update({ skipped }).eq("id", pageId);
  fail(error);
}

/**
 * Clears a false blank skip. `skip_reason: "blank"` still hides the page from
 * translation after `skipped` is turned off.
 */
export async function unskipBlankPage(db: Db, pageId: string): Promise<void> {
  const { error } = await db
    .from("document_pages")
    .update({ skipped: false, skip_reason: null })
    .eq("id", pageId);
  fail(error);
}

export async function listPages(db: Db, documentIds: string[]): Promise<PageRecord[]> {
  if (documentIds.length === 0) return [];
  const { data, error } = await db.from("document_pages").select("*").in("document_id", documentIds);
  fail(error);
  return ((data ?? []) as Row[]).map(mapPage);
}

/** Geometry only. The preview viewer does not need OCR text, and `select *` pulls that column. */
export const PAGE_FRAME_COLUMNS =
  "id, document_id, page_number, width_pt, height_pt, upload_page, logical_page, order_hint";

/** Order columns the preview response and its auth check actually read. */
export const PREVIEW_ORDER_COLUMNS =
  "id, user_id, status, order_type, total_cents, unit_price_cents, billable_pages, combined_original_path, service, degree_count, addon_cents, evaluation_cents, translation_cents, include_translation, evaluation_result, brand, service_files";

/** Documents and their page frames in one query. Nested pages reuse PAGE_FRAME_COLUMNS. */
export const PREVIEW_DOCUMENT_COLUMNS =
  `id, filename, position, applied_position, document_pages(${PAGE_FRAME_COLUMNS})`;

export const PREVIEW_CORRECTION_COLUMNS =
  "id, document_id, page_number, passage, note, status, created_at";

export const PREVIEW_ROW_COLUMNS = "id, version, preview_path, status";

export type PreviewOrderRow = {
  id: string;
  userId: string | null;
  status: string;
  orderType: string;
  totalCents: number | null;
  unitPriceCents: number;
  billablePages: number | null;
  combinedOriginalPath: string | null;
  service: "diploma" | "course_by_course" | null;
  degreeCount: number | null;
  addonCents: number;
  evaluationCents: number | null;
  translationCents: number | null;
  includeTranslation: boolean;
  evaluationPageCount: number | null;
  /** Absent on rows selected before the GCS evaluation preview. */
  brand?: "credpronto" | "gcs" | null;
  serviceFiles?: Partial<Record<"diploma" | "course_by_course", string>> | null;
};

export type PreviewDocumentFrame = {
  id: string;
  filename: string;
  position: number;
  appliedPosition: number | null;
};

function mapPreviewOrder(row: Row): PreviewOrderRow {
  const service = row.service === "diploma" || row.service === "course_by_course" ? row.service : null;
  return {
    id: String(row.id),
    userId: str(row.user_id),
    status: String(row.status),
    orderType: row.order_type === "evaluation" || row.order_type === "expert_letter" ? row.order_type : "translation",
    totalCents: num(row.total_cents),
    unitPriceCents: num(row.unit_price_cents) ?? 995,
    billablePages: num(row.billable_pages),
    combinedOriginalPath: str(row.combined_original_path),
    service,
    degreeCount: num(row.degree_count),
    addonCents: num(row.addon_cents) ?? 0,
    evaluationCents: num(row.evaluation_cents),
    translationCents: num(row.translation_cents),
    includeTranslation: row.include_translation === true,
    evaluationPageCount: parseEvaluationResult(row.evaluation_result)?.pageCount ?? null,
    brand: row.brand === "gcs" || row.brand === "credpronto" ? row.brand : null,
    serviceFiles: storedServiceFiles(row.service_files),
  };
}

function nestedRows(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Row => item != null && typeof item === "object");
}

export async function listPageFrames(db: Db, documentIds: string[]): Promise<PageRecord[]> {
  if (documentIds.length === 0) return [];
  const { data, error } = await db.from("document_pages").select(PAGE_FRAME_COLUMNS).in("document_id", documentIds);
  fail(error);
  return ((data ?? []) as Row[]).map(mapPage);
}

export function withCombinedNumbers(
  documents: Array<{ id: string; position: number; appliedPosition: number | null }>,
  pages: PageRecord[],
) {
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

const FINAL_CORRECTION_STATUSES = new Set<FinalCorrectionStatus>(["open", "in_progress", "fixed"]);

function mapFinalCorrection(row: Row): FinalCorrectionRecord {
  const status = str(row.status);
  if (!status || !FINAL_CORRECTION_STATUSES.has(status as FinalCorrectionStatus)) {
    throw new Error("Unknown final correction status");
  }
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    text: str(row.request_text) ?? "",
    status: status as FinalCorrectionStatus,
    finalPath: str(row.final_path),
    finalVersion: num(row.final_version),
    claimedAt: str(row.claimed_at),
    fixedAt: str(row.fixed_at),
    createdAt: str(row.created_at) ?? new Date().toISOString(),
  };
}

export async function getFinalCorrection(db: Db, orderId: string): Promise<FinalCorrectionRecord | null> {
  const { data, error } = await db.from("order_final_corrections").select("*").eq("order_id", orderId).maybeSingle();
  fail(error);
  return data ? mapFinalCorrection(data as Row) : null;
}

/** Null when this order already has a request (unique order_id). */
export async function insertFinalCorrection(
  db: Db,
  input: { orderId: string; text: string },
): Promise<FinalCorrectionRecord | null> {
  const { data, error } = await db
    .from("order_final_corrections")
    .insert({ order_id: input.orderId, request_text: input.text, status: "open" })
    .select("*")
    .single();
  if (error?.code === "23505") return null;
  fail(error);
  return mapFinalCorrection(data as Row);
}

export async function listFinalCorrectionsByStatus(
  db: Db,
  status: "open" | "in_progress",
): Promise<FinalCorrectionRecord[]> {
  const { data, error } = await db
    .from("order_final_corrections")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: true });
  fail(error);
  return ((data ?? []) as Row[]).map(mapFinalCorrection);
}

/** Moves open -> in_progress. Null when another worker already claimed it. */
export async function claimFinalCorrection(
  db: Db,
  orderId: string,
  claimedAt: string,
): Promise<FinalCorrectionRecord | null> {
  const { data, error } = await db
    .from("order_final_corrections")
    .update({ status: "in_progress", claimed_at: claimedAt })
    .eq("order_id", orderId)
    .eq("status", "open")
    .select("*");
  fail(error);
  const row = ((data ?? []) as Row[])[0];
  return row ? mapFinalCorrection(row) : null;
}

/** Moves in_progress -> fixed. Null when the row was no longer in progress. */
export async function markFinalCorrectionFixed(
  db: Db,
  orderId: string,
  input: { path: string; version: number; fixedAt: string },
): Promise<FinalCorrectionRecord | null> {
  const { data, error } = await db
    .from("order_final_corrections")
    .update({
      status: "fixed",
      final_path: input.path,
      final_version: input.version,
      fixed_at: input.fixedAt,
    })
    .eq("order_id", orderId)
    .eq("status", "in_progress")
    .select("*");
  fail(error);
  const row = ((data ?? []) as Row[])[0];
  return row ? mapFinalCorrection(row) : null;
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

/** When the first ready translation preview was generated. Later corrections do not move it. */
export async function earliestReadyPreviewAt(db: Db, orderId: string): Promise<string | null> {
  const { data, error } = await db
    .from("previews")
    .select("generated_at")
    .eq("order_id", orderId)
    .eq("status", "ready")
    .order("version", { ascending: true })
    .limit(1);
  fail(error);
  const row = (data ?? [])[0] as Row | undefined;
  return str(row?.generated_at);
}

export async function latestReadyPreview(db: Db, orderId: string): Promise<PreviewRecord | null> {
  const { data, error } = await db
    .from("previews")
    .select(PREVIEW_ROW_COLUMNS)
    .eq("order_id", orderId)
    .eq("status", "ready")
    .order("version", { ascending: false })
    .limit(1);
  fail(error);
  const row = (data ?? [])[0] as Row | undefined;
  return row ? mapPreview(row) : null;
}

export async function listReadyPreviewPaths(db: Db, orderId: string): Promise<string[]> {
  const { data, error } = await db
    .from("previews")
    .select("preview_path")
    .eq("order_id", orderId)
    .eq("status", "ready");
  fail(error);
  return (data ?? []).flatMap((row) => {
    const path = (row as Row).preview_path;
    return typeof path === "string" && path ? [path] : [];
  });
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

const EDGE_SLUG_PAGE = 1000;
const EDGE_SLUG_MAX = 5000;

/**
 * Exact country_slug wins. When the order slug is only part of the loaded
 * country name (`south-korea` inside `korea-republic-of-south-korea`), use the
 * one stored slug that contains it on a hyphen boundary.
 */
export async function resolveEdgeCountrySlug(db: Db, orderSlug: string): Promise<string | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(orderSlug)) return null;
  if (await edgeCountrySlugExists(db, orderSlug)) return orderSlug;
  const filter = countrySlugFallbackFilter(orderSlug);
  if (!filter) return null;
  const [credentialSlugs, scaleSlugs] = await Promise.all([
    collectEdgeCountrySlugs(db, "edge_credentials", filter),
    collectEdgeCountrySlugs(db, "edge_grading_scales", filter),
  ]);
  if (!credentialSlugs || !scaleSlugs) return null;
  return resolveStoredCountrySlug(orderSlug, [...credentialSlugs, ...scaleSlugs]);
}

async function edgeCountrySlugExists(db: Db, slug: string): Promise<boolean> {
  const [credentials, scales] = await Promise.all([
    db.from("edge_credentials").select("country_slug").eq("country_slug", slug).limit(1),
    db.from("edge_grading_scales").select("country_slug").eq("country_slug", slug).limit(1),
  ]);
  fail(credentials.error);
  fail(scales.error);
  return (credentials.data?.length ?? 0) > 0 || (scales.data?.length ?? 0) > 0;
}

async function collectEdgeCountrySlugs(
  db: Db,
  table: "edge_credentials" | "edge_grading_scales",
  filter: string,
): Promise<string[] | null> {
  const slugs: string[] = [];
  for (let from = 0; from < EDGE_SLUG_MAX; from += EDGE_SLUG_PAGE) {
    const { data, error } = await db
      .from(table)
      .select("country_slug")
      .or(filter)
      .range(from, from + EDGE_SLUG_PAGE - 1);
    fail(error);
    const rows = (data ?? []) as Row[];
    for (const row of rows) {
      const slug = str(row.country_slug);
      if (slug) slugs.push(slug);
    }
    if (rows.length < EDGE_SLUG_PAGE) return slugs;
  }
  return null;
}

export async function listEdgeCredentialsForCountry(
  db: Db,
  countrySlug: string,
): Promise<EdgeCredentialRecord[]> {
  const { data, error } = await db
    .from("edge_credentials")
    .select("id, country_slug, country, title, content, level_number, level_title, url, us_equivalency")
    .eq("country_slug", countrySlug);
  fail(error);
  return ((data ?? []) as Row[]).flatMap((row) => {
    const mapped = mapEdgeCredentialRow(row);
    return mapped ? [mapped] : [];
  });
}

export async function listEdgeGradingScalesForCountry(
  db: Db,
  countrySlug: string,
): Promise<EdgeGradingScaleRecord[]> {
  const { data, error } = await db
    .from("edge_grading_scales")
    .select("id, country_slug, title, raw, rows")
    .eq("country_slug", countrySlug);
  fail(error);
  return ((data ?? []) as Row[]).flatMap((row) => {
    const mapped = mapEdgeGradingScaleRow(row);
    return mapped ? [mapped] : [];
  });
}

export async function listEdgeEquivalenciesForCredential(
  db: Db,
  edgeCredentialId: string,
): Promise<EdgeEquivalencyRecord[]> {
  const { data, error } = await db
    .from("edge_equivalencies")
    .select("id, edge_credential_id, country, credential_title, edge_level, us_equivalency, basis, confidence")
    .eq("edge_credential_id", edgeCredentialId);
  fail(error);
  return ((data ?? []) as Row[]).flatMap((row) => {
    const mapped = mapEdgeEquivalencyRow(row);
    return mapped ? [mapped] : [];
  });
}

export async function getEdgeCredential(db: Db, id: string): Promise<EdgeCredentialRecord | null> {
  const { data, error } = await db
    .from("edge_credentials")
    .select("id, country_slug, country, title, content, level_number, level_title, url, us_equivalency")
    .eq("id", id)
    .maybeSingle();
  fail(error);
  return data ? mapEdgeCredentialRow(data as Row) : null;
}

export async function getEdgeGradingScale(db: Db, id: string): Promise<EdgeGradingScaleRecord | null> {
  const { data, error } = await db
    .from("edge_grading_scales")
    .select("id, country_slug, title, raw, rows")
    .eq("id", id)
    .maybeSingle();
  fail(error);
  return data ? mapEdgeGradingScaleRow(data as Row) : null;
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

export async function updateTranslationOutput(db: Db, translationId: string, output: unknown): Promise<void> {
  const { error } = await db.from("translations").update({ output }).eq("id", translationId);
  fail(error);
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

export type BundleTranslationSignals = {
  qa: { status: QaStatus; score: number } | null;
  languageConfidence: number | null;
  pageNeedsReview: boolean;
  openCorrections: boolean;
};

/** QA, language confidence, page review, and open corrections for the translation release check. */
export async function listBundleTranslationSignals(
  db: Db,
  orderIds: string[],
): Promise<Map<string, BundleTranslationSignals>> {
  const signals = new Map<string, BundleTranslationSignals>();
  for (const id of orderIds) {
    signals.set(id, { qa: null, languageConfidence: null, pageNeedsReview: false, openCorrections: false });
  }
  if (orderIds.length === 0) return signals;

  const [documents, runs, corrections] = await Promise.all([
    db.from("documents").select("id, order_id, confidence").in("order_id", orderIds),
    db.from("order_qa_runs").select("order_id, attempt, status, score").in("order_id", orderIds),
    db.from("corrections").select("order_id, status").in("order_id", orderIds),
  ]);
  fail(documents.error);
  fail(runs.error);
  fail(corrections.error);

  const documentOrder = new Map<string, string>();
  const confidenceByOrder = new Map<string, number[]>();
  for (const row of (documents.data ?? []) as Row[]) {
    const orderId = String(row.order_id);
    documentOrder.set(String(row.id), orderId);
    const confidence = num(row.confidence);
    if (confidence == null) continue;
    const list = confidenceByOrder.get(orderId) ?? [];
    list.push(confidence);
    confidenceByOrder.set(orderId, list);
  }

  const documentIds = [...documentOrder.keys()];
  if (documentIds.length > 0) {
    const pages = await db
      .from("document_pages")
      .select("document_id, needs_review")
      .in("document_id", documentIds);
    fail(pages.error);
    for (const row of (pages.data ?? []) as Row[]) {
      if (!row.needs_review) continue;
      const current = signals.get(documentOrder.get(String(row.document_id)) ?? "");
      if (current) current.pageNeedsReview = true;
    }
  }

  for (const [orderId, values] of confidenceByOrder) {
    const current = signals.get(orderId);
    if (current && values.length > 0) current.languageConfidence = Math.min(...values);
  }

  const latest = new Map<string, { attempt: number; status: QaStatus; score: number }>();
  for (const row of (runs.data ?? []) as Row[]) {
    const orderId = String(row.order_id);
    const attempt = num(row.attempt) ?? 0;
    const status: QaStatus =
      row.status === "pass" || row.status === "fail" || row.status === "retranslated" ? row.status : "fail";
    const score = num(row.score) ?? 0;
    const previous = latest.get(orderId);
    if (!previous || attempt >= previous.attempt) latest.set(orderId, { attempt, status, score });
  }
  for (const [orderId, qa] of latest) {
    const current = signals.get(orderId);
    if (current) current.qa = { status: qa.status, score: qa.score };
  }

  for (const row of (corrections.data ?? []) as Row[]) {
    if (row.status !== "open") continue;
    const current = signals.get(String(row.order_id));
    if (current) current.openCorrections = true;
  }

  return signals;
}

export async function insertQaRun(
  db: Db,
  input: { orderId: string; attempt: number; status: QaStatus; score: number; issues: QaIssue[] },
): Promise<void> {
  const { error } = await db.from("order_qa_runs").upsert(
    {
      order_id: input.orderId,
      attempt: input.attempt,
      status: input.status,
      score: input.score,
      issues: input.issues,
    },
    { onConflict: "order_id,attempt" },
  );
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
  reviewReason: string | null = null,
) {
  let query = db
    .from("orders")
    .select(
      "id, status, service_type, source_language, billable_pages, total_cents, currency, created_at, paid_at, review_reason, expedited, customer_id, customers(email)",
      { count: "exact" },
    )
    .order("paid_at", { ascending: true, nullsFirst: false })
    .order("expedited", { ascending: false })
    .order("created_at", { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (status) query = query.eq("status", status);
  if (reviewReason) query = query.eq("review_reason", reviewReason);
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
      paidAt: str(row.paid_at),
      reviewReason: str(row.review_reason),
      expedited: row.expedited === true,
      email: email ?? null,
      fulfillment: fulfillmentState({ status: String(row.status), paidAt: str(row.paid_at) }),
    };
  });
  return { orders, total: count ?? orders.length };
}

/** Paid credential evaluations still waiting for the staff report. Oldest payment first. */
export async function listEvaluationQueueOrders(
  db: Db,
  page: { limit: number; offset: number },
): Promise<{
  rows: Array<{
    id: string;
    service: string | null;
    services: Array<"translation" | "diploma" | "course_by_course"> | null;
    email: string | null;
    paidAt: string | null;
  }>;
  total: number;
}> {
  const { data, error, count } = await db
    .from("orders")
    .select("id, service, services, paid_at, customers(email)", { count: "exact" })
    .eq("order_type", "evaluation")
    .or("service.in.(diploma,course_by_course),services.ov.{diploma,course_by_course}")
    .in("status", ["paid", "needs_review"])
    .not("paid_at", "is", null)
    .order("paid_at", { ascending: true })
    .range(page.offset, page.offset + page.limit - 1);
  fail(error);
  const rows = ((data ?? []) as Row[]).map((row) => {
    const customer = row.customers as { email?: string } | { email?: string }[] | null;
    const email = Array.isArray(customer) ? customer[0]?.email : customer?.email;
    return {
      id: String(row.id),
      service: str(row.service),
      services: storedServices(row.services),
      email: email ?? null,
      paidAt: str(row.paid_at),
    };
  });
  return { rows, total: count ?? rows.length };
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
  includeTranslation: boolean;
  finalTranslationPath: string | null;
  certificationPath: string | null;
  reviewReason: string | null;
};

export async function listDocumentFilenames(db: Db, orderIds: string[]): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>();
  if (orderIds.length === 0) return names;
  const { data, error } = await db.from("documents").select("order_id, filename, position").in("order_id", orderIds);
  fail(error);
  const grouped = new Map<string, { filename: string; position: number }[]>();
  for (const row of (data ?? []) as Row[]) {
    const id = String(row.order_id);
    const list = grouped.get(id) ?? [];
    list.push({ filename: String(row.filename), position: num(row.position) ?? 0 });
    grouped.set(id, list);
  }
  for (const [id, list] of grouped) {
    list.sort((a, b) => a.position - b.position || a.filename.localeCompare(b.filename));
    names.set(
      id,
      list.map((item) => item.filename),
    );
  }
  return names;
}

export async function listOwnedOrderRows(db: Db, userId: string): Promise<OwnedOrderRow[]> {
  const { data, error } = await db
    .from("orders")
    .select(
      "id, status, service_type, service, degree_count, addon_cents, billable_pages, unit_price_cents, total_cents, currency, created_at, include_translation, translation_cents, final_translation_path, certification_path, review_reason",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  fail(error);
  return ((data ?? []) as Row[]).map((row) => {
    const service = row.service === "diploma" || row.service === "course_by_course" ? row.service : null;
    const includeTranslation = row.include_translation === true;
    const priced = evaluationPrice({
      service,
      degreeCount: num(row.degree_count),
      addonCents: num(row.addon_cents) ?? 0,
    });
    const translationCents = includeTranslation ? num(row.translation_cents) ?? 0 : 0;
    return {
      id: String(row.id),
      status: String(row.status),
      serviceType: String(row.service_type),
      billablePages: num(row.billable_pages),
      unitPriceCents: priced?.unitPriceCents ?? num(row.unit_price_cents) ?? 995,
      totalCents: priced ? priced.totalCents + translationCents : num(row.total_cents),
      currency: str(row.currency) ?? "usd",
      createdAt: str(row.created_at) ?? new Date().toISOString(),
      includeTranslation,
      finalTranslationPath: str(row.final_translation_path),
      certificationPath: str(row.certification_path),
      reviewReason: str(row.review_reason),
    };
  });
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
