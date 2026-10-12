import type { FlowStep } from "@/lib/flow/types";

const STEPS: { id: FlowStep; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "quote", label: "Quote" },
  { id: "confirm", label: "Confirm" },
  { id: "preview", label: "Preview" },
  { id: "download", label: "Download" },
];

export function Stepper({ current }: { current: FlowStep }) {
  const currentIndex = STEPS.findIndex((step) => step.id === current);

  return (
    <div
      data-testid="flow-stepper"
      aria-label="Order progress"
      className="flex w-max gap-4 text-[13px] md:mx-auto md:gap-7"
    >
      {STEPS.map((step, index) => {
        const state =
          current === "download" || index < currentIndex
            ? "done"
            : index === currentIndex
              ? "current"
              : "upcoming";
        return (
          <span
            key={step.id}
            data-state={state}
            data-step={step.id}
            aria-current={state === "current" ? "step" : undefined}
            className={`inline-flex shrink-0 items-center gap-2 ${state === "upcoming" ? "text-ink-muted" : "text-ink"}`}
          >
            <span
              className={`inline-flex size-5 items-center justify-center rounded-full border text-[11px] ${
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
