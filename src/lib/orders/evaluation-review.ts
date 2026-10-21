import { MAX_FILE_BYTES, FINALS_BUCKET } from "./constants";
import { ensurePendingDelivery, getDelivery, getOrderById, hasEvent, insertEvent, listEvaluationQueueOrders, settledPayment, updateDelivery, updateOrder, type Db } from "./db";
import { sendFinalCustomerEmail } from "./final-email";
import { HttpError } from "./errors";
import { ensureStaffRow, requireStaff } from "./staff";
import { uploadObject } from "./storage";
import { notifyLifecycle, notifyOrder } from "./webhook-delivery";
import { waitingMinutes } from "./certification-queue";
import { isCertifiedTranslationPath } from "./final-file";
import { orderEvaluationKinds } from "./service-selection";
import { concatPdfs } from "./pdf/merge";
import { downloadObject } from "./storage";
import type { EvaluationService, OrderRecord } from "./types";

export type EvaluationQueueOrder = {
  id: string;
  type: "diploma" | "course_by_course" | "diploma_and_course_by_course";
  services: Array<"diploma" | "course_by_course">;
  customerEmail: string | null;
  paidAt: string;
  waitMinutes: number;
};

/** Whole minutes since payment. Orders without a real paid time are not queued. */
export function evaluationQueueOrder(
  row: {
    id: string;
    service: string | null;
    services?: readonly string[] | null;
    email: string | null;
    paidAt: string | null;
  },
  now: number,
): EvaluationQueueOrder | null {
  const kinds = orderEvaluationKinds(row);
  if (kinds.length === 0) return null;
  if (!row.paidAt) return null;
  const waitMinutes = waitingMinutes({ paidAt: row.paidAt }, now);
  if (waitMinutes == null) return null;
  return {
    id: row.id,
    type: kinds.length === 1 ? kinds[0]! : "diploma_and_course_by_course",
    services: kinds,
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
  const kinds = orderEvaluationKinds(order);
  if (kinds.length === 0) throw new HttpError("This order is not an evaluation", 409);
  if (order.status === "cancelled") throw new HttpError("This order is cancelled", 409);
  const payment = await settledPayment(db, order.id);
  if (!payment) throw new HttpError("This order is not paid", 409);

  if (kinds.length === 1) {
    const path = evaluationDeliverablePath(order.id);
    await uploadObject(db, FINALS_BUCKET, path, bytes, "application/pdf");
    return publishEvaluationDelivery({ db, userId, order, path });
  }

  const service = deliveredEvaluationService(form, kinds);
  const partPath = `${order.id}/${service}-evaluation.pdf`;
  await uploadObject(db, FINALS_BUCKET, partPath, bytes, "application/pdf");
  const files: Partial<Record<EvaluationService, string>> = { ...(order.serviceFiles ?? {}), [service]: partPath };
  const pending = kinds.filter((kind) => !files[kind]);
  if (pending.length > 0) {
    await updateOrder(db, order.id, { service_files: files });
    return { status: "received" as const, email: "skipped" as const, pending };
  }

  const diplomaBytes =
    service === "diploma" ? bytes : await downloadObject(db, FINALS_BUCKET, files.diploma as string);
  const courseBytes =
    service === "course_by_course"
      ? bytes
      : await downloadObject(db, FINALS_BUCKET, files.course_by_course as string);
  const merged = await concatPdfs([diplomaBytes, courseBytes]);
  const path = evaluationDeliverablePath(order.id);
  await uploadObject(db, FINALS_BUCKET, path, merged, "application/pdf");
  return publishEvaluationDelivery({ db, userId, order, path, serviceFiles: files });
}

function deliveredEvaluationService(form: FormData, kinds: readonly EvaluationService[]): EvaluationService {
  const raw = form.get("service");
  const service = typeof raw === "string" ? raw.trim() : "";
  if (service !== "diploma" && service !== "course_by_course") {
    throw new HttpError("service must be diploma or course_by_course", 400);
  }
  if (!kinds.includes(service)) throw new HttpError("This order does not include that evaluation", 409);
  return service;
}

function storedReportPaths(order: OrderRecord, reportPath: string): {
  final_translation_path: string;
  certification_path: string;
} {
  if (order.includeTranslation === true && isCertifiedTranslationPath(order.finalTranslationPath)) {
    return {
      final_translation_path: order.finalTranslationPath,
      certification_path: isCertifiedTranslationPath(order.certificationPath)
        ? order.certificationPath
        : order.finalTranslationPath,
    };
  }
  return { final_translation_path: reportPath, certification_path: reportPath };
}

async function publishEvaluationDelivery(input: {
  db: Db;
  userId: string;
  order: OrderRecord;
  path: string;
  serviceFiles?: Partial<Record<EvaluationService, string>>;
}) {
  const { db, userId, order, path, serviceFiles } = input;
  const columns = storedReportPaths(order, path);
  await ensureStaffRow(db, userId);
  await ensurePendingDelivery(db, order.id);
  const delivery = await getDelivery(db, order.id);
  if (!delivery) throw new HttpError("Payment has not created a delivery", 409);

  const alreadyDelivered = delivery.status === "delivered" || order.status === "delivered";
  const now = new Date().toISOString();
  await updateOrder(db, order.id, {
    status: "delivered",
    final_translation_path: columns.final_translation_path,
    certification_path: columns.certification_path,
    ...(serviceFiles ? { service_files: serviceFiles } : {}),
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
