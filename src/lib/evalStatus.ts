/**
 * Customer evaluation progress.
 *
 * Status and per-step timestamps are read only in this file, so a backend
 * rename stays here. `select *` omits a column that has not been added yet;
 * a missing or unknown status falls back to under review.
 */

export const EVAL_STATUSES = [
  "under_review",
  "performing_evaluation",
  "performing_layout",
  "evaluation_complete",
] as const;

export type EvalStatus = (typeof EVAL_STATUSES)[number];

export type EvalStepState = "done" | "current" | "upcoming";

/** `orders.evaluation_status`. */
export const EVAL_STATUS_COLUMN = "evaluation_status";

/**
 * One timestamp column per status. Rename these strings if the backend
 * columns differ; the status values themselves stay the same.
 */
export const EVAL_STATUS_TIMESTAMP_COLUMNS: Record<EvalStatus, string> = {
  under_review: "under_review_at",
  performing_evaluation: "performing_evaluation_at",
  performing_layout: "performing_layout_at",
  evaluation_complete: "evaluation_complete_at",
};

/** How often the paid evaluation page reloads until the report is complete. */
export const EVAL_STATUS_POLL_MS = 15_000;

export const EVAL_STEP_LABEL: Record<EvalStatus, string> = {
  under_review: "Under review",
  performing_evaluation: "Performing evaluation",
  performing_layout: "Performing layout",
  evaluation_complete: "Evaluation complete",
};

/** Muted line under the current step. The completed step has no line. */
export const EVAL_STEP_DETAIL: Record<Exclude<EvalStatus, "evaluation_complete">, string> = {
  under_review: "We're checking your documents.",
  performing_evaluation: "An evaluator is working on your evaluation.",
  performing_layout: "We're formatting your report.",
};

export function isEvalStatus(value: unknown): value is EvalStatus {
  return typeof value === "string" && (EVAL_STATUSES as readonly string[]).includes(value);
}

/** Unknown or missing values stay on the first step so the page can still render. */
export function resolveEvalStatus(value: unknown): EvalStatus {
  return isEvalStatus(value) ? value : "under_review";
}

export function evalStepState(status: EvalStatus, step: EvalStatus): EvalStepState {
  const current = EVAL_STATUSES.indexOf(status);
  const index = EVAL_STATUSES.indexOf(step);
  if (index < current) return "done";
  if (index === current) return "current";
  return "upcoming";
}

export type EvaluationStep = {
  status: EvalStatus;
  label: string;
  state: EvalStepState;
  /** Only the current step, and never once the evaluation is complete. */
  detail: string | null;
  /** ISO time for a finished step. Null when that timestamp column is empty. */
  timestamp: string | null;
};

export type EvaluationTracker = {
  status: EvalStatus;
  steps: EvaluationStep[];
  showDownload: boolean;
};

function timestampValue(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  if (Number.isNaN(Date.parse(value))) return null;
  return value;
}

export function evaluationTracker(input: {
  evaluationStatus?: unknown;
  evaluationStatusAt?: Partial<Record<string, unknown>> | null;
}): EvaluationTracker {
  const status = resolveEvalStatus(input.evaluationStatus);
  const stamps = input.evaluationStatusAt ?? {};
  const steps = EVAL_STATUSES.map((step) => {
    const state = evalStepState(status, step);
    const detail =
      state === "current" && step !== "evaluation_complete" ? EVAL_STEP_DETAIL[step] : null;
    return {
      status: step,
      label: EVAL_STEP_LABEL[step],
      state,
      detail,
      timestamp: state === "done" ? timestampValue(stamps[step]) : null,
    };
  });
  return {
    status,
    steps,
    showDownload: status === "evaluation_complete",
  };
}

/** Reads the status column and the four timestamp columns. Missing columns yield null. */
export function readStoredEvalStatus(row: Record<string, unknown>): {
  evaluationStatus: EvalStatus | null;
  evaluationStatusAt: Partial<Record<EvalStatus, string>>;
} {
  const raw = row[EVAL_STATUS_COLUMN];
  const evaluationStatusAt: Partial<Record<EvalStatus, string>> = {};
  for (const status of EVAL_STATUSES) {
    const timestamp = timestampValue(row[EVAL_STATUS_TIMESTAMP_COLUMNS[status]]);
    if (timestamp) evaluationStatusAt[status] = timestamp;
  }
  return {
    evaluationStatus: isEvalStatus(raw) ? raw : null,
    evaluationStatusAt,
  };
}

/** Customer payload fields. Invalid stored values are dropped, not coerced. */
export function customerEvalStatus(order: {
  evaluationStatus?: unknown;
  evaluationStatusAt?: Partial<Record<string, unknown>> | null;
}): {
  evaluationStatus: EvalStatus | null;
  evaluationStatusAt: Partial<Record<EvalStatus, string>>;
} {
  const evaluationStatusAt: Partial<Record<EvalStatus, string>> = {};
  const stamps = order.evaluationStatusAt ?? {};
  for (const status of EVAL_STATUSES) {
    const timestamp = timestampValue(stamps[status]);
    if (timestamp) evaluationStatusAt[status] = timestamp;
  }
  return {
    evaluationStatus: isEvalStatus(order.evaluationStatus) ? order.evaluationStatus : null,
    evaluationStatusAt,
  };
}

function isEvaluationOrder(order: {
  orderType?: string | null;
  service?: string | null;
  serviceType?: string | null;
}): boolean {
  return order.orderType === "evaluation" || order.serviceType === "evaluation" || order.service != null;
}

/**
 * 15s while a paid evaluation is still in progress.
 * Null lets the caller keep its own delay (payment confirmation, or the
 * existing poll once the evaluation is complete and the file may still be releasing).
 */
export function evaluationStatusPollMs(
  order: {
    orderType?: string | null;
    service?: string | null;
    serviceType?: string | null;
    evaluationStatus?: unknown;
  } | null | undefined,
  phase: "finalizing" | "certifying" | "ready",
): number | null {
  if (!order || phase !== "certifying" || !isEvaluationOrder(order)) return null;
  if (order.evaluationStatus === "evaluation_complete") return null;
  return EVAL_STATUS_POLL_MS;
}

/** True when the existing evaluation download can be requested. */
export function evaluationDownloadReady(order: {
  status?: string | null;
  fulfillment?: "released" | "awaiting_review" | null;
  delivery?: { status: string } | null;
}): boolean {
  const delivery = order.delivery?.status;
  if (delivery === "approved" || delivery === "delivered") return true;
  if (order.fulfillment === "released") return true;
  if (order.fulfillment === "awaiting_review") return false;
  return order.status === "approved" || order.status === "delivered";
}
