import { analyzeOrder } from "./analysis";
import { retryEvaluation, shouldPrepareEvaluationReport } from "./evaluation";
import {
  customerEmail,
  getDelivery,
  getOrderById,
  latestPayment,
  latestReadyPreview,
  listConfirmations,
  listDocuments,
  listOrderAddons,
  listPages,
} from "./db";
import { translateOrder } from "./translation";
import { toCustomerOrder, type CustomerOrder } from "./view";
import { serviceDb, type Db } from "./storage";
import type { OrderRecord } from "./types";

export async function loadCustomerOrder(db: Db, order: OrderRecord): Promise<CustomerOrder> {
  const documents = await listDocuments(db, order.id);
  const [pages, confirmations, preview, payment, delivery, email, addons] = await Promise.all([
    listPages(db, documents.map((document) => document.id)),
    listConfirmations(db, order.id),
    latestReadyPreview(db, order.id),
    latestPayment(db, order.id),
    getDelivery(db, order.id),
    customerEmail(db, order.customerId),
    listOrderAddons(db, order.id),
  ]);

  return toCustomerOrder({
    order,
    documents,
    pages,
    confirmations,
    previewVersion: preview?.version ?? null,
    paymentStatus: payment?.status ?? null,
    deliveryStatus: delivery?.status ?? null,
    email,
    addons,
  });
}

export async function processOrder(orderId: string, token: string | null = null): Promise<void> {
  const db = serviceDb();
  const order = await getOrderById(db, orderId);
  if (!order) return;

  if (order.status === "draft" || (order.status === "failed" && !order.languageConfirmed)) {
    await analyzeOrder(db, order.id, token);
    return;
  }

  if (order.service) {
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
