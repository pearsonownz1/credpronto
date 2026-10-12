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

/** One interval for the whole wait. No backoff. */
export const PREVIEW_POLL_MS = 3_000;

/** Translating starts here and eases upward. It does not open at 75. */
export const TRANSLATING_FLOOR = 92;
const TRANSLATING_SPAN = 6;
/** Time constant for the ease from 92 toward 98. */
const TRANSLATING_EASE_MS = 120_000;
const TRANSLATING_CAP = 98;

export type PreviewReadyOrder = {
  status?: string | null;
  /** Customer payload shape from `GET /api/orders/[token]`. */
  progress?: { step?: string | null; pagesRead?: number | null; pagesTotal?: number | null } | null;
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

function pageRatio(pagesRead: number | null | undefined, pagesTotal: number | null | undefined): number {
  if (typeof pagesTotal !== "number" || !Number.isFinite(pagesTotal) || pagesTotal <= 0) return 0;
  if (typeof pagesRead !== "number" || !Number.isFinite(pagesRead) || pagesRead <= 0) return 0;
  return Math.min(1, pagesRead / pagesTotal);
}

/**
 * Ease from 92 toward 98 while `progress.step` stays `translating`
 * and the payload has no unfinished page count. Elapsed time is real
 * time on that step. The value stays under 100 until `done`.
 */
export function translatingEase(elapsedMs: number): number {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const eased = TRANSLATING_SPAN * (1 - Math.exp(-elapsed / TRANSLATING_EASE_MS));
  return Math.min(TRANSLATING_CAP, TRANSLATING_FLOOR + eased);
}

/**
 * Translating percent. Unfinished `pagesRead` / `pagesTotal` is the
 * sub-progress and moves the bar from 92 toward 98. A full page count is
 * the quote, not translation progress, so that case eases with real time.
 * This never returns 75.
 */
export function translatingPercent(input: {
  pagesRead?: number | null;
  pagesTotal?: number | null;
  translatingElapsedMs?: number;
}): number {
  const total = input.pagesTotal;
  const read = input.pagesRead;
  if (
    typeof total === "number" &&
    Number.isFinite(total) &&
    total > 0 &&
    typeof read === "number" &&
    Number.isFinite(read) &&
    read >= 0 &&
    read < total
  ) {
    return TRANSLATING_FLOOR + TRANSLATING_SPAN * (read / total);
  }
  return translatingEase(input.translatingElapsedMs ?? 0);
}

/**
 * Bar percent from `progress.step`, `pagesRead`, and `pagesTotal`.
 * uploaded 5, reading 5–60, language 70, counting 80, quoting 90,
 * translating ~92, done 100.
 */
export function previewStepPercent(input: {
  progressStep?: string | null;
  pagesRead?: number | null;
  pagesTotal?: number | null;
  translatingElapsedMs?: number;
}): number {
  switch (input.progressStep) {
    case "uploaded":
      return 5;
    case "reading":
      return 5 + 55 * pageRatio(input.pagesRead, input.pagesTotal);
    case "language":
      return 70;
    case "counting":
      return 80;
    case "quoting":
      return 90;
    case "translating":
      return translatingPercent(input);
    case "done":
      return 100;
    default:
      return 5;
  }
}

function currentStep(progressStep: string | null | undefined): Exclude<PreviewWorkStepId, "ready"> {
  if (
    progressStep === "reading" ||
    progressStep === "language" ||
    progressStep === "counting" ||
    progressStep === "quoting"
  ) {
    return "read";
  }
  if (progressStep === "translating" || progressStep === "done") return "translating";
  return "received";
}

/**
 * Progress for the preview step. The bar follows the API `progress` fields and
 * reaches 100 only once the preview is ready (`preview_ready` or step `done`).
 */
export function previewWork(input: {
  status: string;
  orderType?: string | null;
  progressStep?: string | null;
  pagesRead?: number | null;
  pagesTotal?: number | null;
  translatingElapsedMs?: number;
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

  const current = currentStep(input.progressStep);
  const index = steps.findIndex((step) => step.id === current);
  const percent =
    input.progressStep === "done" ? translatingPercent(input) : previewStepPercent(input);
  return {
    phase: "working",
    percent,
    displayPercent: Math.round(percent),
    label: steps[index]?.label ?? translatingLabel,
    steps: steps.map((step, position) => ({
      ...step,
      state: position < index ? "done" : position === index ? "current" : "pending",
    })),
  };
}
