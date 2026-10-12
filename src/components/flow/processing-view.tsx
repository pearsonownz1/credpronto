"use client";

import Link from "next/link";
import { PROCESSING_PERCENT } from "@/lib/flow/mock-data";
import { pageLabel } from "@/lib/flow/pricing";
import { FlowHeader } from "./flow-header";
import { useFlowDraft } from "./use-flow-draft";

export function ProcessingView() {
  const { draft, quote } = useFlowDraft();

  return (
    <div>
      <FlowHeader current="preview" />
      <main className="mx-auto w-full max-w-[620px] px-4 pt-12 text-center md:pt-20">
        <p className="preview-kicker blue">Order {draft.orderId}</p>
        <h1 className="mt-3 text-[32px] font-bold tracking-[-0.6px] md:text-4xl">
          Translating your documents…
        </h1>
        <p className="mt-2.5 mb-8 text-base text-ink-muted">
          Usually about 10 minutes. We’ll email you the moment your preview is
          ready.
        </p>
        <div
          role="progressbar"
          aria-valuenow={PROCESSING_PERCENT}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Translation progress"
          data-testid="progress-bar"
          className="h-1.5 overflow-hidden rounded-full bg-bg-muted"
        >
          <div
            className="h-full bg-primary"
            style={{ width: `${PROCESSING_PERCENT}%` }}
          />
        </div>
        <div className="mt-7 overflow-hidden rounded-[var(--cp-radius)] border border-line text-left text-[14.5px]">
          <div className="flex items-center justify-between gap-4 px-[18px] py-3.5">
            <span>✓ Files received</span>
            <span className="text-ink-muted">{pageLabel(quote.pages)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-line px-[18px] py-3.5">
            <span>✓ Text read from scans</span>
            <span className="text-ink-muted">{quote.wordCount} words</span>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-line px-[18px] py-3.5 font-semibold">
            <span className="text-primary">● Translating and laying out</span>
            <span className="font-normal text-ink-muted">~4 min left</span>
          </div>
          <Link
            href="/checkout"
            data-testid="preview-ready"
            className="flex items-center justify-between gap-4 border-t border-line px-[18px] py-3.5 text-ink-muted hover:text-ink"
          >
            <span>○ Preview ready</span>
          </Link>
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
      </main>
    </div>
  );
}
