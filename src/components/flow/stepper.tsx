import type { FlowStep, FlowTrack } from "@/lib/flow/types";

const TRANSLATION_STEPS: { id: FlowStep; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "quote", label: "Quote" },
  { id: "confirm", label: "Confirm" },
  { id: "preview", label: "Preview" },
  { id: "download", label: "Download" },
];

const EVALUATION_STEPS: { id: FlowStep; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "review", label: "Review" },
  { id: "download", label: "Download" },
];

/** Evaluating and Review are one step. Pay happens on Review, after the draft exists. */
function evaluationStepLabel(id: FlowStep, current: FlowStep): string {
  if (id !== "review") return EVALUATION_STEPS.find((step) => step.id === id)?.label ?? id;
  return current === "review" || current === "download" ? "Review" : "Evaluating";
}

function evaluationStepIndex(current: FlowStep): number {
  if (current === "upload") return 0;
  if (current === "download") return 2;
  return 1;
}

const BUNDLE_STEPS: { id: FlowStep; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "preview", label: "Preview" },
  { id: "pay", label: "Pay" },
  { id: "download", label: "Download" },
];

export function Stepper({
  current,
  compact = false,
  track = "translation",
}: {
  current: FlowStep;
  compact?: boolean;
  track?: FlowTrack;
}) {
  const steps = track === "bundle" ? BUNDLE_STEPS : track === "evaluation" ? EVALUATION_STEPS : TRANSLATION_STEPS;
  const currentIndex = track === "evaluation" ? evaluationStepIndex(current) : steps.findIndex((step) => step.id === current);

  return (
    <div
      data-testid="flow-stepper"
      aria-label="Order progress"
      className={
        compact
          ? "flex w-max gap-1.5 text-[12px]"
          : "flex w-max gap-4 text-[13px] md:mx-auto md:gap-7"
      }
    >
      {steps.map((step, index) => {
        const state =
          index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";
        return (
          <span
            key={step.id}
            data-state={state}
            data-step={step.id}
            aria-current={state === "current" ? "step" : undefined}
            className={`inline-flex shrink-0 items-center ${compact ? "gap-1" : "gap-2"} ${state === "upcoming" ? "text-ink-muted" : "text-ink"}`}
          >
            <span
              className={`inline-flex items-center justify-center rounded-full border ${compact ? "size-4 text-[10px]" : "size-5 text-[11px]"} ${
                state === "current"
                  ? "border-primary bg-primary text-white"
                  : state === "done"
                    ? "border-ink bg-ink text-white"
                    : "border-line bg-bg text-ink-muted"
              }`}
              aria-hidden
            >
              {state === "done" ? "✓" : index + 1}
            </span>
            {state === "current" ? (
              <b>{track === "evaluation" ? evaluationStepLabel(step.id, current) : step.label}</b>
            ) : track === "evaluation" ? (
              evaluationStepLabel(step.id, current)
            ) : (
              step.label
            )}
          </span>
        );
      })}
    </div>
  );
}
