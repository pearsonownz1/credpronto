import { MAX_FILE_BYTES, FINALS_BUCKET } from "./constants";
import { ensurePendingDelivery, getDelivery, getOrderById, hasEvent, insertEvent, listEvaluationQueueOrders, settledPayment, updateDelivery, updateOrder } from "./db";
import { sendFinalCustomerEmail } from "./final-email";
import { HttpError } from "./errors";
import { ensureStaffRow, requireStaff } from "./staff";
import { uploadObject } from "./storage";
import { notifyLifecycle, notifyOrder } from "./webhook-delivery";
import { waitingMinutes } from "./certification-queue";

export type EvaluationQueueOrder = {
  id: string;
  type: "diploma" | "course_by_course";
  customerEmail: string | null;
  paidAt: string;
  waitMinutes: number;
};

/** Whole minutes since payment. Orders without a real paid time are not queued. */
export function evaluationQueueOrder(
  row: { id: string; service: string | null; email: string | null; paidAt: string | null },
  now: number,
): EvaluationQueueOrder | null {
  if (row.service !== "diploma" && row.service !== "course_by_course") return null;
  if (!row.paidAt) return null;
  const waitMinutes = waitingMinutes({ paidAt: row.paidAt }, now);
  if (waitMinutes == null) return null;
  return {
    id: row.id,
    type: row.service,
    customerEmail: row.email,
    paidAt: row.paidAt,
    waitMinutes,
  };
}

export function evaluationDeliverablePath(orderId: string): string {
  return `${orderId}/evaluation.pdf`;
}

/** A PDF starts with %PDF. Anything else is rejected before it is stored. */
export function assertEvaluationPdf(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) throw new HttpError("Empty files are not accepted", 400);
  if (bytes.byteLength > MAX_FILE_BYTES) throw new HttpError("Each file must be 25MB or smaller", 400);
  const header =
    bytes.byteLength >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46;
  if (!header) throw new HttpError("Upload a PDF", 415);
}

export async function listEvaluationReviewQueue(page: { limit: number; offset: number }, now = Date.now()) {
  const { db } = await requireStaff();
  const listed = await listEvaluationQueueOrders(db, page);
  const orders = listed.rows.flatMap((row) => {
    const queued = evaluationQueueOrder(row, now);
    return queued ? [queued] : [];
  });
  return {
    orders,
    page: { limit: page.limit, offset: page.offset, total: listed.total },
  };
}

export async function deliverEvaluationReport(orderId: string, request: Request) {
  const { db, userId } = await requireStaff();
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError("Expected multipart form data", 400);
  }
  const entry = form.get("file");
  if (!(entry instanceof File)) throw new HttpError("file is required", 400);
  const bytes = new Uint8Array(await entry.arrayBuffer());
  assertEvaluationPdf(bytes);

  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  if (order.service !== "diploma" && order.service !== "course_by_course") {
    throw new HttpError("This order is not an evaluation", 409);
  }
  if (order.status === "cancelled") throw new HttpError("This order is cancelled", 409);
  const payment = await settledPayment(db, order.id);
  if (!payment) throw new HttpError("This order is not paid", 409);

  const path = evaluationDeliverablePath(order.id);
  await uploadObject(db, FINALS_BUCKET, path, bytes, "application/pdf");
  await ensureStaffRow(db, userId);
  await ensurePendingDelivery(db, order.id);
  const delivery = await getDelivery(db, order.id);
  if (!delivery) throw new HttpError("Payment has not created a delivery", 409);

  const alreadyDelivered = delivery.status === "delivered" || order.status === "delivered";
  const now = new Date().toISOString();
  await updateOrder(db, order.id, {
    status: "delivered",
    final_translation_path: path,
    certification_path: path,
  });
  await updateDelivery(db, order.id, {
    status: "delivered",
    delivered_at: delivery.deliveredAt ?? now,
    approved_by: delivery.approvedBy ?? userId,
    approved_at: delivery.approvedAt ?? now,
    final_path: path,
    certification_path: path,
  });
  if (!(await hasEvent(db, order.id, "approved"))) {
    await insertEvent(db, order.id, "approved", { actorId: userId, file: "evaluation" });
  }

  if (alreadyDelivered) {
    return { status: "delivered" as const, email: "skipped" as const };
  }

  const sent = await sendFinalCustomerEmail(db, order);
  if (!sent.sent && !sent.skipped) {
    // Download stays open. The next settle retries the email while the claim is clear.
    await updateOrder(db, order.id, { status: "approved" });
    await updateDelivery(db, order.id, {
      status: "approved",
      delivered_at: null,
      approved_by: delivery.approvedBy ?? userId,
      approved_at: delivery.approvedAt ?? now,
      final_path: path,
      certification_path: path,
    });
    return { status: "approved" as const, email: "failed" as const };
  }
  await notifyOrder(db, order.id, "order.delivered");
  await notifyLifecycle(db, order.id, "order.completed");
  return {
    status: "delivered" as const,
    email: sent.skipped ? ("skipped" as const) : ("sent" as const),
  };
}
