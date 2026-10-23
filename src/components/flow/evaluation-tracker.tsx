"use client";

import { useState } from "react";
import type { EvaluationTracker, EvalStepState } from "@/lib/evalStatus";

/** Same primary button as Buy & download. */
const DOWNLOAD_CLASS =
  "inline-flex h-[52px] w-full shrink-0 items-center justify-center rounded-[var(--cp-radius)] bg-primary text-base font-semibold text-primary-ink disabled:opacity-60";

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function StepMark({ state }: { state: EvalStepState }) {
  if (state === "done") {
    return (
      <span className="flex size-5 items-center justify-center" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M3.2 8.3 6.3 11.4 12.8 4.6"
            stroke="#1F5EFF"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="flex size-5 items-center justify-center" aria-hidden>
        <span className="relative size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#1F5EFF] opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2.5 rounded-full bg-[#1F5EFF]" />
        </span>
      </span>
    );
  }
  return (
    <span className="flex size-5 items-center justify-center" aria-hidden>
      <span className="block size-2.5 rounded-full border-2 border-[#C5CAD3] bg-white" />
    </span>
  );
}

function DownloadEvaluation({
  href,
  onDownload,
}: {
  href?: string | null;
  onDownload?: () => Promise<unknown> | void;
}) {
  const [error, setError] = useState<string | null>(null);
  if (href) {
    return (
      <a data-testid="download-evaluation" href={href} className={`${DOWNLOAD_CLASS} no-underline`}>
        Download evaluation
      </a>
    );
  }
  if (onDownload) {
    return (
      <div>
        <button
          type="button"
          data-testid="download-evaluation"
          className={DOWNLOAD_CLASS}
          onClick={() => {
            setError(null);
            Promise.resolve()
              .then(() => onDownload())
              .catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : "Download isn't ready.");
              });
          }}
        >
          Download evaluation
        </button>
        {error ? <p className="mt-2 text-xs text-[var(--cp-warn)]">{error}</p> : null}
      </div>
    );
  }
  return (
    // TODO: enable when the evaluation file is on the order.
    <button type="button" data-testid="download-evaluation" className={DOWNLOAD_CLASS} disabled>
      Download evaluation
    </button>
  );
}

export function EvaluationStatusColumn({
  orderId,
  view,
  phase = "review",
  downloadHref = null,
  onDownload,
  showOrderId = true,
  allowDownload = true,
}: {
  orderId: string;
  view: EvaluationTracker;
  phase?: "review" | "ready";
  downloadHref?: string | null;
  onDownload?: () => Promise<unknown> | void;
  /** The package page shows the order number once, above this list. */
  showOrderId?: boolean;
  /** The package page uses one Download button, and only when the whole order is ready. */
  allowDownload?: boolean;
}) {
  const offerDownload = allowDownload && view.showDownload;
  return (
    <div data-testid="evaluation-review">
      <div data-testid={showOrderId ? "download-phase" : undefined} data-phase={showOrderId ? phase : undefined}>
        {showOrderId ? <p className="preview-kicker blue text-center">Order {orderId}</p> : null}
        {showOrderId ? <h1 className="sr-only">Evaluation status</h1> : null}
        <ol
        data-testid="evaluation-tracker"
        data-status={view.status}
        aria-label="Evaluation status"
        className={`mx-auto w-full max-w-[440px] text-left ${showOrderId ? "mt-6" : ""}`}
      >
        {view.steps.map((step, index) => {
          const last = index === view.steps.length - 1;
          return (
            <li
              key={step.status}
              data-testid="evaluation-step"
              data-step={step.status}
              data-state={step.state}
              aria-current={step.state === "current" ? "step" : undefined}
              className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3"
            >
              <div className="flex flex-col items-center self-stretch">
                <StepMark state={step.state} />
                {last ? null : (
                  <span
                    className={`mt-1 min-h-6 w-px flex-1 ${step.state === "done" ? "bg-[#1F5EFF]" : "bg-[#E4E7EC]"}`}
                    aria-hidden
                  />
                )}
              </div>
              <div className={last ? "min-w-0" : "min-w-0 pb-6"}>
                <p
                  className={`text-[15px] leading-5 ${step.state === "upcoming" ? "font-medium text-ink-muted" : "font-semibold text-ink"}`}
                >
                  {step.label}
                </p>
                {step.timestamp ? (
                  <time
                    dateTime={step.timestamp}
                    className="mt-1 block text-[13px] text-ink-muted"
                  >
                    {formatTimestamp(step.timestamp)}
                  </time>
                ) : null}
                {step.detail ? (
                  <p data-testid="evaluation-step-detail" className="mt-1 text-sm leading-snug text-ink-muted">
                    {step.detail}
                  </p>
                ) : null}
              </div>
              {last && offerDownload ? (
                <div className="col-span-2 mt-4">
                  <DownloadEvaluation href={downloadHref} onDownload={onDownload} />
                </div>
              ) : null}
            </li>
          );
        })}
        </ol>
      </div>
    </div>
  );
}
