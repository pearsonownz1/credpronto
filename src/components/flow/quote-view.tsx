"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useState, type ChangeEvent } from "react";
import { FlowApiError, getFlowClient } from "@/lib/flow/client";
import { formatMoney } from "@/lib/flow/pricing";
import {
  billablePriceLabel,
  canOpenConfirm,
  canSetSourceLanguage,
  isCustomerEvaluation,
  displayedPageRule,
  fileCountLabel,
  languageChoices,
  languageLine,
  quoteFileGroups,
  orderWithTranslationChoice,
  servicePriceLines,
  settleTargetLanguageUpdate,
  showTargetLanguagePicker,
  targetChoices,
  totalLabel,
} from "@/lib/flow/present";
import { rememberDocument } from "@/lib/flow/upload-blobs";
import { sumQuotedBillable } from "@/lib/orders/skip-pages";
import { IMAGE_QUALITY_REASON } from "@/lib/orders/image-quality";
import type { CustomerOrder } from "@/lib/orders/view";
import { FilePreview, inlineSourceUrl, type ViewerPage } from "./file-preview";
import { FlowHeader } from "./flow-header";
import { useReadingHandoff } from "./reading-handoff";
import { ReadingFiles } from "./reading-files";
import { FlowStatus } from "./status";
import { useCustomerOrder, useStoredToken } from "./use-order";
import { Checks, FlowColumns, Summary, SummaryRow, buttonClasses, fieldClass } from "./ui";

