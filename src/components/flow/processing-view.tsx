"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { flowUsesMock, getFlowClient } from "@/lib/flow/client";
import { pageLabel } from "@/lib/flow/pricing";
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
  const { order, error, loading, reload } = useCustomerOrder(token, "while-working");
  useEffect(() => {
    if (order) onOrder?.(order);
  }, [order, onOrder]);
  const mock = flowUsesMock();
  const evaluation = order?.orderType === "evaluation";
  const ready = order?.status === "preview_ready";
  const waiting =
    order?.status === "processing" ||
    order?.status === "confirmed" ||
    order?.status === "correction_requested";

  async function openPreview() {
    await getFlowClient().markPreviewReady(token);
    const showReport = !mock || order?.orderType === "evaluation";
    router.push(showReport ? `/preview/${encodeURIComponent(token)}` : "/checkout");
  }

  return (
    <div>
      <FlowHeader current="preview" />
      <main className="mx-auto w-full max-w-[620px] px-4 pt-12 text-center md:pt-20">
        {loading && !order ? (
          <FlowStatus title="Checking your order…" body="" />
        ) : error && !order ? (
          <FlowStatus title="We couldn't load this order" body={error} />
        ) : !order ? (
          <FlowStatus title="No order yet" body="Upload a document to start." />
        ) : (
          <>
            <p className="preview-kicker blue">Order {order.orderId}</p>
            <h1 className="mt-3 text-[32px] font-bold tracking-[-0.6px] md:text-4xl">
              {ready
                ? "Your preview is ready."
                : evaluation
                  ? "Preparing your evaluation…"
                  : "Translating your documents…"}
            </h1>
            <p className={`mt-2.5 text-base text-ink-muted ${order.delayed ? "mb-2" : "mb-8"}`}>
              {evaluation
                ? "We'll email you when the watermarked report is ready to review."
                : waiting
                  ? "Translation is waiting to run. You can leave this page — we'll email you when the preview is ready."
                  : "Usually about 10 minutes. We'll email you the moment your preview is ready."}
            </p>
            {order.delayed ? (
              <p data-testid="translation-delayed" className="mb-8 text-base font-semibold text-ink">
                {"Taking longer than usual, we're on it."}
              </p>
            ) : null}
            {waiting ? (
              <p data-testid="translation-wait" className="mb-6 text-sm text-ink-muted">
                The translation step can sit here until it is able to run. This page keeps
                checking.
              </p>
            ) : null}
            <div
              role="progressbar"
              aria-valuenow={ready ? 100 : mock ? 62 : 40}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Translation progress"
              data-testid="progress-bar"
              className="h-1.5 overflow-hidden rounded-full bg-bg-muted"
            >
              <div
                className="h-full bg-primary"
                style={{ width: ready ? "100%" : mock ? "62%" : "40%" }}
              />
            </div>
            <div className="mt-7 overflow-hidden rounded-[var(--cp-radius)] border border-line text-left text-[14.5px]">
              <div className="flex items-center justify-between gap-4 px-[18px] py-3.5">
                <span>✓ Files received</span>
                <span className="text-ink-muted">
                  {pageLabel(order.documents.reduce((sum, file) => sum + (file.pageCount ?? 0), 0) || order.billablePages || 0)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-line px-[18px] py-3.5">
                <span>✓ Text read from scans</span>
                <span className="text-ink-muted">
                  {mock ? "278 words" : pageLabel(order.billablePages ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-line px-[18px] py-3.5 font-semibold">
                <span className="text-primary">
                  {evaluation ? "● Building the report" : "● Translating and laying out"}
                </span>
                <span className="font-normal text-ink-muted">
                  {evaluation ? "In progress" : mock ? "~4 min left" : waiting ? "Waiting" : "In progress"}
                </span>
              </div>
              {ready || mock ? (
                <button
                  type="button"
                  data-testid="preview-ready"
                  onClick={() => void openPreview()}
                  className="flex w-full items-center justify-between gap-4 border-t border-line px-[18px] py-3.5 text-left text-ink-muted hover:text-ink"
                >
                  <span>○ Preview ready</span>
                </button>
              ) : (
                <div className="flex items-center justify-between gap-4 border-t border-line px-[18px] py-3.5 text-ink-muted">
                  <span>○ Preview ready</span>
                </div>
              )}
            </div>
            <p className="mt-6 text-[13.5px] text-ink-muted">
              {evaluation ? "Need another file on this order? " : "Need more pages translated? "}
              <Link
                href="/translate"
                data-testid="add-documents"
                className="font-semibold text-primary"
              >
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
