"use client";

import Link from "next/link";
import { useState, type ChangeEvent } from "react";
import { FlowApiError, getFlowClient } from "@/lib/flow/client";
import { formatMoney, pageLabel } from "@/lib/flow/pricing";
import {
  RETAKE_FLAG_LABEL,
  canSetSourceLanguage,
  customerEmail,
  displayedPageRule,
  languageChoices,
  languageLine,
  retakeDocumentIds,
  retakeInstructions,
  retakePages,
  totalLabel,
} from "@/lib/flow/present";
import { IMAGE_QUALITY_REASON } from "@/lib/orders/image-quality";
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
          <QuoteBody order={order} token={token} onReplaced={reload} />
        )}
      </main>
    </div>
  );
}

function QuoteBody({
  order,
  token,
  onReplaced,
}: {
  order: CustomerOrder;
  token: string;
  onReplaced: () => void;
}) {
  const choices = languageChoices();
  const picker = canSetSourceLanguage(order);
  const [language, setLanguage] = useState(order.sourceLanguage ?? choices[0]?.code ?? "es");
  const line = order.sourceLanguage
    ? languageLine({ ...order, sourceLanguage: picker ? language : order.sourceLanguage })
    : languageLine(order);
  const pages = order.billablePages ?? 0;
  const qualityHold = order.reviewReason === IMAGE_QUALITY_REASON;
  const orderedPages = order.pageOrder && order.pageOrder.pages.length > 1 ? order.pageOrder : null;
  const showPrice = !qualityHold;

  return (
    <FlowColumns>
      <div className="min-w-0">
        <h1 className="text-[32px] font-bold tracking-[-0.6px]">
          {qualityHold ? "We need a clearer photo." : "Here’s your exact price."}
        </h1>
        <p className="mt-2 text-[15px] text-ink-muted">
          {qualityHold
            ? "A photo was too hard to read, so this is not a quote yet. Retake it and upload a replacement. A reviewer can also accept the file you already sent."
            : "We read your files. Check the language and pages, then continue. You won’t be charged now."}
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
        {order.status === "needs_review" && !qualityHold ? (
          <p data-testid="review-note" className="mt-3 text-[13px] text-ink-muted">
            {order.reviewReason ??
              "A reviewer will confirm the language before this price is final."}
          </p>
        ) : null}
        {qualityHold ? (
          <ImageQuality order={order} token={token} onReplaced={onReplaced} />
        ) : (
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
        )}
        {orderedPages && !qualityHold ? (
          <div data-testid="page-order" className="mt-4">
            <p data-testid="page-order-basis" className="text-[13px] text-ink-muted">
              {orderedPages.basis === "logical"
                ? "We ordered these pages from the printed page numbers."
                : "We kept the order you uploaded them."}
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px]">
              {orderedPages.pages.map((page) => (
                <li key={`${page.documentId}-${page.uploadPage}-${page.appliedPage}`}>
                  <span className="font-semibold">{page.filename || "Page"}</span>
                  {page.logicalPage != null ? ` · printed page ${page.logicalPage}` : ""}
                  {page.hint ? ` · ${page.hint}` : ""}
                  {page.uploadPosition !== page.appliedPosition || page.uploadPage !== page.appliedPage
                    ? " · moved from the upload order"
                    : ""}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        <p data-testid="page-rule" className="mt-3 text-[12.5px] leading-normal text-ink-muted">
          {displayedPageRule(order)}
        </p>
      </div>
      <div className="min-w-0">
        <Summary>
          <SummaryRow
            label={
              showPrice && pages > 0
                ? `${pages} pages × ${formatMoney(order.unitPriceCents)}`
                : "Pages"
            }
            value={
              showPrice && pages > 0
                ? formatMoney(pages * order.unitPriceCents)
                : pages > 0
                  ? pageLabel(pages)
                  : "Pending"
            }
          />
          <SummaryRow label="Certification" value="Included" />
          <SummaryRow
            label="Preview"
            value="Free"
            valueClass="font-semibold text-[var(--cp-ok)]"
          />
          <SummaryRow
            testId="quote-total"
            label={qualityHold ? "Price" : "Total if you buy"}
            value={qualityHold ? "Not quoted yet" : totalLabel(order.totalCents)}
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
        ) : qualityHold ? null : (
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

function ImageQuality({
  order,
  token,
  onReplaced,
}: {
  order: CustomerOrder;
  token: string;
  onReplaced: () => void;
}) {
  const pages = retakePages(order);
  const instructions = retakeInstructions(pages);
  const uploads = retakeDocumentIds(pages);
  const filenames = new Map(order.documents.map((document) => [document.id, document.filename]));
  const basis = order.pageOrder?.basis;

  return (
    <section
      data-testid="image-quality"
      className="mt-5 rounded-[var(--cp-radius)] border border-line bg-bg px-4 py-4"
    >
      <div data-testid="retake-instructions" className="space-y-2 text-[13px] leading-normal text-ink-muted">
        {instructions.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>
      <div data-testid="page-order" className="mt-4">
        {basis ? (
          <p data-testid="page-order-basis" className="text-[13px] text-ink-muted">
            {basis === "logical"
              ? "We ordered these pages from the printed page numbers."
              : "We kept the order you uploaded them."}
          </p>
        ) : null}
        <ol className="mt-3 space-y-3">
          {pages.map((page, index) => (
            <li key={page.key} data-testid="retake-page" className="flex items-start gap-3">
              <div
                className="flex min-h-[108px] w-[92px] shrink-0 flex-col justify-between border border-line bg-[#fbf8ef] p-1.5"
              >
                <span className="font-mono text-[10px] text-ink-muted">{index + 1}</span>
                {page.flags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {page.flags.map((flag) => (
                      <span
                        key={flag}
                        data-testid={`quality-flag-${flag}`}
                        className="rounded-full bg-bg px-1.5 py-0.5 text-[10px] leading-tight font-semibold text-[var(--cp-warn)] ring-1 ring-[var(--cp-warn)]/40"
                      >
                        {RETAKE_FLAG_LABEL[flag]}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="min-w-0 pt-1">
                <b className="block break-words text-sm">{page.filename}</b>
                {page.detail ? (
                  <p className="mt-1 text-[12.5px] text-ink-muted">{page.detail}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-4 space-y-3">
        {uploads.map((documentId) => (
          <div key={documentId}>
            {uploads.length > 1 ? (
              <p className="mb-1.5 text-[13px] font-semibold">
                {filenames.get(documentId) ??
                  pages.find((page) => page.documentId === documentId)?.filename ??
                  "Photo"}
              </p>
            ) : null}
            <ReplacementUpload token={token} documentId={documentId} onReplaced={onReplaced} />
          </div>
        ))}
      </div>
    </section>
  );
}

function ReplacementUpload({
  token,
  documentId,
  onReplaced,
}: {
  token: string;
  documentId: string;
  onReplaced: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPending(true);
    setError(null);
    try {
      await getFlowClient().replaceDocument(token, documentId, file);
      onReplaced();
    } catch (cause) {
      setError(cause instanceof FlowApiError ? cause.message : "We couldn't upload that replacement.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3">
      <label className={buttonClasses("secondary", "h-10 cursor-pointer px-3 text-[13px]")}>
        <input
          type="file"
          className="sr-only"
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
          data-testid={`replace-${documentId}`}
          disabled={pending || !token}
          onChange={(event) => void onChange(event)}
        />
        {pending ? "Uploading…" : "Upload a clearer photo"}
      </label>
      {error ? <p className="mt-2 text-[13px] text-ink-muted">{error}</p> : null}
    </div>
  );
}
