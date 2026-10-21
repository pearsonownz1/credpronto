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
  { id: "confirm", label: "Pay" },
  { id: "review", label: "Review" },
  { id: "download", label: "Download" },
];

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
  const currentIndex = steps.findIndex((step) => step.id === current);

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
            {state === "current" ? <b>{step.label}</b> : step.label}
          </span>
        );
      })}
    </div>
  );
}
