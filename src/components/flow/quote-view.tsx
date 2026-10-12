"use client";

import Link from "next/link";
import { PAGE_RULE, formatMoney, pageLabel } from "@/lib/flow/pricing";
import { FlowHeader } from "./flow-header";
import { Checks, FlowColumns, Summary, SummaryRow, buttonClasses, fieldClass } from "./ui";
import { useFlowDraft } from "./use-flow-draft";

export function QuoteView() {
  const { draft, quote } = useFlowDraft();

  return (
    <div>
      <FlowHeader current="quote" />
      <main>
        <FlowColumns>
          <div>
            <h1 className="text-[32px] font-bold tracking-[-0.6px]">
              Here’s your exact price.
            </h1>
            <p className="mt-2 mb-6 text-[15px] text-ink-muted">
              We read your files. Check the language and pages, then continue.
              You won’t be charged now.
            </p>
            <div>
              <span className="mb-1.5 block text-[13px] font-semibold">
                Detected language
              </span>
              <div
                data-testid="detected-language"
                className={`${fieldClass} flex items-center justify-between`}
              >
                <span>
                  {draft.sourceLanguage} → {draft.targetLanguage}
                </span>
                <button
                  type="button"
                  className="cursor-pointer text-[13px] font-semibold text-primary"
                >
                  Change
                </button>
              </div>
            </div>
            <div
              data-testid="file-list"
              className="mt-5 overflow-hidden rounded-[var(--cp-radius)] border border-line"
            >
              {quote.files.map((file, index) => (
                <div
                  key={file.id}
                  className={`grid grid-cols-[52px_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3.5 text-sm md:gap-4 ${index > 0 ? "border-t border-line" : ""}`}
                >
                  <div
                    className={`h-[66px] w-[52px] border border-line ${file.kind === "pdf" ? "bg-[#fbf8ef]" : "bg-[#e9e4d6]"}`}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <b className="block break-words">{file.name}</b>
                    <div className="text-[12.5px] text-ink-muted">
                      {file.description} · {file.words} words
                    </div>
                  </div>
                  <span className="whitespace-nowrap">{pageLabel(file.pages)}</span>
                  <b className="whitespace-nowrap">{formatMoney(file.amountCents)}</b>
                </div>
              ))}
            </div>
            <p
              data-testid="page-rule"
              className="mt-3 text-[12.5px] leading-normal text-ink-muted"
            >
              {PAGE_RULE}
            </p>
          </div>
          <div>
            <Summary>
              <SummaryRow
                label={`${quote.pages} pages × ${formatMoney(quote.perPageCents)}`}
                value={formatMoney(quote.subtotalCents)}
              />
              <SummaryRow label="Certification" value="Included" />
              <SummaryRow
                label="Preview"
                value="Free"
                valueClass="font-semibold text-[var(--cp-ok)]"
              />
              <SummaryRow
                testId="quote-total"
                label="Total if you buy"
                value={formatMoney(quote.totalCents)}
                emphasize
              />
            </Summary>
            <Link
              href="/confirm"
              data-testid="continue"
              className={buttonClasses("primary", "mt-4 h-[50px] w-full text-[15px]")}
            >
              Continue
            </Link>
            <div className="mt-[18px]">
              <Checks
                items={[
                  "Pay only after you’ve seen it",
                  "Preview in about 10 minutes",
                  "Free corrections",
                ]}
              />
            </div>
          </div>
        </FlowColumns>
      </main>
    </div>
  );
}
