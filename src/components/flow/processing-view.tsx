"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { flowUsesMock, getFlowClient } from "@/lib/flow/client";
import { pageLabel } from "@/lib/flow/pricing";
import { FlowHeader } from "./flow-header";
import { FlowStatus } from "./status";
import { useCustomerOrder, useStoredToken } from "./use-order";
import { buttonClasses } from "./ui";

export function ProcessingView({ token: pathToken }: { token?: string }) {
  const token = useStoredToken(pathToken);
  const router = useRouter();
  const { order, error, loading, reload } = useCustomerOrder(token, "while-working");
  const mock = flowUsesMock();
  const ready = order?.status === "preview_ready";
  const waiting =
    order?.status === "processing" ||
    order?.status === "confirmed" ||
    order?.status === "correction_requested";

  async function openPreview() {
    await getFlowClient().markPreviewReady(token);
    router.push(mock ? "/checkout" : `/preview/${encodeURIComponent(token)}`);
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
              {ready ? "Your preview is ready." : "Translating your documents…"}
            </h1>
            <p className="mt-2.5 mb-8 text-base text-ink-muted">
              {waiting
                ? "Translation is waiting to run. You can leave this page — we'll email you when the preview is ready."
                : "Usually about 10 minutes. We'll email you the moment your preview is ready."}
            </p>
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
                <span className="text-primary">● Translating and laying out</span>
                <span className="font-normal text-ink-muted">
                  {mock ? "~4 min left" : waiting ? "Waiting" : "In progress"}
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
              Need more pages translated?{" "}
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
