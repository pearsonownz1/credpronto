import { claimOrdersForUser } from "@/lib/auth/claim";
import type { AuthUser } from "@/lib/auth/session";
import { paymentStatusForCustomer, summarizeCustomerOrder } from "./account-summary";
import {
  listDeliveriesForOrders,
  listDocumentFilenames,
  listOwnedOrderRows,
  listPaymentsForOrders,
  listReadyPreviewOrderIds,
} from "./db";
import type { Db } from "./storage";

export async function listMyOrders(db: Db, user: AuthUser) {
  await claimOrdersForUser(db, user);
  const orders = await listOwnedOrderRows(db, user.id);
  const ids = orders.map((order) => order.id);
  const [previewIds, payments, deliveries, filenames] = await Promise.all([
    listReadyPreviewOrderIds(db, ids),
    listPaymentsForOrders(db, ids),
    listDeliveriesForOrders(db, ids),
    listDocumentFilenames(db, ids),
  ]);

  return {
    orders: orders.map((order) => {
      const orderPayments = payments.filter((payment) => payment.orderId === order.id);
      const delivery = deliveries.find((row) => row.orderId === order.id) ?? null;
      const summary = summarizeCustomerOrder({
        id: order.id,
        status: order.status,
        serviceType: order.serviceType,
        totalCents: order.totalCents,
        currency: order.currency,
        billablePages: order.billablePages,
        unitPriceCents: order.unitPriceCents,
        createdAt: order.createdAt,
        previewReady: previewIds.has(order.id),
        paymentStatus: paymentStatusForCustomer(
          orderPayments.map((payment) => ({
            status: payment.status,
            createdAt: payment.createdAt,
          })),
        ),
        deliveryStatus: delivery?.status ?? null,
        includeTranslation: order.includeTranslation,
        finalTranslationPath: order.finalTranslationPath,
      });
      const documentName = filenames.get(order.id)?.filter(Boolean).join(", ") || null;
      return { ...summary, documentName };
    }),
  };
}
