import {
  assignOrderEmail,
  customerEmail,
  latestReadyPreview,
  listDocuments,
  type Db,
} from "./db";
import { sendPreviewReady } from "./email";
import { sendFinalCustomerEmail } from "./final-email";
import type { OrderRecord } from "./types";

const RECEIPT_STATUSES = new Set(["paid", "approved", "delivered"]);

function previewIncludesTranslation(order: OrderRecord): boolean {
  if (order.includeTranslation) return true;
  if ((order.translationCents ?? 0) > 0) return true;
  return order.orderType === "translation" && order.service == null;
}

/**
 * Store the account email on a quote that does not have one, then send the
 * preview link and receipt if those were waiting on an address.
 * An email already on the quote is left in place.
 */
export async function attachAccountEmail(
  db: Db,
  order: OrderRecord,
  email: string | null | undefined,
): Promise<boolean> {
  const address = email?.trim() ?? "";
  if (!address || !order.customerId) return false;
  const result = await assignOrderEmail(db, order.id, order.customerId, address);
  if (!result.attached) return false;
  try {
    await deliverAttachedQuoteEmail(db, { ...order, customerId: result.customerId });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "could not email the quote");
  }
  return true;
}

/** Preview and receipt mail for a quote that just received its first address. */
export async function deliverAttachedQuoteEmail(db: Db, order: OrderRecord): Promise<void> {
  const preview = await latestReadyPreview(db, order.id);
  if (preview) {
    const address = await customerEmail(db, order.customerId);
    if (address) {
      const documents = await listDocuments(db, order.id);
      await sendPreviewReady(address, {
        token: null,
        orderId: order.id,
        sourceLanguage: order.sourceLanguage,
        targetLanguage: order.targetLanguage,
        documentCount: documents.length,
        pageCount: order.billablePages,
        totalCents: order.totalCents,
        includesTranslation: previewIncludesTranslation(order),
      });
    }
  }
  if (order.paidAt || RECEIPT_STATUSES.has(order.status)) {
    await sendFinalCustomerEmail(db, order);
  }
}
