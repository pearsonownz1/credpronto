"use client";

import Link from "next/link";
import { useState } from "react";
import { flowUsesMock, getFlowClient } from "@/lib/flow/client";
import { DOWNLOADS } from "@/lib/flow/mock-data";
import {
  certifiedDownloadName,
  customerEmail,
  downloadPhase,
  originalDownloadName,
  totalLabel,
} from "@/lib/flow/present";
import type { CustomerOrder } from "@/lib/orders/view";
import { FlowHeader } from "./flow-header";
import { FlowStatus } from "./status";
import { useCustomerOrder, useStoredToken } from "./use-order";
import { buttonClasses } from "./ui";

const MOCK_HREFS = {
  translation: "/samples/birth-certificate-en.pdf",
  certification: "/samples/birth-certificate-en.pdf",
  original: DOWNLOADS.original.href,
} as const;

export function DownloadStates({ token: pathToken }: { token?: string }) {
  const token = useStoredToken(pathToken);
  const { order, error, loading } = useCustomerOrder(token, "until-download");
  const email = order ? customerEmail(order) : "";
  const phase = order ? downloadPhase(order) : "confirming";

  return (
    <div>
      <FlowHeader current={phase === "ready" ? "download" : "preview"} />
      <main className="mx-auto w-full max-w-[640px] px-4 pt-10 md:pt-16">
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
          <FlowStatus
            testId="download-phase"
            kicker={`Order ${order.orderId}`}
            title="Paid, being certified by our team"
            body={
              email
                ? `We'll email ${email} when the certified PDF is ready to download.`
                : "We'll email you when the certified PDF is ready to download."
            }
          />
        ) : (
          <Ready order={order} token={token} email={email} />
        )}
      </main>
    </div>
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
  return (
    <>
      <div className="flex size-12 items-center justify-center rounded-full bg-[#e8f6f0] text-2xl font-bold text-[var(--cp-ok)]">
        ✓
      </div>
      <h1 className="mt-5 text-[32px] font-bold tracking-[-0.6px] md:text-4xl">
        Your certified translation is ready.
      </h1>
      <p data-testid="email-note" className="mt-2.5 mb-7 text-base text-ink-muted">
        Paid {totalLabel(order.totalCents)} · Order {order.orderId}.{" "}
        {email ? `A copy is on its way to ${email}.` : "A copy is on its way by email."}
      </p>
      <div className="overflow-hidden rounded-[var(--cp-radius)] border border-line">
        <FileRow
          token={token}
          file="translation"
          title="Certified translation"
          filename={certifiedDownloadName(order.documents[0]?.filename)}
          testId="download-certified"
          primary
        />
        <FileRow
          token={token}
          file="certification"
          title="Certification page"
          filename="certification.pdf"
          testId="download-certification"
        />
        {order.documents.map((document) => (
          <OriginalRow key={document.id} token={token} document={document} />
        ))}
      </div>
      <p className="mt-5 text-[13.5px] leading-relaxed text-ink-muted">
        Bookmark this page or use the link in your email to come back. Need another
        document translated?{" "}
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

function openSignedUrl(url: string) {
  window.location.assign(url);
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
  file: "translation" | "certification";
  title: string;
  filename: string;
  testId: string;
  primary?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const mock = flowUsesMock();
  const className = buttonClasses(
    primary ? "primary" : "secondary",
    "h-10 shrink-0 px-[18px] text-[15px]",
  );

  return (
    <div className="flex flex-col gap-3 border-t border-line px-[18px] py-4 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <b>{title}</b>
        <div data-testid={`${testId}-name`} className="text-[13px] text-ink-muted">
          {filename}
        </div>
        {error ? <p className="mt-1 text-xs text-[var(--cp-warn)]">{error}</p> : null}
      </div>
      <button
        type="button"
        data-testid={testId}
        className={className}
        onClick={() => {
          if (mock) {
            openSignedUrl(MOCK_HREFS[file]);
            return;
          }
          void getFlowClient()
            .download(token, file)
            .then((result) => {
              if ("url" in result) openSignedUrl(result.url);
            })
            .catch((cause: unknown) => {
              setError(cause instanceof Error ? cause.message : "Download isn't ready.");
            });
        }}
      >
        {primary ? "Download PDF" : "Download"}
      </button>
    </div>
  );
}

function OriginalRow({
  token,
  document,
}: {
  token: string;
  document: CustomerOrder["documents"][number];
}) {
  const [error, setError] = useState<string | null>(null);
  const mock = flowUsesMock();
  const className = buttonClasses("secondary", "h-10 shrink-0 px-[18px] text-[15px]");
  const filename = originalDownloadName(document.filename);

  return (
    <div className="flex flex-col gap-3 border-t border-line px-[18px] py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <b data-testid={`download-original-${document.id}-name`}>{filename || "Original"}</b>
        <div className="text-[13px] text-ink-muted">Original upload</div>
        {error ? <p className="mt-1 text-xs text-[var(--cp-warn)]">{error}</p> : null}
      </div>
      <button
        type="button"
        data-testid={`download-original-${document.id}`}
        className={className}
        onClick={() => {
          if (mock) {
            openSignedUrl(MOCK_HREFS.original);
            return;
          }
          void getFlowClient()
            .download(token, "original", document.id)
            .then((result) => {
              if ("url" in result) openSignedUrl(result.url);
            })
            .catch((cause: unknown) => {
              setError(cause instanceof Error ? cause.message : "Download isn't ready.");
            });
        }}
      >
        Download original
      </button>
    </div>
  );
}
