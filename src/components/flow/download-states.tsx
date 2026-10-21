"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { flowUsesMock, getFlowClient } from "@/lib/flow/client";
import {
  CONFIRMING_PAYMENT_COPY,
  CONFIRMING_PAYMENT_DETAIL,
  QUICK_CHECK_COPY,
  QUICK_CHECK_DETAIL,
  downloadEmailedLine,
  downloadPhase,
  downloadReadyCopy,
  isCustomerEvaluation,
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
  const evaluation = order != null && isCustomerEvaluation(order);
  const showEvalTracker =
    order != null &&
    evaluation &&
    !confirming &&
    (phase === "certifying" || (phase === "ready" && order.evaluationStatus === "evaluation_complete"));
  const headerStep = evaluation
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
      <FlowHeader current={headerStep} track={evaluation ? "evaluation" : "translation"} />
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
          <EvaluationReview order={order} token={token} phase={phase === "ready" ? "ready" : "review"} />
        ) : phase === "certifying" ? (
          <Certifying order={order} token={token} email={email} />
        ) : (
          <Ready order={order} token={token} email={email} />
        )}
      </main>
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
    <>
      <div data-testid="download-phase" data-phase="review" className="mx-auto w-full max-w-[720px] text-center">
        <p className="preview-kicker blue">Order {order.orderId}</p>
        <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-[-0.5px] md:text-[32px]">
          {QUICK_CHECK_COPY}
        </h1>
        <p className="mt-3 text-base text-ink-muted">{QUICK_CHECK_DETAIL}</p>
        <p data-testid="email-note" className="mt-2 text-base text-ink-muted">
          {paidReviewEmailLine(email)}
        </p>
      </div>
      <div
        data-testid="paid-preview"
        className="mt-8 h-[min(70vh,720px)] min-h-[420px] overflow-hidden rounded-[var(--cp-radius)] border border-line"
      >
        <PaidPreview token={token} order={order} />
      </div>
    </>
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
