"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { trackPreviewReady } from "@/lib/analytics/gtag-events";
import { downloadPhase, isCustomerEvaluation, orderHubStep } from "@/lib/flow/present";
import { writeToken } from "@/lib/flow/session";
import type { CustomerOrder } from "@/lib/orders/view";
import { GoogleAdsConversion } from "@/components/google-ads-conversion";
import { DownloadStates } from "./download-states";
import { OrderAnnouncement, orderLiveMessage } from "./order-announcement";
import { ProcessingView } from "./processing-view";
import { QuoteView } from "./quote-view";
import { useReadingHandoff } from "./reading-handoff";
import { FlowStatus } from "./status";
import { useCustomerOrder } from "./use-order";

export function OrderHub() {
  const params = useParams<{ token: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const token = params.token ?? "";
  const checkout = search.get("checkout");
  const { order, error, loading } = useCustomerOrder(token, checkout === "success" ? "checkout" : "once");
  const [latest, setLatest] = useState<CustomerOrder | null>(null);
  const [trackedToken, setTrackedToken] = useState(token);
  if (trackedToken !== token) {
    setTrackedToken(token);
    setLatest(null);
  }
  const { covering, reportOrder, endHandoff } = useReadingHandoff();
  const current = latest ?? order;
  const view = orderHubStep(checkout, current?.status, current);

  const reportPreviewReady = useCallback((next: CustomerOrder) => {
    setLatest(next);
    trackPreviewReady(next);
  }, [setLatest]);

  useEffect(() => {
    if (token) writeToken(token);
  }, [token]);

  useEffect(() => {
    if (order) trackPreviewReady(order);
  }, [order]);

  useLayoutEffect(() => {
    if (!covering) return;
    if (!order) {
      if (!loading) endHandoff();
      return;
    }
    if (order.status === "draft") {
      reportOrder(order);
      return;
    }
    if (view !== "quote") endHandoff();
  }, [order, loading, covering, view, reportOrder, endHandoff]);

  useEffect(() => {
    if (!token) return;
    if (view === "cancel") {
      if (!current) return;
      if (isCustomerEvaluation(current)) {
        router.replace(`/checkout?token=${encodeURIComponent(token)}`);
        return;
      }
      router.replace(`/preview/${encodeURIComponent(token)}?canceled=1`);
      return;
    }
    if (view === "checkout") {
      router.replace(`/checkout?token=${encodeURIComponent(token)}`);
      return;
    }
    if (view === "preview" && order) {
      router.replace(`/preview/${encodeURIComponent(token)}`);
    }
  }, [view, token, router, order, current]);

  let body: ReactNode;
  if (view === "cancel") {
    body = <FlowStatus title="Payment canceled" body="Taking you back to the preview." />;
  } else if (checkout === "success" || (current && view === "download")) {
    body = (
      <>
        <GoogleAdsConversion token={token} enabled={checkout === "success"} />
        <DownloadStates
          token={token}
          pendingPayment={checkout === "success"}
          onOrder={setLatest}
        />
      </>
    );
  } else if (loading && !current) {
    body = covering ? null : <FlowStatus title="Loading your order…" body="" />;
  } else if (error && !current) {
    body = <FlowStatus title="We couldn't load this order" body={error} />;
  } else if (!current) {
    body = (
      <FlowStatus title="Order not found" body="Start a new translation from the home page." />
    );
  } else if (view === "preview") {
    body = <FlowStatus title="Opening your preview…" body="" />;
  } else if (view === "checkout") {
    body = <FlowStatus title="Opening payment…" body="" />;
  } else if (view === "quote") {
    body = <QuoteView token={token} onOrder={setLatest} />;
  } else {
    body = <ProcessingView token={token} onOrder={reportPreviewReady} />;
  }

  const phase =
    view === "download"
      ? error && !current
        ? null
        : current
          ? downloadPhase(current)
          : checkout === "success"
            ? "finalizing"
            : null
      : null;

  return (
    <>
      <OrderAnnouncement
        message={orderLiveMessage({
          loading: loading && !current,
          error,
          phase,
          checkout,
          order: current,
        })}
      />
      {body}
    </>
  );
}
