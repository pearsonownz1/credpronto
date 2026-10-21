import { analyzeOrder } from "./analysis";
import {
  customerEmail,
  earliestReadyPreviewAt,
  getDelivery,
  getOrderById,
  latestPayment,
  latestReadyPreview,
  listConfirmations,
  listDocuments,
  listOrderAddons,
  listPages,
  listTranslations,
} from "./db";
import { recordTranslationFailure, translateOrder } from "./translation";
import { withQuotedPages } from "./stored-pages";
import { toCustomerOrder, type CustomerOrder } from "./view";
import { serviceDb, type Db } from "./storage";
import type { OrderRecord } from "./types";

export async function loadCustomerOrder(db: Db, order: OrderRecord): Promise<CustomerOrder> {
  const priced = await withQuotedPages(db, order);
  const documents = await listDocuments(db, priced.id);
  const documentIds = documents.map((document) => document.id);
  const [pages, confirmations, preview, payment, delivery, email, addons, translationReadyAt, translations] =
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
    ]);

  return toCustomerOrder({
    order: priced,
    documents,
    pages,
    confirmations,
    previewVersion: preview?.version ?? null,
    paymentStatus: payment?.status ?? null,
    deliveryStatus: delivery?.status ?? null,
    deliveredAt: delivery?.deliveredAt ?? null,
    translationReadyAt,
    email,
    addons,
    translationOutputs: translations.map((translation) => translation.output),
  });
}

export async function processOrder(orderId: string, token: string | null = null): Promise<void> {
  const db = serviceDb();
  const order = await getOrderById(db, orderId);
  if (!order) return;

  // Staff reviews a credential evaluation after payment. Do not extract or build a preview.
  if (order.service) return;

  if (order.status === "draft" || (order.status === "failed" && !order.languageConfirmed)) {
    await analyzeOrder(db, order.id, token);
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
