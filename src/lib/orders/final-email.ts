import { FINALS_BUCKET } from "./constants";
import {
  claimOrderColumn,
  clearOrderColumn,
  customerEmail,
  getDelivery,
  listOrderAddons,
  settledPayment,
  updateDelivery,
  updateOrder,
  type Db,
} from "./db";
import { accountLink, sendFinalDownload } from "./email";
import { receiptLineItems, renderFinalDownloadEmail } from "./email-templates";
import { DELIVERED_REVIEW_CLEAR } from "./review-reason";
import { resolveCustomerFinal } from "./final-file";
import { notifyLifecycle, notifyOrder } from "./webhook-delivery";
import { downloadObject } from "./storage";
import type { OrderRecord } from "./types";

type SendResult = { sent: boolean; skipped: boolean; detail?: string };

/**
 * One customer email once the file can be downloaded.
 * A claimed timestamp blocks a second send. A failed send releases the claim.
 */
export async function sendFinalCustomerEmail(db: Db, order: OrderRecord): Promise<SendResult> {
  const to = await customerEmail(db, order.customerId);
  if (!to) return { sent: false, skipped: true };
  const at = new Date().toISOString();
  const claimed = await claimOrderColumn(db, order.id, "delivery_email_sent_at", at);
  if (!claimed) return { sent: false, skipped: true };

  try {
    const [payment, addons, delivery] = await Promise.all([
      settledPayment(db, order.id),
      listOrderAddons(db, order.id),
      getDelivery(db, order.id),
    ]);
    const lines = receiptLineItems({
      service: order.service,
      degreeCount: order.degreeCount,
      evaluationCents: order.evaluationCents,
      translationCents: order.translationCents,
      billablePages: order.billablePages,
      unitPriceCents: order.unitPriceCents,
      addons,
    });
    const totalCents = payment?.amountCents ?? order.totalCents ?? lines.reduce((sum, line) => sum + line.amountCents, 0);
    let filename = order.service ? "evaluation.pdf" : "certified-translation.pdf";
    let attachment: { filename: string; content: Buffer } | undefined;
    if (delivery?.finalPath || delivery?.certificationPath) {
      try {
        const resolved = await resolveCustomerFinal(db, order, {
          finalPath: delivery.finalPath,
          certificationPath: delivery.certificationPath,
        });
        if (resolved) {
          filename = resolved.filename;
          const bytes = await downloadObject(db, FINALS_BUCKET, resolved.path);
          attachment = { filename: resolved.filename, content: Buffer.from(bytes) };
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : "final attachment failed");
      }
    }
    const rendered = renderFinalDownloadEmail({
      orderId: order.id,
      totalCents,
      lines,
      downloadUrl: accountLink(),
      filename,
    });
    const result = await sendFinalDownload(to, rendered, attachment);
    if (!result.sent && !result.skipped) await clearOrderColumn(db, order.id, "delivery_email_sent_at", at);
    return result;
  } catch (error) {
    await clearOrderColumn(db, order.id, "delivery_email_sent_at", at);
    const detail = error instanceof Error ? error.message : "final email failed";
    console.error(detail);
    return { sent: false, skipped: false, detail };
  }
}

/** Finish a release whose approval already landed and whose email has not. */
export async function retryFinalCustomerEmail(db: Db, order: OrderRecord): Promise<void> {
  const delivery = await getDelivery(db, order.id);
  if (!delivery) return;
  if (delivery.status === "delivered") {
    await updateOrder(db, order.id, {
      ...(order.status === "delivered" ? {} : { status: "delivered" as const }),
      ...DELIVERED_REVIEW_CLEAR,
    });
    return;
  }
  const sent = await sendFinalCustomerEmail(db, order);
  if (!sent.sent && !sent.skipped) return;
  const now = new Date().toISOString();
  await updateDelivery(db, order.id, {
    status: "delivered",
    delivered_at: delivery.deliveredAt ?? now,
    approved_by: delivery.approvedBy,
    approved_at: delivery.approvedAt ?? now,
    final_path: delivery.finalPath,
    certification_path: delivery.certificationPath,
  });
  await updateOrder(db, order.id, { status: "delivered", ...DELIVERED_REVIEW_CLEAR });
  await notifyOrder(db, order.id, "order.delivered");
  await notifyLifecycle(db, order.id, "order.completed");
}
