export type PreEvaluationStepId = "read" | "compare" | "prepare";

export type StepState = "done" | "current" | "pending";

export type PreEvaluationProgress = {
  /** Bar width, 0–100. Stays under 100 while the preview is still running. */
  percent: number;
  displayPercent: number;
  label: string;
  steps: Array<{ id: PreEvaluationStepId; label: string; state: StepState }>;
};

const STEPS: Array<{ id: PreEvaluationStepId; label: string }> = [
  { id: "read", label: "Reading the document" },
  { id: "compare", label: "Comparing the credential" },
  { id: "prepare", label: "Preparing your preview" },
];

/** Time constant so about a minute of waiting sits in the high 80s, still short of done. */
const EASE_MS = 28_000;
const CAP = 92;

export function preEvaluationProgress(elapsedMs: number): PreEvaluationProgress {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const percent = Math.min(CAP, 100 * (1 - Math.exp(-elapsed / EASE_MS)));
  const displayPercent = Math.min(91, Math.round(percent));
  const current: PreEvaluationStepId = percent >= 70 ? "prepare" : percent >= 35 ? "compare" : "read";
  const index = STEPS.findIndex((step) => step.id === current);
  return {
    percent,
    displayPercent,
    label: STEPS[index]?.label ?? "Reading the document",
    steps: STEPS.map((step, position) => ({
      id: step.id,
      label: step.label,
      state: position < index ? "done" : position === index ? "current" : "pending",
    })),
  };
}
