"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { flowUsesMock, getFlowClient } from "@/lib/flow/client";
import {
  PAID_REVIEW_COPY,
  downloadPhase,
  downloadReadyCopy,
  paidReviewEmailLine,
  totalLabel,
  type DownloadFileKind,
} from "@/lib/flow/present";
import { orderDownloadFilename } from "@/lib/orders/download-name";
import type { CustomerOrder } from "@/lib/orders/view";
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
  const phase = order ? downloadPhase(order) : "confirming";
  const email = order?.email?.trim() || storedEmail;
  const onDownloadStep = phase === "certifying" || phase === "ready";

  useEffect(() => {
    if (order) onOrder?.(order);
  }, [order, onOrder]);

  return (
    <div>
      <FlowHeader current={onDownloadStep ? "download" : "preview"} />
      <main
        className={
          phase === "certifying"
            ? "mx-auto w-full max-w-6xl px-4 pt-10 pb-16"
            : "mx-auto w-full max-w-[640px] px-4 pt-10 md:pt-16"
        }
      >
        {loading && !order ? (
          <FlowStatus
            testId="download-phase"
            title="Confirming payment"
            body="This usually takes a few seconds."
          />
        ) : error && !order ? (
          <FlowStatus title="We couldn't load this order" body={error} />
        ) : !order ? (
          <FlowStatus title="No order yet" body="Start a translation to get a download." />
        ) : phase === "confirming" ? (
          <FlowStatus
            testId="download-phase"
            kicker={`Order ${order.orderId}`}
            title="Confirming payment"
            body="Stripe is sending the receipt. This page checks until the payment is recorded."
          />
        ) : phase === "certifying" ? (
          <Certifying order={order} token={token} email={email} />
        ) : (
          <Ready order={order} token={token} email={email} />
        )}
      </main>
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
      <div data-testid="download-phase" className="mx-auto w-full max-w-[720px] text-center">
        <p className="preview-kicker blue">Order {order.orderId}</p>
        <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-[-0.5px] md:text-[32px]">
          {PAID_REVIEW_COPY}
        </h1>
        <p data-testid="email-note" className="mt-3 text-base text-ink-muted">
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
  return (
    <>
      <div className="flex size-12 items-center justify-center rounded-full bg-[#e8f6f0] text-2xl font-bold text-[var(--cp-ok)]">
        ✓
      </div>
      <h1 className="mt-5 text-[32px] font-bold tracking-[-0.6px] md:text-4xl">
        {copy.title}
      </h1>
      <p data-testid="email-note" className="mt-2.5 mb-7 text-base text-ink-muted">
        Paid {totalLabel(order.totalCents)} · Order {order.orderId}.{" "}
        {email ? `A copy is on its way to ${email}.` : "A copy is on its way by email."}
      </p>
      <div className="overflow-hidden rounded-[var(--cp-radius)] border border-line">
        <FileRow
          token={token}
          file={copy.primaryFile}
          title={copy.primaryTitle}
          filename={orderDownloadFilename(copy.primaryFile, names, order.targetLanguage)}
          testId={copy.primaryFile === "evaluation" ? "download-evaluation" : "download-certified"}
          primary
        />
        {copy.secondary ? (
          <FileRow
            token={token}
            file={copy.secondary.file}
            title={copy.secondary.title}
            filename={orderDownloadFilename(copy.secondary.file, names, order.targetLanguage)}
            testId="download-certification"
          />
        ) : null}
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
    </>
  );
}

function FileRow({
  token,
  file,
  title,
  filename,
  testId,
  primary,
}: {
  token: string;
  file: DownloadFileKind;
  title: string;
  filename: string;
  testId: string;
  primary?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const mock = flowUsesMock();
  const href = MOCK_HREF;
  const className = buttonClasses(
    primary ? "primary" : "secondary",
    "h-10 shrink-0 px-[18px] text-[15px]",
  );

  return (
    <div className="flex flex-col gap-3 border-t border-line px-[18px] py-4 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <b>{title}</b>
        <div className="text-[13px] text-ink-muted">{filename}</div>
        {error ? <p className="mt-1 text-xs text-[var(--cp-warn)]">{error}</p> : null}
      </div>
      {mock ? (
        <a data-testid={testId} href={href} download={filename} className={className}>
          {primary ? "Download PDF" : "Download"}
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
          {primary ? "Download PDF" : "Download"}
        </button>
      )}
    </div>
  );
}
