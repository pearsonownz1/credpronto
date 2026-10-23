"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { flowUsesMock, getFlowClient } from "@/lib/flow/client";
import {
  CONFIRMING_PAYMENT_COPY,
  CONFIRMING_PAYMENT_DETAIL,
  CLOSE_PAGE_NOTE,
  ORDERS_DASHBOARD_HREF,
  QUICK_CHECK_COPY,
  RELEASE_PROGRESS_STEPS,
  downloadEmailedLine,
  downloadPhase,
  downloadReadyCopy,
  isCustomerEvaluation,
  isTranslationBundle,
  paidReceiptLine,
  paidReviewEmailLine,
  totalLabel,
  type DownloadFileKind,
} from "@/lib/flow/present";
import { evaluationDownloadReady, evaluationTracker } from "@/lib/evalStatus";
import { deliveryDocumentName, orderDownloadFilename } from "@/lib/orders/download-name";
import { evaluationSpeedLine } from "@/lib/orders/speed-line";
import type { CustomerOrder } from "@/lib/orders/view";
import { EvaluationStatusColumn } from "./evaluation-tracker";
import { FlowHeader } from "./flow-header";
import { PaidPreview } from "./paid-preview";
import { FlowStatus } from "./status";
import { useCustomerOrder, useStoredEmail, useStoredToken } from "./use-order";
import { buttonClasses } from "./ui";

const MOCK_HREF = "/samples/birth-certificate-en.pdf";

export function DownloadStates({
  token: pathToken,
  pendingPayment = false,
  onOrder,
}: {
  token?: string;
  /** Stripe success return. Keep checking until the webhook records the order. */
  pendingPayment?: boolean;
  onOrder?: (order: CustomerOrder) => void;
}) {
  const token = useStoredToken(pathToken);
  const storedEmail = useStoredEmail();
  const { order, error, loading } = useCustomerOrder(token, pendingPayment ? "checkout" : "until-download");
  const phase = order ? downloadPhase(order) : "finalizing";
  const email = order?.email?.trim() || storedEmail;
  const confirming = pendingPayment ? phase !== "certifying" && phase !== "ready" : phase === "finalizing" && order != null;
  const onDownloadStep = confirming || phase === "certifying" || phase === "ready";
  const bundle = order != null && isTranslationBundle(order);
  const evaluation = order != null && isCustomerEvaluation(order);
  const showEvalTracker =
    order != null &&
    evaluation &&
    !confirming &&
    (phase === "certifying" || (phase === "ready" && order.evaluationStatus === "evaluation_complete"));
  const headerStep = bundle
    ? onDownloadStep
      ? "download"
      : "pay"
    : evaluation
      ? phase === "ready"
        ? "download"
        : phase === "certifying"
          ? "review"
          : "confirm"
      : onDownloadStep
        ? "download"
        : "preview";

  useEffect(() => {
    if (order) onOrder?.(order);
  }, [order, onOrder]);

  return (
    <div>
      <FlowHeader
        current={headerStep}
        track={bundle ? "bundle" : evaluation ? "evaluation" : "translation"}
      />
      <main
        className={
          phase === "certifying" && !evaluation
            ? "mx-auto w-full max-w-6xl px-4 pt-10 pb-16"
            : "mx-auto w-full max-w-[640px] px-4 pt-10 md:pt-16"
        }
      >
        {confirming ? (
          <FlowStatus
            testId="download-phase"
            phase="confirming"
            kicker={order ? `Order ${order.orderId}` : undefined}
            title={CONFIRMING_PAYMENT_COPY}
            body={CONFIRMING_PAYMENT_DETAIL}
          />
        ) : loading && !order ? (
          <FlowStatus title="Loading your order…" body="" />
        ) : error && !order ? (
          <FlowStatus title="We couldn't load this order" body={error} />
        ) : !order ? (
          <FlowStatus title="No order yet" body="Start a translation to get a download." />
        ) : showEvalTracker && order ? (
          <>
            {bundle && order.translationReady ? <BundleTranslation order={order} token={token} /> : null}
            <EvaluationReview order={order} token={token} phase={phase === "ready" ? "ready" : "review"} />
          </>
        ) : phase === "certifying" ? (
          <Certifying order={order} token={token} email={email} />
        ) : (
          <Ready order={order} token={token} email={email} />
        )}
      </main>
    </div>
  );
}

