import { analyzeOrder } from "./analysis";
import {
  getDelivery,
  getOrderById,
  latestPayment,
  latestReadyPreview,
  listConfirmations,
  listDocuments,
} from "./db";
import { translateOrder } from "./translation";
import { toCustomerOrder, type CustomerOrder } from "./view";
import { serviceDb, type Db } from "./storage";
import type { OrderRecord } from "./types";

export async function loadCustomerOrder(db: Db, order: OrderRecord): Promise<CustomerOrder> {
  const [documents, confirmations, preview, payment, delivery] = await Promise.all([
    listDocuments(db, order.id),
    listConfirmations(db, order.id),
    latestReadyPreview(db, order.id),
    latestPayment(db, order.id),
    getDelivery(db, order.id),
  ]);

  return toCustomerOrder({
    order,
    documents,
    confirmations,
    previewVersion: preview?.version ?? null,
    paymentStatus: payment?.status ?? null,
    deliveryStatus: delivery?.status ?? null,
  });
}

export async function processOrder(orderId: string, token: string | null = null): Promise<void> {
  const db = serviceDb();
  const order = await getOrderById(db, orderId);
  if (!order) return;

  if (order.status === "draft" || (order.status === "failed" && !order.languageConfirmed)) {
    await analyzeOrder(db, order.id);
    return;
  }

  if (
    order.status === "confirmed" ||
    order.status === "processing" ||
    order.status === "correction_requested" ||
    order.status === "preview_ready" ||
    (order.status === "failed" && order.languageConfirmed)
  ) {
    await translateOrder(db, order.id, token);
  }
}
