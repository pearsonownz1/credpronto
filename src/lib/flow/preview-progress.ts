export const PREVIEW_WORK_STEPS = [
  { id: "received", label: "Files received" },
  { id: "read", label: "Text read" },
  { id: "translating", label: "Translating and laying out" },
  { id: "ready", label: "Preview ready" },
] as const;

export type PreviewWorkStepId = (typeof PREVIEW_WORK_STEPS)[number]["id"];

export type PreviewWork = {
  phase: "working" | "ready";
  /** Bar width. Stays below 100 until the preview exists. */
  percent: number;
  displayPercent: number;
  label: string;
  steps: Array<{ id: PreviewWorkStepId; label: string; state: "done" | "current" | "pending" }>;
};

/** Equal slices of the four real steps. The bar sits on the current step. */
const STEP_PERCENT: Record<Exclude<PreviewWorkStepId, "ready">, number> = {
  received: 25,
  read: 50,
  translating: 75,
};

/** One interval for the whole wait. No backoff. */
export const PREVIEW_POLL_MS = 3_000;

export type PreviewReadyOrder = {
  status?: string | null;
  /** Customer payload shape from `GET /api/orders/[token]`. */
  progress?: { step?: string | null } | null;
  /** Same step, when the caller already pulled it off `progress`. */
  progressStep?: string | null;
};

function orderProgressStep(order: PreviewReadyOrder): string | null {
  if (typeof order.progressStep === "string") return order.progressStep;
  const step = order.progress?.step;
  return typeof step === "string" ? step : null;
}

/**
 * The watermarked preview exists.
 * Keyed on `GET /api/orders/[token]`: `status === "preview_ready"` or
 * `progress.step === "done"`. Still working while that step is `translating`
 * or an earlier step (`uploaded`, `reading`, `language`, `counting`, `quoting`).
 */
export function previewIsReady(order: PreviewReadyOrder | null | undefined): boolean {
  if (!order) return false;
  // A timed-out translation is `needs_review` with step `done` and no preview.
  if (order.status === "needs_review") return false;
  if (order.status === "preview_ready") return true;
  return orderProgressStep(order) === "done";
}

export function previewPollDelay(): number {
  return PREVIEW_POLL_MS;
}

/** Keep polling until a watermarked preview exists or the order itself has failed. */
export function previewPollContinues(
  order: PreviewReadyOrder | null,
  httpStatus: number | null,
): boolean {
  if (httpStatus === 404 || httpStatus === 410) return false;
  if (order && previewIsReady(order)) return false;
  if (order && (order.status === "failed" || order.status === "cancelled")) return false;
  return true;
}

function currentStep(status: string, progressStep: string | null | undefined): Exclude<PreviewWorkStepId, "ready"> {
  if (progressStep === "uploaded") return "received";
  if (
    progressStep === "reading" ||
    progressStep === "language" ||
    progressStep === "counting" ||
    progressStep === "quoting"
  ) {
    return "read";
  }
  if (
    progressStep === "translating" ||
    status === "confirmed" ||
    status === "processing" ||
    status === "correction_requested" ||
    status === "needs_review"
  ) {
    return "translating";
  }
  return "received";
}

/**
 * Progress for the preview step. The bar moves through the working steps and
 * reaches 100 only once the preview is ready (`preview_ready` or step `done`).
 */
export function previewWork(input: {
  status: string;
  orderType?: string | null;
  progressStep?: string | null;
}): PreviewWork {
  const translatingLabel = input.orderType === "evaluation" ? "Building the report" : "Translating and laying out";
  const steps = PREVIEW_WORK_STEPS.map((step) =>
    step.id === "translating" ? { ...step, label: translatingLabel } : step,
  );
  if (previewIsReady({ status: input.status, progressStep: input.progressStep })) {
    return {
      phase: "ready",
      percent: 100,
      displayPercent: 100,
      label: "Preview ready",
      steps: steps.map((step) => ({ ...step, state: "done" as const })),
    };
  }

  const current = currentStep(input.status, input.progressStep);
  const index = steps.findIndex((step) => step.id === current);
  const percent = STEP_PERCENT[current];
  return {
    phase: "working",
    percent,
    displayPercent: percent,
    label: steps[index]?.label ?? translatingLabel,
    steps: steps.map((step, position) => ({
      ...step,
      state: position < index ? "done" : position === index ? "current" : "pending",
    })),
  };
}