export function QuoteView({
  token: pathToken,
  onOrder,
}: {
  token?: string;
  onOrder?: (order: CustomerOrder) => void;
}) {
  const router = useRouter();
  const token = useStoredToken(pathToken);
  const { order, error, loading, reload } = useCustomerOrder(token, "while-working");
  const { covering, reportOrder, endHandoff } = useReadingHandoff();
  const evaluationOrder = order != null && isCustomerEvaluation(order);

  useLayoutEffect(() => {
    if (!covering) return;
    if (order?.status === "draft") reportOrder(order);
    else if (order || (!loading && error)) endHandoff();
  }, [order, loading, error, covering, reportOrder, endHandoff]);

  useEffect(() => {
    if (order) onOrder?.(order);
  }, [order, onOrder]);

  useEffect(() => {
    if (!evaluationOrder || !token) return;
    endHandoff();
    router.replace(`/checkout?token=${encodeURIComponent(token)}`);
  }, [evaluationOrder, token, router, endHandoff]);

  return (
    <div>
      <FlowHeader current={evaluationOrder ? "confirm" : "quote"} track={evaluationOrder ? "evaluation" : "translation"} />
      <main>
        {loading && !order ? (
          covering ? (
            <ReadingFiles status="draft" />
          ) : (
            <FlowStatus title="Reading your files…" body="The price will show here in a moment." />
          )
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
        ) : evaluationOrder ? (
          <FlowStatus title="Opening payment…" body="" />
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
  const choices = languageChoices();
  const targets = targetChoices();
  const picker = canSetSourceLanguage(live);
  const sameLanguage = showTargetLanguagePicker(live);
  const [language, setLanguage] = useState(order.sourceLanguage ?? choices[0]?.code ?? "es");
  const [target, setTarget] = useState(order.targetLanguage || "en");
  const [notice, setNotice] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const sourceCode = picker ? language : (live.sourceLanguage ?? language);
  const targetCode = sameLanguage ? target : live.targetLanguage;
  const line = live.sourceLanguage
    ? languageLine({ sourceLanguage: sourceCode, targetLanguage: targetCode })
    : languageLine(live);
  const qualityHold = live.reviewReason === IMAGE_QUALITY_REASON;
  const evaluation = live.orderType === "evaluation" || live.service != null;
  const showPages = !evaluation || live.includeTranslation;
  const showPrice = !qualityHold;
  const priceLines = showPrice ? quoteSummaryPrices(live) : [];
  const showContinue = canOpenConfirm(live);
  const offerCents = live.translationOfferCents;
  const [translationPending, setTranslationPending] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);

  const files = quoteFileGroups(live).map((group) => {
    const unitsKnown = group.rows.some(
      (row) => typeof row.billableUnits === "number" && Number.isFinite(row.billableUnits),
    );
    if (!unitsKnown) return group;
    return {
      ...group,
      billable: sumQuotedBillable(
        group.rows.map((row) => ({ billableUnits: row.billableUnits, skip: row.skip === true })),
      ),
    };
  });

  async function onToggleTranslation(includeTranslation: boolean) {
    if (translationPending || !live.service || live.degreeCount == null) return;
    const snapshot = live;
    setTranslationError(null);
    setPatch({ source: order, order: orderWithTranslationChoice(snapshot, includeTranslation) });
    setTranslationPending(true);
    try {
      const updated = await getFlowClient().updateQuote(token, { includeTranslation });
      setPatch({ source: order, order: updated });
    } catch (cause) {
      setPatch({ source: order, order: snapshot });
      const failed = cause instanceof FlowApiError ? cause : null;
      setTranslationError(failed?.message ?? "We couldn't update the translation.");
    } finally {
      setTranslationPending(false);
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
              ? evaluation
                ? "We read your files. Check the language, then continue. You won’t be charged now."
                : "We read your files. Check the language and pages, then continue. You won’t be charged now."
              : sameLanguage
                ? "Choose the language you want, then update this quote. You won’t be charged now."
                : evaluation
                  ? "We read your files. Check the language. You won’t be charged now."
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
        <div
          data-testid="file-list"
          className="mt-5 overflow-hidden rounded-[var(--cp-radius)] border border-line"
        >
          {files.map((file, index) => (
              <div
                key={file.id}
                data-testid="file-row"
                className={index > 0 ? "border-t border-line" : undefined}
              >
                <FilePreview
                  token={token}
                  fileId={file.id}
                  filename={file.filename}
                  sourceUrl={inlineSourceUrl(live.documents.find((document) => document.id === file.id))}
                  pages={file.rows.map(
                    (row): ViewerPage => ({
                      skip: row.skip === true,
                      skipReason: row.skipReason,
                      billableUnits: row.billableUnits,
                    }),
                  )}
                  header={
                    <div className="px-4 py-3.5 text-sm">
                      <b className="block min-w-0 break-words">{file.filename}</b>
                      {showPages ? (
                        <div data-testid="file-billable" className="text-[12.5px] text-ink-muted">
                          {file.pages == null ? "—" : fileCountLabel(file.billable)}
                        </div>
                      ) : null}
                    </div>
                  }
                />
              </div>
            ))}
        </div>
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
          ) : evaluation ? (
            <SummaryRow label="Evaluation" value="Pending" />
          ) : (
            <SummaryRow label="Pages" value="Pending" />
          )}
          {evaluation && offerCents != null ? (
            <label className="flex items-start gap-3 border-b border-line px-4 py-3 text-sm">
              <input
                data-testid="include-translation"
                type="checkbox"
                className="mt-1"
                checked={live.includeTranslation}
                disabled={translationPending}
                onChange={(event) => void onToggleTranslation(event.target.checked)}
              />
              <span>
                <span className="font-semibold">Certified translation</span>
                <span className="text-ink-muted"> · {formatMoney(offerCents)}</span>
              </span>
            </label>
          ) : null}
          {translationError ? (
            <p role="alert" data-testid="translation-error" className="px-4 pt-3 text-[13px] text-[var(--cp-warn)]">
              {translationError}
            </p>
          ) : null}
          <SummaryRow label={evaluation ? "Evaluation report" : "Certification"} value="Included" />
          {evaluation ? (
            <SummaryRow label="Review" value="After you pay" />
          ) : (
            <>
              <SummaryRow
                label="Preview"
                value="Free"
                valueClass="font-semibold text-[var(--cp-ok)]"
              />
              <QuoteTurnaround />
            </>
          )}
          <SummaryRow
            testId="quote-total"
            label={qualityHold ? "Price" : "Total if you buy"}
            value={qualityHold ? "Not quoted yet" : totalLabel(live.totalCents)}
            emphasize
          />
        </Summary>
        {evaluation ? null : <BillingNote note={displayedPageRule(live)} />}
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
                {evaluation
                  ? "We’ll confirm the language before you can pay. You don’t need to do anything else right now."
                  : "We’ll confirm the language before the free preview starts. You don’t need to do anything else right now."}
              </p>
            )}
          </>
        )}
        <div className="mt-[18px]">
          <Checks
            items={
              evaluation
                ? ["Pay from this quote", "An evaluator reviews it after you pay", "We'll email you when it's ready"]
                : ["Pay only after you’ve seen it", "Ready in 3 minutes", "Free corrections"]
            }
          />
        </div>
      </div>
    </FlowColumns>
  );
}

function BillingNote({ note }: { note: string }) {
  return (
    <p
      data-testid="page-rule"
      className="mt-3 flex items-start gap-1.5 text-[12.5px] leading-normal text-ink-muted"
    >
      <span title={note} data-testid="billing-info" className="mt-px inline-flex shrink-0" aria-hidden>
        <InfoIcon />
      </span>
      <span>{note}</span>
    </p>
  );
}

function QuoteTurnaround() {
  return (
    <div className="border-t border-line px-3 py-3">
      <div
        data-testid="quote-turnaround"
        className="flex w-full items-center gap-3 rounded-[4px] bg-[#EEF3FF] p-3.5"
      >
        <ClockIcon />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-ink-muted uppercase">
            Turnaround time
          </p>
          <p className="text-[22px] font-bold leading-tight text-primary">3 minutes</p>
        </div>
        <span className="shrink-0 rounded-full bg-[#e8f6f0] px-2 py-0.5 text-[12px] font-semibold text-[var(--cp-ok)]">
          Fast
        </span>
      </div>
    </div>
  );
}

function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0 text-primary">
      <circle cx="7" cy="7" r="5.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 4.1V7.1L9 8.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 6.2V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="7" cy="4.1" r="0.7" fill="currentColor" />
    </svg>
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
      rememberDocument(token, documentId, file);
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
