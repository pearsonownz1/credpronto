"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { shortOrderId } from "@/lib/account/present";
import { flowUsesMock, getFlowClient } from "@/lib/flow/client";
import {
  CLOSE_PAGE_NOTE,
  CONFIRMING_PAYMENT_COPY,
  CONFIRMING_PAYMENT_DETAIL,
  ORDERS_DASHBOARD_HREF,
  QUICK_CHECK_DETAIL,
  paidReviewHeading,
  downloadEmailedLine,
  downloadPhase,
  downloadReadyCopy,
  orderContents,
  orderIsPaid,
  packageProgress,
  packageProgressSteps,
  paidReceiptLine,
  type DownloadFileKind,
} from "@/lib/flow/present";
import { deliveryDocumentName, orderDownloadFilename } from "@/lib/orders/download-name";
import { evaluationSpeedLine } from "@/lib/orders/speed-line";
import type { CustomerOrder } from "@/lib/orders/view";
import { CorrectionRequest } from "./correction-request";
import { FlowHeader } from "./flow-header";
import { PaidPreview } from "./paid-preview";
import { FlowStatus } from "./status";
import { useCustomerOrder, useStoredToken } from "./use-order";
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
  const { order, error, loading } = useCustomerOrder(token, pendingPayment ? "checkout" : "until-download");

  useEffect(() => {
    if (order) onOrder?.(order);
  }, [order, onOrder]);

  return (
    <PaidOrderScreen
      order={order}
      token={token}
      pendingPayment={pendingPayment}
      loading={loading}
      error={error}
      preview={order ? <PaidPreview token={token} order={order} /> : null}
    />
  );
}

/** Paid order page. Fixtures pass `downloadHref` so the button does not call the API. */
export function PaidOrderScreen({
  order,
  token,
  pendingPayment = false,
  loading = false,
  error = null,
  preview = null,
  downloadHref = null,
}: {
  order: CustomerOrder | null;
  token: string;
  pendingPayment?: boolean;
  loading?: boolean;
  error?: string | null;
  preview?: ReactNode;
  downloadHref?: string | null;
}) {
  const phase = order ? downloadPhase(order) : "finalizing";
  const confirming = pendingPayment ? phase !== "certifying" && phase !== "ready" : phase === "finalizing" && order != null;
  const contents = order ? orderContents(order) : { translation: true, evaluation: false };
  const bundle = contents.translation && contents.evaluation;
  const evaluation = contents.evaluation;
  const paid = order != null && orderIsPaid(order);
  const onDownloadStep = confirming || phase === "certifying" || phase === "ready";
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
  const wide = phase === "certifying" && !evaluation && !confirming;

  return (
    <div data-paid-compact={wide ? undefined : ""}>
      <BackToDashboard />
      <FlowHeader
        current={headerStep}
        track={bundle ? "bundle" : evaluation ? "evaluation" : "translation"}
        showStepper={!paid}
      />
      <main
        className={
          wide
            ? "mx-auto w-full max-w-6xl px-4 pt-6 pb-16"
            : "mx-auto w-full max-w-[640px] px-4 pt-6 pb-16"
        }
      >
        {confirming ? (
          <FlowStatus
            testId="download-phase"
            phase="confirming"
            kicker={order ? `Order ${shortOrderId(order.orderId)}` : undefined}
            title={CONFIRMING_PAYMENT_COPY}
            body={CONFIRMING_PAYMENT_DETAIL}
          />
        ) : loading && !order ? (
          <FlowStatus title="Loading your order…" body="" />
        ) : error && !order ? (
          <FlowStatus title="We couldn't load this order" body={error} />
        ) : !order ? (
          <FlowStatus title="No order yet" body="Start a translation to get a download." />
        ) : phase === "certifying" ? (
          <InReview order={order} preview={evaluation ? null : preview} />
        ) : (
          <Ready order={order} token={token} downloadHref={downloadHref} />
        )}
      </main>
    </div>
  );
}

function BackToDashboard() {
  return (
    <div className="px-4 pt-4 md:px-10 md:pt-5">
      <Link
        href={ORDERS_DASHBOARD_HREF}
        data-testid="back-to-dashboard"
        className={buttonClasses("secondary", "h-10 px-4 text-sm")}
      >
        Back to dashboard
      </Link>
    </div>
  );
}

function OrderNumber({ orderId }: { orderId: string }) {
  return (
    <p data-testid="order-id" className="preview-kicker blue">
      Order {shortOrderId(orderId)}
    </p>
  );
}

