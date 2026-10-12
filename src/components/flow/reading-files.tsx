"use client";

import { useEffect, useState } from "react";
import { readOrderProgress, readingPresentation } from "@/lib/orders/reading-progress";

function useElapsed(active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const tick = () => setElapsed(Date.now() - started);
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [active]);
  return elapsed;
}

export function ReadingFiles({
  status,
  progress,
}: {
  status: string;
  progress?: unknown;
}) {
  const live = readOrderProgress(progress) != null;
  const elapsed = useElapsed(!live && status !== "quoted");
  const view = readingPresentation({ progress, status, elapsedMs: elapsed });

  return (
    <div data-testid="reading-files" className="mx-auto w-full max-w-[620px] px-4 py-16 text-center">
      <h1 className="mt-3 text-[32px] font-bold tracking-[-0.6px]">Reading your files…</h1>
      <p className="mt-3 text-base text-ink-muted">This usually takes a minute. You can leave this tab.</p>
      <div className="mx-auto mt-8 w-full max-w-[520px] text-left">
        <div className="mb-2 flex items-baseline justify-between gap-4 text-[13px]">
          <span className="font-medium text-ink" data-testid="reading-label">
            {view.label}
          </span>
          <span className="shrink-0 font-medium text-ink tabular-nums" data-testid="reading-percent">
            {view.displayPercent}%
          </span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-[2px] bg-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.displayPercent}
          aria-valuetext={`${view.displayPercent}%`}
          aria-label={view.label}
          data-testid="reading-progress"
        >
          <div className="reading-fill relative h-full overflow-hidden bg-primary" style={{ width: `${view.percent}%` }}>
            <span className="reading-shine pointer-events-none absolute inset-0 motion-reduce:hidden" aria-hidden />
          </div>
        </div>
        <ol data-testid="reading-steps" className="mt-6 list-none space-y-2.5 p-0">
          {view.steps.map((step) => (
            <li
              key={step.id}
              data-testid={`reading-step-${step.id}`}
              data-state={step.state}
              aria-current={step.state === "current" ? "step" : undefined}
              className={`flex items-center gap-3 text-[14px] leading-5 ${
                step.state === "pending" ? "text-ink-muted" : "text-ink"
              } ${step.state === "current" ? "font-medium" : ""}`}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                <StepMark state={step.state} />
              </span>
              {step.label}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function StepMark({ state }: { state: "done" | "current" | "pending" }) {
  if (state === "done") {
    return (
      <svg viewBox="0 0 16 16" className="h-4 w-4 text-primary" aria-hidden>
        <path
          d="M3.2 8.4 6.4 11.4 12.8 4.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (state === "current") {
    return <span className="reading-spinner block h-3.5 w-3.5 rounded-full" aria-hidden />;
  }
  return <span className="block h-2 w-2 rounded-full bg-[#c5cbd6]" aria-hidden />;
}
