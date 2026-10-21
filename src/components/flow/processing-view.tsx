"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { flowUsesMock, getFlowClient } from "@/lib/flow/client";
import {
  EVALUATION_PROGRESS_REVIEW_DETAIL,
  EVALUATION_PROGRESS_REVIEW_TITLE,
  TRANSLATION_REVIEW_DETAIL,
  TRANSLATION_REVIEW_TITLE,
  previewIsReady,
  previewWork,
} from "@/lib/flow/preview-progress";
import type { CustomerOrder } from "@/lib/orders/view";
import { FlowHeader } from "./flow-header";
import { FlowStatus } from "./status";
import { useCustomerOrder, useStoredToken } from "./use-order";
import { buttonClasses } from "./ui";

export function ProcessingView({
  token: pathToken,
  onOrder,
}: {
  token?: string;
  onOrder?: (order: CustomerOrder) => void;
}) {
  const token = useStoredToken(pathToken);
  const router = useRouter();
  const { order, error, loading, reload } = useCustomerOrder(token, "until-preview");
  const ready = previewIsReady(order);
  const reviewing = order?.status === "needs_review";
  const takingLong = Boolean(order?.delayed) && !ready && !reviewing;
  const easing =
    !ready &&
    !reviewing &&
    (order?.progress?.step === "translating" || order?.progress?.step === "done");
  const translatingElapsed = useTranslatingElapsed(easing);
  useEffect(() => {
    if (order) onOrder?.(order);
  }, [order, onOrder]);
  const evaluation = order?.orderType === "evaluation";
  const work = order
    ? previewWork({
        status: order.status,
        orderType: order.orderType,
        progressStep: order.progress?.step,
        pagesRead: order.progress?.pagesRead,
        pagesTotal: order.progress?.pagesTotal,
        pagesDone: order.progress?.pagesDone,
        pagesTranslateTotal: order.progress?.pagesTranslateTotal,
        translatingElapsedMs: translatingElapsed,
      })
    : null;

  useEffect(() => {
    if (!ready || !token) return;
    let cancelled = false;
    void (async () => {
      if (flowUsesMock()) await getFlowClient().markPreviewReady(token);
      if (!cancelled) router.replace(`/preview/${encodeURIComponent(token)}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, token, router]);

  return (
    <div>
      <FlowHeader current="preview" />
      <main className="mx-auto w-full max-w-[620px] px-4 pt-12 text-center md:pt-20">
        {loading && !order ? (
          <FlowStatus title="Checking your order…" body="" />
        ) : error && !order ? (
          <FlowStatus title="We couldn't load this order" body={error} />
        ) : !order || !work ? (
          <FlowStatus title="No order yet" body="Upload a document to start." />
        ) : ready ? (
          <FlowStatus title="Opening your preview…" body="" />
        ) : work.phase === "review" ? (
          <>
            <p className="preview-kicker blue">Order {order.orderId}</p>
            <h1 className="mt-3 text-[32px] font-bold tracking-[-0.6px] md:text-4xl">
              {evaluation ? EVALUATION_PROGRESS_REVIEW_TITLE : TRANSLATION_REVIEW_TITLE}
            </h1>
            <p data-testid="translation-review" className="mt-2.5 text-base text-ink-muted">
              {evaluation ? EVALUATION_PROGRESS_REVIEW_DETAIL : TRANSLATION_REVIEW_DETAIL}
            </p>
            <p className="mt-6 text-[13.5px] text-ink-muted">
              {evaluation ? "Need another file on this order? " : "Need more pages translated? "}
              <Link href="/translate" data-testid="add-documents" className="font-semibold text-primary">
                Add documents to this order
              </Link>
            </p>
          </>
        ) : (
          <>
            <p className="preview-kicker blue">Order {order.orderId}</p>
            <h1 className="mt-3 text-[32px] font-bold tracking-[-0.6px] md:text-4xl">
              {evaluation ? "Preparing your evaluation" : "Translating your document"}
            </h1>
            <p className={`mt-2.5 text-base text-ink-muted ${takingLong ? "mb-2" : "mb-8"}`}>
              {evaluation
                ? "We'll email you when the report is ready."
                : "Usually ready in 3 minutes. We'll email you when your preview is ready."}
            </p>
            {takingLong ? (
              <p data-testid="translation-delayed" className="mb-8 text-base font-semibold text-ink">
                {"Taking longer than usual, we're on it."}
              </p>
            ) : null}
            <div className="mx-auto w-full max-w-[520px] text-left">
              <div className="mb-2 flex items-baseline justify-between gap-4 text-[13px]">
                <span className="font-medium text-ink" data-testid="preview-label">
                  {work.label}
                </span>
                <span className="shrink-0 font-medium text-ink tabular-nums" data-testid="preview-percent">
                  {work.displayPercent}%
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={work.displayPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuetext={`${work.displayPercent}%`}
                aria-label={work.label}
                data-testid="progress-bar"
                className="h-2 overflow-hidden rounded-[2px] bg-line"
              >
                <div className="h-full bg-primary" style={{ width: `${work.percent}%` }} />
              </div>
              <ol data-testid="preview-steps" className="mt-6 list-none space-y-2.5 p-0">
                {work.steps.map((step) => (
                  <li
                    key={step.id}
                    data-testid={`preview-step-${step.id}`}
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
            <p className="mt-6 text-[13.5px] text-ink-muted">
              {evaluation ? "Need another file on this order? " : "Need more pages translated? "}
              <Link href="/translate" data-testid="add-documents" className="font-semibold text-primary">
                Add documents to this order
              </Link>
            </p>
            {order.status === "failed" ? (
              <button
                type="button"
                onClick={() => void getFlowClient().process(token).then(() => reload())}
                className={buttonClasses("secondary", "mt-4 h-11 px-4")}
              >
                Try again
              </button>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

function useTranslatingElapsed(active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      const reset = window.setTimeout(() => setElapsed(0), 0);
      return () => window.clearTimeout(reset);
    }
    const started = Date.now();
    let timer = 0;
    const tick = () => {
      setElapsed(Date.now() - started);
      timer = window.setTimeout(tick, 400);
    };
    timer = window.setTimeout(tick, 400);
    return () => window.clearTimeout(timer);
  }, [active]);
  return active ? elapsed : 0;
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
