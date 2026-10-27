import { analyzeOrder } from "./analysis";
import { retryEvaluation, shouldPrepareEvaluationReport } from "./evaluation";
import { ensurePaidEvaluationReports } from "./evaluation-dispatch";
import { orderIsPaid } from "./evaluation-summary";
import { orderHasEvaluation, resolveServices } from "./service-selection";
import {
  customerEmail,
  earliestReadyPreviewAt,
  getDelivery,
  getFinalCorrection,
  getOrderById,
  latestPayment,
  latestReadyPreview,
  listConfirmations,
  listCorrections,
  listDocuments,
  listOrderAddons,
  listPages,
  listQaRuns,
  listTranslations,
} from "./db";
import { recordTranslationFailure, translateOrder } from "./translation";
import { isGcsOrder } from "./gcs";
import { confirmFreeGcsQuote } from "./gcs-release";
import { withQuotedPages } from "./stored-pages";
import { toCustomerOrder, type CustomerOrder } from "./view";
import { serviceDb, type Db } from "./storage";
import type { OrderRecord } from "./types";

export async function loadCustomerOrder(db: Db, order: OrderRecord): Promise<CustomerOrder> {
  const priced = await withQuotedPages(db, order);
  const documents = await listDocuments(db, priced.id);
  const documentIds = documents.map((document) => document.id);
  const [pages, confirmations, preview, payment, delivery, email, addons, translationReadyAt, translations, qaRuns, corrections, finalCorrection] =
    await Promise.all([
      listPages(db, documentIds),
      listConfirmations(db, order.id),
      latestReadyPreview(db, order.id),
      latestPayment(db, order.id),
      getDelivery(db, order.id),
      customerEmail(db, order.customerId),
      listOrderAddons(db, order.id),
      earliestReadyPreviewAt(db, order.id),
      listTranslations(db, documentIds),
      listQaRuns(db, order.id),
      listCorrections(db, order.id),
      getFinalCorrection(db, order.id),
    ]);
  const latestQa = qaRuns.at(-1);

  return toCustomerOrder({
    order: priced,
    documents,
    pages,
    confirmations,
    previewVersion: preview?.version ?? null,
    paymentStatus: payment?.status ?? null,
    deliveryStatus: delivery?.status ?? null,
    deliveryFinalPath: delivery?.finalPath ?? null,
    qa: latestQa ? { status: latestQa.status, score: latestQa.score } : null,
    openCorrections: corrections.some((correction) => correction.status === "open"),
    deliveredAt: delivery?.deliveredAt ?? null,
    translationReadyAt,
    email,
    addons,
    translationOutputs: translations.map((translation) => translation.output),
    finalCorrection,
  });
}

export async function processOrder(orderId: string, token: string | null = null): Promise<void> {
  const db = serviceDb();
  const order = await getOrderById(db, orderId);
  if (!order) return;

  // Paid evaluations live on `services`. `service` is empty when diploma and course-by-course are both selected.
  if (orderIsPaid(order) && orderHasEvaluation(order)) {
    try {
      await ensurePaidEvaluationReports(db, order.id);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "evaluation reports failed");
    }
  }

  if (order.status === "draft" || (order.status === "failed" && !order.languageConfirmed)) {
    await analyzeOrder(db, order.id, token);
    await continueFreeGcsOrder(db, order.id, token);
    return;
  }

  // Stuck GCS uploads held for image quality still translate once a language is known.
  if (isGcsOrder(order) && order.status === "needs_review") {
    await continueFreeGcsOrder(db, order.id, token);
    return;
  }

  // Evaluation-only has no translation job. The report is built during analysis.
  if (orderHasEvaluation(order) && !resolveServices(order).includes("translation")) {
    if (shouldPrepareEvaluationReport(order) && order.sourceLanguage) {
      await retryEvaluation(db, order, order.sourceLanguage);
    }
    return;
  }

  if (
    order.status === "confirmed" ||
    order.status === "processing" ||
    order.status === "correction_requested" ||
    order.status === "preview_ready" ||
    (order.status === "failed" && order.languageConfirmed) ||
    (order.status === "paid" && !order.finalTranslationPath)
  ) {
    await translateOrder(db, order.id, token);
  }
}

/** A quoted (or recoverable needs_review) GCS order skips payment and keeps translating. */
export async function continueFreeGcsOrder(db: Db, orderId: string, token: string | null): Promise<void> {
  const fresh = await getOrderById(db, orderId);
  if (!fresh || !isGcsOrder(fresh)) return;
  const ready =
    (fresh.status === "quoted" || fresh.status === "needs_review") && Boolean(fresh.sourceLanguage);
  await confirmFreeGcsQuote(db, orderId, {
    sourceLanguage: fresh.sourceLanguage,
    quoted: ready,
    pagesRead: fresh.progress.pagesRead,
    pagesTotal: fresh.progress.pagesTotal,
  });
  if (!ready) return;
  await translateOrder(db, orderId, token);
}

/** `after()` work. A thrown translation still leaves status and review_reason. */
export async function processOrderInBackground(orderId: string, token: string | null): Promise<void> {
  try {
    await processOrder(orderId, token);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "order processing failed");
    try {
      await recordTranslationFailure(serviceDb(), orderId, error);
    } catch (settleError) {
      console.error(settleError instanceof Error ? settleError.message : "could not record translation failure");
    }
  }
}
