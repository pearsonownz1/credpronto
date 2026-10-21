import { customerEmail, getOrderById, updateOrder, type Db } from "./db";
import { orderPageLink, sendEvaluationStatus } from "./email";
import { HttpError } from "./errors";
import { requireStaff } from "./staff";
import type { OrderRecord } from "./types";

export const EVALUATION_STATUSES = [
  "under_review",
  "performing_evaluation",
  "performing_layout",
  "evaluation_complete",
] as const;

export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];

/** Timestamps keyed by the stage name the order payload exposes. */
export type EvaluationStatusAt = {
  under_review: string | null;
  performing_evaluation: string | null;
  performing_layout: string | null;
  evaluation_complete: string | null;
};

export const EMPTY_EVALUATION_STATUS_AT: EvaluationStatusAt = {
  under_review: null,
  performing_evaluation: null,
  performing_layout: null,
  evaluation_complete: null,
};

const STATUS_COLUMN: Record<EvaluationStatus, string> = {
  under_review: "under_review_at",
  performing_evaluation: "performing_evaluation_at",
  performing_layout: "performing_layout_at",
  evaluation_complete: "evaluation_complete_at",
};

export const EVALUATION_STATUS_LABEL: Record<EvaluationStatus, string> = {
  under_review: "Under review",
  performing_evaluation: "Performing evaluation",
  performing_layout: "Performing layout",
  evaluation_complete: "Evaluation complete",
};

export function isEvaluationStatus(value: unknown): value is EvaluationStatus {
  return typeof value === "string" && (EVALUATION_STATUSES as readonly string[]).includes(value);
}

export function evaluationStatusAt(order: {
  underReviewAt?: string | null;
  performingEvaluationAt?: string | null;
  performingLayoutAt?: string | null;
  evaluationCompleteAt?: string | null;
} | null | undefined): EvaluationStatusAt {
  return {
    under_review: order?.underReviewAt ?? null,
    performing_evaluation: order?.performingEvaluationAt ?? null,
    performing_layout: order?.performingLayoutAt ?? null,
    evaluation_complete: order?.evaluationCompleteAt ?? null,
  };
}

export function evaluationStatusValue(value: string | null | undefined): EvaluationStatus | null {
  return isEvaluationStatus(value) ? value : null;
}

function timestampPatch(status: EvaluationStatus, at: string): Record<string, string> {
  return {
    evaluation_status: status,
    [STATUS_COLUMN[status]]: at,
  };
}

function withStage(order: OrderRecord, status: EvaluationStatus, at: string): OrderRecord {
  const next: OrderRecord = { ...order, evaluationStatus: status };
  if (status === "under_review") next.underReviewAt = at;
  if (status === "performing_evaluation") next.performingEvaluationAt = at;
  if (status === "performing_layout") next.performingLayoutAt = at;
  if (status === "evaluation_complete") next.evaluationCompleteAt = at;
  return next;
}

/** Payment records the first stage. It does not email the customer; the receipt already went out. */
export async function stampEvaluationUnderReview(db: Db, order: OrderRecord, paidAt: string): Promise<void> {
  if (order.service !== "diploma" && order.service !== "course_by_course") return;
  if (order.evaluationStatus) return;
  try {
    await updateOrder(db, order.id, timestampPatch("under_review", paidAt));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "could not record under_review");
  }
}

function paidEvaluation(order: OrderRecord): boolean {
  if (order.service !== "diploma" && order.service !== "course_by_course") return false;
  if (order.paidAt) return true;
  return order.status === "paid" || order.status === "approved" || order.status === "delivered";
}

function readStatus(body: unknown): EvaluationStatus {
  if (!body || typeof body !== "object") throw new HttpError("Expected a JSON body", 400);
  const status = (body as { status?: unknown }).status;
  if (!isEvaluationStatus(status)) {
    throw new HttpError(
      "status must be under_review, performing_evaluation, performing_layout, or evaluation_complete.",
      400,
    );
  }
  return status;
}

/** Staff move the evaluation. A real change emails the customer. The same stage again does not. */
export async function setEvaluationStatus(orderId: string, body: unknown): Promise<{
  evaluationStatus: EvaluationStatus;
  evaluationStatusAt: EvaluationStatusAt;
  emailed: boolean;
}> {
  const { db } = await requireStaff();
  const status = readStatus(body);
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  if (order.service !== "diploma" && order.service !== "course_by_course") {
    throw new HttpError("This order is not an evaluation.", 409);
  }
  if (!paidEvaluation(order)) {
    throw new HttpError("The evaluation can change stage after payment.", 409);
  }
  if (order.evaluationStatus === status) {
    return {
      evaluationStatus: status,
      evaluationStatusAt: evaluationStatusAt(order),
      emailed: false,
    };
  }

  const at = new Date().toISOString();
  await updateOrder(db, order.id, timestampPatch(status, at));
  const address = await customerEmail(db, order.customerId);
  let emailed = false;
  if (address) {
    const sent = await sendEvaluationStatus(address, {
      orderId: order.id,
      statusLabel: EVALUATION_STATUS_LABEL[status],
      trackUrl: orderPageLink(order.id),
    });
    emailed = sent.sent;
  }
  return {
    evaluationStatus: status,
    evaluationStatusAt: evaluationStatusAt(withStage(order, status, at)),
    emailed,
  };
}