function BundleTranslation({ order, token }: { order: CustomerOrder; token: string }) {
  const names = order.documents.map((document) => document.filename);
  const named = deliveryDocumentName({ documentNames: names });
  return (
    <div data-testid="bundle-translation" className="mb-10">
      <p data-testid="email-note" className="mb-4 text-base text-ink-muted">
        Paid {totalLabel(order.totalCents)} · Order {order.orderId}.
      </p>
      <div className="overflow-hidden rounded-[var(--cp-radius)] border border-line">
        <FileRow
          token={token}
          file="translation"
          title={order.documentTitle || named.title}
          subtitle="Certified translation · PDF"
          testId="download-certified"
          primary
        />
      </div>
    </div>
  );
}

function EvaluationReview({
  order,
  token,
  phase,
}: {
  order: CustomerOrder;
  token: string;
  phase: "review" | "ready";
}) {
  const view = evaluationTracker({
    evaluationStatus: order.evaluationStatus,
    evaluationStatusAt: order.evaluationStatusAt,
  });
  const ready = view.showDownload && evaluationDownloadReady(order);
  return (
    <div className="pb-16">
      <EvaluationStatusColumn
        orderId={order.orderId}
        view={view}
        phase={phase}
        downloadHref={ready && flowUsesMock() ? MOCK_HREF : null}
        onDownload={
          ready && !flowUsesMock()
            ? () =>
                getFlowClient()
                  .download(token, "evaluation")
                  .then((result) => {
                    window.location.assign(result.url);
                  })
            : undefined
        }
      />
    </div>
  );
}

function Certifying({
  order,
  token,
  email,
}: {
  order: CustomerOrder;
  token: string;
  email: string;
}) {
  return (
    <PaidReviewBody
      orderId={order.orderId}
      email={email}
      totalCents={order.totalCents}
      paidAt={order.paidAt}
      preview={<PaidPreview token={token} order={order} />}
    />
  );
}

/** Paid translation held for final review. `preview` is the read-only viewer for that order. */
export function PaidReviewBody({
  orderId,
  email,
  totalCents,
  paidAt,
  preview,
}: {
  orderId: string;
  email: string | null;
  totalCents: number | null;
  paidAt: string | null;
  preview: ReactNode;
}) {
  return (
    <>
      <div data-testid="download-phase" data-phase="review" className="mx-auto w-full max-w-[720px] text-center">
        <p className="preview-kicker blue">Order {orderId}</p>
        <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-[-0.5px] md:text-[32px]">
          {QUICK_CHECK_COPY}
        </h1>
        <p data-testid="email-note" className="mt-3 text-base text-ink-muted">
          {paidReviewEmailLine(email)}
        </p>
        <p data-testid="paid-receipt" className="mt-3 text-base text-ink">
          {paidReceiptLine({ totalCents, paidAt })}
        </p>
        <ReleaseProgress />
        <p data-testid="close-page-note" className="mt-6 text-base font-semibold text-ink">
          {CLOSE_PAGE_NOTE}
        </p>
        <Link
          href={ORDERS_DASHBOARD_HREF}
          data-testid="back-to-dashboard"
          className={buttonClasses("secondary", "mt-4 h-11 px-5 text-[15px]")}
        >
          Back to dashboard
        </Link>
      </div>
      <div
        data-testid="paid-preview"
        className="mt-8 h-[min(70vh,720px)] min-h-[420px] overflow-hidden rounded-[var(--cp-radius)] border border-line"
      >
        {preview}
      </div>
    </>
  );
}