function InReview({ order, preview }: { order: CustomerOrder; preview: ReactNode }) {
  return (
    <>
      <div data-testid="download-phase" data-phase="review" className="mx-auto w-full max-w-[720px] text-center">
        <OrderNumber orderId={order.orderId} />
        <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-[-0.5px] md:text-[32px]">
          {paidReviewHeading(order)}
        </h1>
        <p data-testid="email-note" className="mt-3 text-base text-ink-muted">
          {QUICK_CHECK_DETAIL}
        </p>
        <p data-testid="paid-receipt" className="mt-3 text-base text-ink">
          {paidReceiptLine({ totalCents: order.totalCents, paidAt: order.paidAt })}
        </p>
        <PackageProgress order={order} />
        <p data-testid="close-page-note" className="mt-6 text-base font-semibold text-ink">
          {CLOSE_PAGE_NOTE}
        </p>
      </div>
      {preview ? (
        <div
          data-testid="paid-preview"
          className="mt-8 h-[min(70vh,720px)] min-h-[420px] overflow-hidden rounded-[var(--cp-radius)] border border-line"
        >
          {preview}
        </div>
      ) : null}
    </>
  );
}

function PackageProgress({ order }: { order: CustomerOrder }) {
  const current = packageProgress(order);
  const steps = packageProgressSteps(current);
  const label = steps.find((step) => step.state === "current")?.label ?? "Ready";
  return (
    <ol
      data-testid="package-progress"
      role="progressbar"
      aria-label="Package status"
      aria-valuetext={label}
      className="mx-auto mt-8 grid w-full max-w-[560px] grid-cols-3 gap-2"
    >
      {steps.map((step) => (
        <li
          key={step.id}
          data-testid={`package-step-${step.id}`}
          data-state={step.state}
          aria-current={step.state === "current" ? "step" : undefined}
          className="min-w-0"
        >
          <div
            className={`h-1.5 overflow-hidden rounded-full ${
              step.state === "upcoming" ? "bg-line" : "bg-primary"
            }`}
          />
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
  downloadHref,
}: {
  order: CustomerOrder;
  token: string;
  downloadHref?: string | null;
}) {
  const contents = orderContents(order);
  const copy = downloadReadyCopy(order);
  const names = order.documents.map((document) => document.filename);
  const named = deliveryDocumentName({ documentNames: names });
  const rowTitle = copy.primaryFile === "evaluation" ? copy.primaryTitle : order.documentTitle || named.title;
  const evaluatedIn = contents.evaluation ? evaluationSpeedLine(order.paidAt, order.deliveredAt) : null;
  const emailed = downloadEmailedLine(order);
  return (
    <div data-testid="download-phase" data-phase="ready">
      <div className="flex size-12 items-center justify-center rounded-full bg-[#e8f6f0] text-2xl font-bold text-[var(--cp-ok)]">
        ✓
      </div>
      <div className="mt-5">
        <OrderNumber orderId={order.orderId} />
      </div>
      <h1 className="mt-3 text-[32px] font-bold tracking-[-0.6px] md:text-4xl">{copy.title}</h1>
      {evaluatedIn ? (
        <p data-testid="evaluation-speed" className="mt-2 text-[13.5px] text-ink-muted">
          {evaluatedIn}
        </p>
      ) : null}
      <PackageProgress order={order} />
      {emailed ? (
        <p data-testid="emailed-copy" className="mt-6 text-base text-ink-muted">
          {emailed}
        </p>
      ) : null}
      <div className={`overflow-hidden rounded-[var(--cp-radius)] border border-line ${emailed ? "mt-4" : "mt-6"}`}>
        <FileRow
          token={token}
          file={copy.primaryFile}
          title={rowTitle}
          subtitle={
            copy.primaryFile === "evaluation"
              ? contents.translation
                ? "PDF"
                : orderDownloadFilename(copy.primaryFile, names, order.targetLanguage)
              : "Certified translation · PDF"
          }
          testId={copy.primaryFile === "evaluation" ? "download-evaluation" : "download-certified"}
          href={downloadHref}
        />
      </div>
      <CorrectionRequest token={token} order={order} />
      <Link
        href="/translate"
        data-testid="start-another-order"
        className="mt-4 inline-flex font-semibold text-primary"
        onClick={() => {
          if (flowUsesMock()) sessionStorage.removeItem("credpronto-mock-order");
        }}
      >
        Start another order
      </Link>
    </div>
  );
}

function FileRow({
  token,
  file,
  title,
  subtitle,
  testId,
  href,
}: {
  token: string;
  file: DownloadFileKind;
  title: string;
  subtitle: string;
  testId: string;
  href?: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const mock = flowUsesMock();
  const className = buttonClasses("primary", "h-[52px] w-full px-6 text-base");
  const label = "Download";

  return (
    <div className="flex flex-col gap-4 px-[18px] py-5">
      <div>
        <b className="text-lg">{title}</b>
        <div className="text-[13px] text-ink-muted">{subtitle}</div>
        {error ? <p className="mt-1 text-xs text-[var(--cp-warn)]">{error}</p> : null}
      </div>
      {href || mock ? (
        <a data-testid={testId} href={href || MOCK_HREF} className={className}>
          {label}
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
          {label}
        </button>
      )}
    </div>
  );
}
