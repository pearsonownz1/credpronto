"use client";

import Link from "next/link";
import { useState, type ChangeEvent } from "react";
import { FlowApiError, getFlowClient } from "@/lib/flow/client";
import { formatMoney, pageLabel } from "@/lib/flow/pricing";
import {
  billablePriceLabel,
  canOpenConfirm,
  canSetSourceLanguage,
  displayedPageRule,
  fileCountLabel,
  languageChoices,
  languageLine,
  quoteCounts,
  quoteFileGroups,
  quoteSummaryLabel,
  servicePriceLines,
  settleTargetLanguageUpdate,
  showTargetLanguagePicker,
  skipPageNote,
  skippedPageIndexes,
  targetChoices,
  totalLabel,
  type QuotePageRow,
} from "@/lib/flow/present";
import { sumQuotedBillable } from "@/lib/orders/skip-pages";
import { IMAGE_QUALITY_REASON } from "@/lib/orders/image-quality";
import type { CustomerOrder } from "@/lib/orders/view";
import { FlowHeader } from "./flow-header";
import { ReadingFiles } from "./reading-files";
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
          <ReadingFiles status={order.status} progress={order.progress} />
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

export function QuoteBody({
  order,
  token,
  onReplaced,
}: {
  order: CustomerOrder;
  token: string;
  onReplaced: () => void;
}) {
  const [patch, setPatch] = useState<{ source: CustomerOrder; order: CustomerOrder } | null>(null);
  const live = patch?.source === order ? patch.order : order;
  const [pendingSkip, setPendingSkip] = useState<number[] | null>(null);
  const [skipError, setSkipError] = useState<string | null>(null);
  const [skipPending, setSkipPending] = useState(false);
  const choices = languageChoices();
  const targets = targetChoices();
  const picker = canSetSourceLanguage(live);
  const sameLanguage = showTargetLanguagePicker(live);
  const [language, setLanguage] = useState(order.sourceLanguage ?? choices[0]?.code ?? "es");
  const [target, setTarget] = useState(order.targetLanguage || "en");
  const [notice, setNotice] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({});
  const sourceCode = picker ? language : (live.sourceLanguage ?? language);
  const targetCode = sameLanguage ? target : live.targetLanguage;
  const line = live.sourceLanguage
    ? languageLine({ sourceLanguage: sourceCode, targetLanguage: targetCode })
    : languageLine(live);
  const pages = live.billablePages ?? 0;
  const qualityHold = live.reviewReason === IMAGE_QUALITY_REASON;
  const evaluation = live.orderType === "evaluation";
  const showPrice = !qualityHold;
  const priceLines = showPrice ? quoteSummaryPrices(live) : [];
  const showContinue = canOpenConfirm(live);
  const counts = quoteSummaryLabel(quoteCounts(live));

  function rowSkipped(row: QuotePageRow): boolean {
    if (row.pageIndex == null) return row.skip === true;
    if (pendingSkip) return pendingSkip.includes(row.pageIndex);
    return row.skip === true;
  }

  const files = quoteFileGroups(live).map((group) => {
    if (group.rows.length === 0) return group;
    return {
      ...group,
      billable: sumQuotedBillable(
        group.rows.map((row) => ({ billableUnits: row.billableUnits, skip: rowSkipped(row) })),
      ),
    };
  });

  async function onPageSkip(row: QuotePageRow, skip: boolean) {
    if (row.pageIndex == null || skipPending) return;
    const current = pendingSkip ?? skippedPageIndexes(live);
    const nextIndexes = skip
      ? [...new Set([...current, row.pageIndex])].sort((a, b) => a - b)
      : current.filter((index) => index !== row.pageIndex);
    if (skip === rowSkipped(row)) return;
    setSkipError(null);
    setPendingSkip(nextIndexes);
    setSkipPending(true);
    try {
      const updated = await getFlowClient().updateQuote(token, { skipPages: nextIndexes });
      setPatch({ source: order, order: updated });
      setPendingSkip(null);
    } catch (cause) {
      setPendingSkip(null);
      const failed = cause instanceof FlowApiError ? cause : null;
      if (!failed || (failed.status >= 400 && failed.status < 500)) {
        setSkipError(failed?.message ?? "We couldn't update that page.");
      } else {
        setSkipError(failed.message);
      }
    } finally {
      setSkipPending(false);
    }
  }

  async function onUpdateLanguage() {
    setUpdating(true);
    setNotice(null);
    try {
      await getFlowClient().updateTargetLanguage(token, target);
      const outcome = settleTargetLanguageUpdate(null);
      if (outcome.refetch) onReplaced();
      setNotice(outcome.message);
    } catch (cause) {
      const outcome = settleTargetLanguageUpdate(
        cause instanceof FlowApiError
          ? { status: cause.status, message: cause.message }
          : {
              status: 0,
              message: cause instanceof Error ? cause.message : "We couldn't update the language.",
            },
      );
      setNotice(outcome.message);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <FlowColumns>
      <div>
        <h1 className="text-[32px] font-bold tracking-[-0.6px]">
          {qualityHold ? "We need a clearer photo." : "Here’s your exact price."}
        </h1>
        <p className="mt-2 mb-6 text-[15px] text-ink-muted">
          {qualityHold
            ? "A photo was too hard to read, so this is not a quote yet. Retake it and upload a replacement. A reviewer can also accept the file you already sent."
            : showContinue
              ? "We read your files. Check the language and pages, then continue. You won’t be charged now."
              : sameLanguage
                ? "Choose the language you want, then update this quote. You won’t be charged now."
                : "We read your files. Check the language and pages. You won’t be charged now."}
        </p>
        <div>
          <span className="mb-1.5 block text-[13px] font-semibold">Detected language</span>
          <div
            data-testid="detected-language"
            className={`${fieldClass} flex items-center justify-between gap-3`}
          >
            <span>{line}</span>
            {sameLanguage ? (
              <select
                data-testid="target-language"
                aria-label="Target language"
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value);
                  setNotice(null);
                }}
                className="bg-transparent text-[13px] font-semibold text-primary outline-none"
              >
                {targets.map((choice) => (
                  <option key={choice.code} value={choice.code}>
                    {choice.label}
                  </option>
                ))}
              </select>
            ) : picker ? (
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
        {live.status === "needs_review" ? (
          <p data-testid="review-note" className="mt-3 text-[13px] text-ink-muted">
            {live.reviewReason ??
              "A reviewer will confirm the language before this price is final."}
          </p>
        ) : null}
        <p data-testid="quote-counts" className="mt-5 text-[13px] text-ink-muted">
          {counts}
        </p>
        <div
          data-testid="file-list"
          className="mt-2 overflow-hidden rounded-[var(--cp-radius)] border border-line"
        >
          {files.map((file, index) => {
            const open = openDetails[file.id] === true;
            return (
              <div
                key={file.id}
                data-testid="file-row"
                className={index > 0 ? "border-t border-line" : undefined}
              >
                <div className="grid grid-cols-[52px_minmax(0,1fr)] items-start gap-3 px-4 py-3.5 text-sm md:gap-4">
                  <FileThumb filename={file.filename} />
                  <div className="min-w-0">
                    <b className="block break-words">{file.filename}</b>
                    <div data-testid="file-billable" className="text-[12.5px] text-ink-muted">
                      {file.pages == null ? "—" : fileCountLabel(file.pages, file.billable)}
                    </div>
                    {file.rows.length > 0 ? (
                      <button
                        type="button"
                        data-testid="page-details"
                        aria-expanded={open}
                        onClick={() =>
                          setOpenDetails((current) => ({ ...current, [file.id]: !open }))
                        }
                        className="mt-2 text-[13px] font-semibold text-primary"
                      >
                        Page details
                      </button>
                    ) : null}
                  </div>
                </div>
                {open ? (
                  <div className="space-y-2 px-4 pb-3.5">
                    {file.rows.map((row, pageNumber) => {
                      const skipped = rowSkipped(row);
                      return (
                        <div
                          key={row.key}
                          data-testid="page-row"
                          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]"
                        >
                          <FileThumb filename={file.filename} small />
                          <span className={skipped ? "line-through" : undefined}>
                            Page {pageNumber + 1}
                          </span>
                          {row.pageIndex != null ? (
                            <PageSkipToggle
                              pageIndex={row.pageIndex}
                              skipped={skipped}
                              disabled={skipPending}
                              onChange={(skip) => void onPageSkip(row, skip)}
                            />
                          ) : null}
                          {row.billableUnits != null && row.billableUnits > 1 ? (
                            <span
                              data-testid="billed-as"
                              className="rounded-[var(--cp-radius)] border border-line px-1.5 py-0.5 text-[12px] text-ink-muted"
                            >
                              billed as {row.billableUnits}
                            </span>
                          ) : null}
                          {skipped ? (
                            <span data-testid="skip-note" className="text-ink-muted">
                              {skipPageNote(row.skipReason)}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {skipError ? (
          <p role="alert" data-testid="skip-error" className="mt-2 text-[13px] text-[var(--cp-warn)]">
            {skipError}
          </p>
        ) : null}
        <p data-testid="page-rule" className="mt-3 text-[12.5px] leading-normal text-ink-muted">
          {displayedPageRule(live)}
        </p>
      </div>
      <div>
        <Summary>
          {priceLines.length > 0 ? (
            priceLines.map((line, index) => (
              <SummaryRow
                key={`${line.label}-${index}`}
                label={line.label}
                value={formatMoney(line.amountCents)}
              />
            ))
          ) : (
            <SummaryRow
              label="Pages"
              value={pages > 0 ? pageLabel(pages) : "Pending"}
            />
          )}
          <SummaryRow label="Certification" value="Included" />
          <SummaryRow
            label="Preview"
            value="Free"
            valueClass="font-semibold text-[var(--cp-ok)]"
          />
          <SummaryRow
            testId="quote-total"
            label={qualityHold ? "Price" : "Total if you buy"}
            value={qualityHold ? "Not quoted yet" : totalLabel(live.totalCents)}
            emphasize
          />
        </Summary>
        {qualityHold ? (
          <ImageQuality order={live} token={token} onReplaced={onReplaced} />
        ) : (
          <>
            {sameLanguage ? (
              <button
                type="button"
                data-testid="update-language"
                disabled={updating || !token || target === live.targetLanguage}
                onClick={() => void onUpdateLanguage()}
                className={buttonClasses(
                  showContinue ? "secondary" : "primary",
                  "mt-4 h-[50px] w-full text-[15px] disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                {updating ? "Updating…" : "Update language"}
              </button>
            ) : null}
            {notice ? (
              <p
                data-testid="language-update-note"
                role="status"
                className="mt-4 text-[13.5px] text-ink-muted"
              >
                {notice}
              </p>
            ) : null}
            {showContinue ? (
              <Link
                href={`/confirm?lang=${encodeURIComponent(sourceCode)}&target=${encodeURIComponent(targetCode)}`}
                data-testid="continue"
                className={buttonClasses("primary", "mt-4 h-[50px] w-full text-[15px]")}
              >
                Continue
              </Link>
            ) : sameLanguage ? null : (
              <p className="mt-4 text-[13.5px] text-ink-muted">
                We’ll confirm the language before the free preview starts. You don’t need to do
                anything else right now.
              </p>
            )}
          </>
        )}
        <div className="mt-[18px]">
          <Checks
            items={
              evaluation
                ? ["Pay only after you’ve seen it", "Staff sign off before release", "Free corrections"]
                : ["Pay only after you’ve seen it", "Preview in about 10 minutes", "Free corrections"]
            }
          />
        </div>
      </div>
    </FlowColumns>
  );
}

function FileThumb({ filename, small = false }: { filename: string; small?: boolean }) {
  const pdf = filename.toLowerCase().endsWith(".pdf");
  return (
    <div
      className={`shrink-0 border border-line ${small ? "h-9 w-7" : "h-[66px] w-[52px]"} ${pdf ? "bg-[#fbf8ef]" : "bg-[#e9e4d6]"}`}
      aria-hidden
    />
  );
}

function quoteSummaryPrices(order: CustomerOrder) {
  if (order.lineItems.length === 0 && order.billablePages != null) {
    return [
      {
        label: billablePriceLabel(order.billablePages, order.unitPriceCents),
        amountCents: order.billablePages * order.unitPriceCents,
      },
    ];
  }
  return servicePriceLines(order);
}

function PageSkipToggle({
  pageIndex,
  skipped,
  disabled,
  onChange,
}: {
  pageIndex: number;
  skipped: boolean;
  disabled: boolean;
  onChange: (skip: boolean) => void;
}) {
  const choice = (skip: boolean, label: string) => {
    const selected = skipped === skip;
    return (
      <button
        type="button"
        aria-pressed={selected}
        disabled={disabled || selected}
        onClick={() => onChange(skip)}
        className={`px-2 py-1 disabled:opacity-100 ${selected ? "bg-primary text-white" : "bg-bg text-ink hover:bg-bg-muted"}`}
      >
        {label}
      </button>
    );
  };
  return (
    <span
      data-testid={`page-skip-${pageIndex}`}
      role="group"
      aria-label="Translate or skip this page"
      className={`inline-flex overflow-hidden rounded-[var(--cp-radius)] border border-line text-[12px] font-semibold ${disabled ? "opacity-60" : ""}`}
    >
      {choice(false, "Translate")}
      <span className="w-px bg-line" aria-hidden />
      {choice(true, "Skip")}
    </span>
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
  const groups = new Map<string, string[]>();
  for (const page of order.pages) {
    if (!page.qualityMessage) continue;
    const messages = groups.get(page.documentId) ?? [];
    messages.push(page.qualityMessage);
    groups.set(page.documentId, messages);
  }
  if (groups.size === 0 && order.documents[0]) {
    groups.set(order.documents[0].id, [
      "This photo is hard to read. Retake it in even light, with the whole page in the frame and the text sharp, then upload a replacement.",
    ]);
  }
  const filenames = new Map(order.documents.map((document) => [document.id, document.filename]));

  return (
    <div data-testid="image-quality" className="mt-4 space-y-3">
      {[...groups.entries()].map(([documentId, messages]) => (
        <div key={documentId} className="rounded-[var(--cp-radius)] border border-line px-4 py-3">
          <p className="text-[13px] font-semibold">{filenames.get(documentId) ?? "Photo"}</p>
          {messages.map((message, index) => (
            <p key={`${documentId}-${index}`} className="mt-1 text-[13px] text-ink-muted">
              {message}
            </p>
          ))}
          <ReplacementUpload token={token} documentId={documentId} onReplaced={onReplaced} />
        </div>
      ))}
    </div>
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
        {pending ? "Uploading…" : "Upload a replacement"}
      </label>
      {error ? <p className="mt-2 text-[13px] text-ink-muted">{error}</p> : null}
    </div>
  );
}
