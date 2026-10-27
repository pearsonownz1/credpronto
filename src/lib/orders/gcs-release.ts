import {
  ensurePendingDelivery,
  hasEvent,
  insertEvent,
  markOrderPaidAt,
  updateDelivery,
  updateOrder,
  type Db,
} from "./db";
import { gcsFreePricePatch, resolveGcsAnalysisLanguage } from "./gcs";
import type { OrderProgress } from "./reading-progress";
import type { QuoteDecision } from "./quote";

/**
 * GCS staff edit faint and handwritten fields themselves. One saved page is
 * enough to quote: image quality, a page-level review flag, and a weak
 * language guess must not leave the order in `needs_review`.
 */
export function settleGcsAnalysis(input: {
  pageCount: number;
  decision: Pick<QuoteDecision, "status" | "reviewReason">;
  sourceLanguage: string | null;
  detectedSource: string | null;
  languages: readonly string[];
}): { status: "quoted" | "needs_review"; reviewReason: string | null; sourceLanguage: string } {
  const sourceLanguage = resolveGcsAnalysisLanguage(input.sourceLanguage, input.detectedSource, input.languages);
  if (input.pageCount >= 1) {
    return { status: "quoted", reviewReason: null, sourceLanguage };
  }
  return {
    status: input.decision.status,
    reviewReason: input.decision.reviewReason,
    sourceLanguage,
  };
}

/**
 * After analysis, keep a GCS order moving into translation.
 * A quoted order always continues. A review hold continues once a page exists,
 * including `image_quality`, so staff are not stopped on the upload.
 */
export function gcsTranslationContinue(order: {
  status: string;
  sourceLanguage: string | null;
  billablePages: number | null;
  progress: { pagesRead: number; pagesTotal: number };
}): { ready: boolean; sourceLanguage: string } {
  const pages = Math.max(order.progress.pagesTotal, order.progress.pagesRead, order.billablePages ?? 0);
  const sourceLanguage = resolveGcsAnalysisLanguage(order.sourceLanguage, null, []);
  const ready = order.status === "quoted" || (order.status === "needs_review" && pages >= 1);
  return { ready, sourceLanguage };
}

/** After the quote is saved, a GCS order skips the paywall and keeps translating. */
export async function confirmFreeGcsQuote(
  db: Db,
  orderId: string,
  input: { sourceLanguage: string | null; quoted: boolean; pagesRead: number; pagesTotal: number },
): Promise<void> {
  const patch: Record<string, unknown> = { ...gcsFreePricePatch() };
  if (input.quoted && input.sourceLanguage) {
    patch.source_language = input.sourceLanguage;
    patch.language_confirmed = true;
    patch.status = "confirmed";
    patch.review_reason = null;
    patch.progress = {
      step: "translating",
      pagesRead: input.pagesRead,
      pagesTotal: input.pagesTotal,
      retries: 0,
    } satisfies OrderProgress;
  }
  await updateOrder(db, orderId, patch);
}

/**
 * The certified file is already stored. Release it without a Stripe payment
 * so the download endpoint can sign the unwatermarked PDF.
 */
export async function releaseFreeGcsOrder(
  db: Db,
  orderId: string,
  paths: { finalPath: string; certificationPath: string },
  progress?: OrderProgress,
): Promise<void> {
  const now = new Date().toISOString();
  await ensurePendingDelivery(db, orderId);
  await updateDelivery(db, orderId, {
    status: "delivered",
    approved_by: null,
    approved_at: now,
    delivered_at: now,
    final_path: paths.finalPath,
    certification_path: paths.certificationPath,
  });
  await markOrderPaidAt(db, orderId, now);
  await updateOrder(db, orderId, {
    status: "delivered",
    ...gcsFreePricePatch(),
    final_translation_path: paths.finalPath,
    certification_path: paths.certificationPath,
    review_reason: null,
    ...(progress ? { progress } : {}),
  });
  if (!(await hasEvent(db, orderId, "approved"))) {
    await insertEvent(db, orderId, "approved", { auto: true, brand: "gcs" });
  }
}
