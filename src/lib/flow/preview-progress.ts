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
  translating: 76,
};

/** The preview exists only when the order status says so. */
export function previewIsReady(status: string | null | undefined): boolean {
  return status === "preview_ready";
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
  if (previewIsReady(input.status)) {
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
    displayPercent: Math.min(99, Math.round(percent)),
    label: steps[index]?.label ?? translatingLabel,
    steps: steps.map((step, position) => ({
      ...step,
      state: position < index ? "done" : position === index ? "current" : "pending",
    })),
  };
}