function ReleaseProgress() {
  return (
    <ol
      data-testid="release-progress"
      role="progressbar"
      aria-label="Certified PDF progress"
      aria-valuetext="Final review"
      className="mx-auto mt-8 grid w-full max-w-[560px] grid-cols-4 gap-2"
    >
      {RELEASE_PROGRESS_STEPS.map((step) => (
        <li
          key={step.id}
          data-testid={`release-step-${step.id}`}
          data-state={step.state}
          aria-current={step.state === "current" ? "step" : undefined}
          className="min-w-0"
        >
          <div
            className={`h-1.5 overflow-hidden rounded-full ${
              step.state === "done" ? "bg-primary" : step.state === "current" ? "relative bg-[#d6e2ff]" : "bg-line"
            }`}
          >
            {step.state === "current" ? (
              <span
                className="release-indeterminate pointer-events-none absolute inset-y-0 left-0 w-full motion-reduce:animate-none"
                aria-hidden
              />
            ) : null}
          </div>
          <p
            className={`mt-2 text-[12px] leading-tight md:text-[13px] ${
              step.state === "current"
                ? "font-semibold text-primary"
                : step.state === "done"
                  ? "font-medium text-ink"
                  : "text-ink-muted"
            }`}
          >
            {step.label}
          </p>
        </li>
      ))}
    </ol>
  );
}

function Ready({
  order,
  token,
  email,
}: {
  order: CustomerOrder;
  token: string;
  email: string;
}) {
  const copy = downloadReadyCopy(order);
  const names = order.documents.map((document) => document.filename);
  const named = deliveryDocumentName({ documentNames: names });
  const rowTitle = copy.primaryFile === "evaluation" ? copy.primaryTitle : order.documentTitle || named.title;
  const evaluatedIn = isCustomerEvaluation(order) ? evaluationSpeedLine(order.paidAt, order.deliveredAt) : null;
  return (
    <div data-testid="download-phase" data-phase="ready">
      <div className="flex size-12 items-center justify-center rounded-full bg-[#e8f6f0] text-2xl font-bold text-[var(--cp-ok)]">
        ✓
      </div>
      <h1 className="mt-5 text-[32px] font-bold tracking-[-0.6px] md:text-4xl">
        {copy.title}
      </h1>
      {evaluatedIn ? (
        <p data-testid="evaluation-speed" className="mt-2 text-[13.5px] text-ink-muted">
          {evaluatedIn}
        </p>
      ) : null}
      <p data-testid="email-note" className="mt-2.5 mb-7 text-base text-ink-muted">
        Paid {totalLabel(order.totalCents)} · Order {order.orderId}. {downloadEmailedLine(email)}
      </p>
      <div className="overflow-hidden rounded-[var(--cp-radius)] border border-line">
        <FileRow
          token={token}
          file={copy.primaryFile}
          title={rowTitle}
          subtitle={
            copy.primaryFile === "evaluation"
              ? orderDownloadFilename(copy.primaryFile, names, order.targetLanguage)
              : "Certified translation · PDF"
          }
          testId={copy.primaryFile === "evaluation" ? "download-evaluation" : "download-certified"}
          primary
        />
      </div>
      <p className="mt-5 text-[13.5px] leading-relaxed text-ink-muted">
        Bookmark this page or use the link in your email to come back. {copy.again}{" "}
        <Link
          href="/translate"
          className="font-semibold text-primary"
          onClick={() => {
            if (flowUsesMock()) sessionStorage.removeItem("credpronto-mock-order");
          }}
        >
          Start a new order
        </Link>
      </p>
    </div>
  );
}

function FileRow({
  token,
  file,
  title,
  subtitle,
  testId,
  primary,
}: {
  token: string;
  file: DownloadFileKind;
  title: string;
  subtitle: string;
  testId: string;
  primary?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const mock = flowUsesMock();
  const href = MOCK_HREF;
  const className = buttonClasses(
    primary ? "primary" : "secondary",
    primary
      ? "h-12 w-full px-6 text-base sm:w-auto"
      : "h-10 w-full shrink-0 px-[18px] text-[15px] sm:w-auto",
  );

  return (
    <div className="flex flex-col gap-3 border-t border-line px-[18px] py-4 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <b>{title}</b>
        <div className="text-[13px] text-ink-muted">{subtitle}</div>
        {error ? <p className="mt-1 text-xs text-[var(--cp-warn)]">{error}</p> : null}
      </div>
      {mock ? (
        <a data-testid={testId} href={href} className={className}>
          Download
        </a>
      ) : (
        <button
          type="button"
          data-testid={testId}
          className={className}
          onClick={() => {
            void getFlowClient()
              .download(token, file)
              .then((result) => {
                window.location.assign(result.url);
              })
              .catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : "Download isn't ready.");
              });
          }}
        >
          Download
        </button>
      )}
    </div>
  );
}
