"use client";

import Link from "next/link";
import { getFlowClient } from "@/lib/flow/client";
import { DOWNLOADS, sampleDraft } from "@/lib/flow/mock-data";
import { formatMoney } from "@/lib/flow/pricing";
import { FlowHeader } from "./flow-header";
import { buttonClasses } from "./ui";
import { useFlowDraft } from "./use-flow-draft";

export function DownloadView() {
  const { draft, quote } = useFlowDraft();

  return (
    <div>
      <FlowHeader current="download" />
      <main className="mx-auto w-full max-w-[640px] px-4 pt-10 md:pt-16">
        <div className="flex size-12 items-center justify-center rounded-full bg-[#e8f6f0] text-2xl font-bold text-[var(--cp-ok)]">
          ✓
        </div>
        <h1 className="mt-5 text-[32px] font-bold tracking-[-0.6px] md:text-4xl">
          Your certified translation is ready.
        </h1>
        <p data-testid="email-note" className="mt-2.5 mb-7 text-base text-ink-muted">
          Paid {formatMoney(quote.totalCents)} · Order {draft.orderId}. A copy
          is on its way to {draft.email}.
        </p>
        <div className="overflow-hidden rounded-[var(--cp-radius)] border border-line">
          <div className="flex flex-col gap-3 px-[18px] py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <b>Certified translation</b>
              <div className="text-[13px] text-ink-muted">
                {DOWNLOADS.certified.filename} · {DOWNLOADS.certified.detail}
              </div>
            </div>
            <a
              data-testid="download-certified"
              href={DOWNLOADS.certified.href}
              download={DOWNLOADS.certified.filename}
              className={buttonClasses("primary", "h-10 shrink-0 px-[18px] text-[15px]")}
            >
              Download PDF
            </a>
          </div>
          <div className="flex flex-col gap-3 border-t border-line px-[18px] py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <b>Original</b>
              <div className="text-[13px] text-ink-muted">
                {DOWNLOADS.original.filename}
              </div>
            </div>
            <a
              data-testid="download-original"
              href={DOWNLOADS.original.href}
              download={DOWNLOADS.original.filename}
              className={buttonClasses(
                "secondary",
                "h-10 shrink-0 px-[18px] text-[15px]",
              )}
            >
              Download
            </a>
          </div>
        </div>
        <p className="mt-5 text-[13.5px] leading-relaxed text-ink-muted">
          Bookmark this page or use the link in your email to come back. Need
          another document translated?{" "}
          <Link
            href="/translate"
            className="font-semibold text-primary"
            onClick={() => getFlowClient().save(sampleDraft())}
          >
            Start a new order
          </Link>
        </p>
      </main>
    </div>
  );
}
