"use client";

import Link from "next/link";
import { useState } from "react";
import { formatMoney, pageLabel } from "@/lib/flow/pricing";
import {
  canSetSourceLanguage,
  customerEmail,
  displayedPageRule,
  languageChoices,
  languageLine,
  totalLabel,
} from "@/lib/flow/present";
import type { CustomerOrder } from "@/lib/orders/view";
import { FlowHeader } from "./flow-header";
import { FlowStatus } from "./status";
import { useCustomerOrder, useStoredToken } from "./use-order";
import { Checks, FlowColumns, Summary, SummaryRow, buttonClasses, fieldClass } from "./ui";

export function QuoteView({ token: pathToken }: { token?: string }) {
  const token = useStoredToken(pathToken);
  const { order, error, loading, reload } = useCustomerOrder(token, "while-working");

  return (
    <div>
      <FlowHeader current="quote" />
      <main>
        {loading && !order ? (
          <FlowStatus title="Reading your files…" body="The price will show here in a moment." />
        ) : error && !order ? (
          <FlowStatus
            title="We couldn't load this quote"
            body={error}
            action={
              <button type="button" className={buttonClasses("primary", "h-11 px-5")} onClick={reload}>
                Try again
              </button>
            }
          />
        ) : !order ? (
          <FlowStatus
            title="Upload a document first"
            body="The quote is ready after we read your files."
            action={
              <Link href="/translate" className={buttonClasses("primary", "h-11 px-5")}>
                Upload
              </Link>
            }
          />
        ) : order.status === "draft" ? (
          <FlowStatus
            title="Reading your files…"
            body="This usually takes a minute. You can leave this tab."
          />
        ) : order.status === "failed" ? (
          <FlowStatus
            title="We couldn't read these files"
            body={order.reviewReason ?? "Try the upload again."}
            action={
              <Link href="/translate" className={buttonClasses("primary", "h-11 px-5")}>
                Upload again
              </Link>
            }
          />
        ) : (
          <QuoteBody order={order} />
        )}
      </main>
    </div>
  );
}

function QuoteBody({ order }: { order: CustomerOrder }) {
  const choices = languageChoices();
  const picker = canSetSourceLanguage(order);
  const [language, setLanguage] = useState(order.sourceLanguage ?? choices[0]?.code ?? "es");
  const line = order.sourceLanguage
    ? languageLine({ ...order, sourceLanguage: picker ? language : order.sourceLanguage })
    : languageLine(order);
  const pages = order.billablePages ?? 0;

  return (
    <FlowColumns>
      <div>
        <h1 className="text-[32px] font-bold tracking-[-0.6px]">Here’s your exact price.</h1>
        <p className="mt-2 text-[15px] text-ink-muted">
          We read your files. Check the language and pages, then continue. You won’t be
          charged now.
        </p>
        <p data-testid="order-email" className="mt-2 mb-6 text-[15px] text-ink-muted">
          {customerEmail(order)
            ? `We'll email ${customerEmail(order)} when the preview is ready.`
            : "We'll email you when the preview is ready."}
        </p>
        <div>
          <span className="mb-1.5 block text-[13px] font-semibold">Detected language</span>
          <div
            data-testid="detected-language"
            className={`${fieldClass} flex items-center justify-between gap-3`}
          >
            <span>{line}</span>
            {picker ? (
              <select
                data-testid="language-picker"
                aria-label="Source language"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                className="bg-transparent text-[13px] font-semibold text-primary outline-none"
              >
                {choices.map((choice) => (
                  <option key={choice.code} value={choice.code}>
                    {choice.label}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </div>
        {order.status === "needs_review" ? (
          <p data-testid="review-note" className="mt-3 text-[13px] text-ink-muted">
            {order.reviewReason ??
              "A reviewer will confirm the language before this price is final."}
          </p>
        ) : null}
        <div
          data-testid="file-list"
          className="mt-5 overflow-hidden rounded-[var(--cp-radius)] border border-line"
        >
          {order.documents.map((file, index) => (
            <div
              key={file.id}
              className={`grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 text-sm md:gap-4 ${index > 0 ? "border-t border-line" : ""}`}
            >
              <div
                className={`h-[66px] w-[52px] border border-line ${file.filename.toLowerCase().endsWith(".pdf") ? "bg-[#fbf8ef]" : "bg-[#e9e4d6]"}`}
                aria-hidden
              />
              <div className="min-w-0">
                <b className="block break-words">{file.filename}</b>
                <div className="text-[12.5px] text-ink-muted">
                  {file.detectedLanguage ? languageLine({
                    sourceLanguage: file.detectedLanguage,
                    targetLanguage: order.targetLanguage,
                  }) : "Language not detected"}
                </div>
              </div>
              <span className="whitespace-nowrap">
                {file.pageCount == null ? "—" : pageLabel(file.pageCount)}
              </span>
            </div>
          ))}
        </div>
        <p data-testid="page-rule" className="mt-3 text-[12.5px] leading-normal text-ink-muted">
          {displayedPageRule(order)}
        </p>
      </div>
      <div>
        <Summary>
          <SummaryRow
            label={
              pages > 0
                ? `${pages} pages × ${formatMoney(order.unitPriceCents)}`
                : "Pages"
            }
            value={pages > 0 ? formatMoney(pages * order.unitPriceCents) : "Pending"}
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
            value={totalLabel(order.totalCents)}
            emphasize
          />
        </Summary>
        {order.status === "quoted" ? (
          <Link
            href={`/confirm?lang=${encodeURIComponent(language)}`}
            data-testid="continue"
            className={buttonClasses("primary", "mt-4 h-[50px] w-full text-[15px]")}
          >
            Continue
          </Link>
        ) : (
          <p className="mt-4 text-[13.5px] text-ink-muted">
            We’ll confirm the language before the free preview starts. You don’t need to do
            anything else right now.
          </p>
        )}
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
  );
}
