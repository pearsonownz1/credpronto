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

const STEP_PERCENT: Record<Exclude<PreviewWorkStepId, "ready">, number> = {
  received: 18,
  read: 46,
  translating: 95,
};

/** The working bar never passes this. 100 is only for a saved preview. */
export const PREVIEW_BAR_MAX = 95;

/** First polls are quick, then the page settles at a slower interval. */
export const PREVIEW_POLL_FAST_MS = 5_000;
export const PREVIEW_POLL_SLOW_MS = 15_000;
export const PREVIEW_POLL_FAST_TICKS = 6;

/** A translation still on `progress.step === "translating"` after this is late. */
export const PREVIEW_LONG_WAIT_MS = 15 * 60 * 1000;

export type PreviewReadyOrder = {
  status?: string | null;
  /**
   * `GET /api/orders/[token]` field. Version of the latest `previews` row with
   * `status: "ready"` — the watermarked preview. Null until that file is saved.
   * Staff approval (`approved` / delivery `approved`) is not this field.
   */
  previewVersion?: number | null;
};

/**
 * The watermarked preview exists.
 * Keyed on `previewVersion` >= 1 from `GET /api/orders/[token]` (latest preview
 * row marked `ready`), or `status === "preview_ready"` when that version is
 * not on the payload yet. `approved` and `delivery.status` are not consulted.
 */
export function previewIsReady(order: PreviewReadyOrder | null | undefined): boolean {
  if (!order) return false;
  if (typeof order.previewVersion === "number" && order.previewVersion >= 1) return true;
  return order.status === "preview_ready";
}

export function previewPollDelay(completedPolls: number): number {
  return completedPolls < PREVIEW_POLL_FAST_TICKS ? PREVIEW_POLL_FAST_MS : PREVIEW_POLL_SLOW_MS;
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

export function translatingTooLong(input: {
  progressStep?: string | null;
  startedAt: number | null;
  now: number;
}): boolean {
  if (input.progressStep !== "translating" || input.startedAt == null) return false;
  return input.now - input.startedAt >= PREVIEW_LONG_WAIT_MS;
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
    progressStep === "done" ||
    progressStep === "translating" ||
    status === "confirmed" ||
    status === "processing" ||
    status === "correction_requested"
  ) {
    return "translating";
  }
  return "received";
}

/**
 * Progress for the preview step. The bar moves through the four steps and
 * reaches 100 only after the order status is `preview_ready`.
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
  if (input.status === "preview_ready") {
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
  const percent = Math.min(PREVIEW_BAR_MAX, STEP_PERCENT[current]);
  return {
    phase: "working",
    percent,
    displayPercent: Math.min(PREVIEW_BAR_MAX, Math.round(percent)),
    label: steps[index]?.label ?? translatingLabel,
    steps: steps.map((step, position) => ({
      ...step,
      state: position < index ? "done" : position === index ? "current" : "pending",
    })),
  };
}
