"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { trackPreviewReady } from "@/lib/analytics/gtag-events";
import { orderHubStep } from "@/lib/flow/present";
import { writeToken } from "@/lib/flow/session";
import type { CustomerOrder } from "@/lib/orders/view";
import { GoogleAdsConversion } from "@/components/google-ads-conversion";
import { DownloadStates } from "./download-states";
import { OrderAnnouncement, orderLiveMessage } from "./order-announcement";
import { ProcessingView } from "./processing-view";
import { QuoteView } from "./quote-view";
import { FlowStatus } from "./status";
import { useCustomerOrder } from "./use-order";

export function OrderHub() {
  const params = useParams<{ token: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const token = params.token ?? "";
  const checkout = search.get("checkout");
  const returned = checkout === "success" || checkout === "cancel";
  const { order, error, loading } = useCustomerOrder(returned ? "" : token, "once");
  const [latest, setLatest] = useState<CustomerOrder | null>(null);
  const [trackedToken, setTrackedToken] = useState(token);
  if (trackedToken !== token) {
    setTrackedToken(token);
    setLatest(null);
  }
  const view = orderHubStep(checkout, (latest ?? order)?.status);

  const reportPreviewReady = useCallback((next: CustomerOrder) => {
    trackPreviewReady(next);
  }, []);

  useEffect(() => {
    if (token) writeToken(token);
  }, [token]);

  useEffect(() => {
    if (order) trackPreviewReady(order);
  }, [order]);

  useEffect(() => {
    if (!token) return;
    if (view === "cancel") {
      router.replace(`/preview/${encodeURIComponent(token)}?canceled=1`);
      return;
    }
    if (view === "preview" && order) {
      router.replace(`/preview/${encodeURIComponent(token)}`);
    }
  }, [view, token, router, order]);

  const current = latest ?? order;
  let body: ReactNode;
  if (view === "cancel") {
    body = <FlowStatus title="Payment canceled" body="Taking you back to the preview." />;
  } else if (checkout === "success" || (current && view === "download")) {
    body = (
      <>
        <GoogleAdsConversion token={token} enabled={checkout === "success"} />
        <DownloadStates token={token} />
      </>
    );
  } else if (loading && !current) {
    body = <FlowStatus title="Loading your order…" body="" />;
  } else if (error && !current) {
    body = <FlowStatus title="We couldn't load this order" body={error} />;
  } else if (!current) {
    body = (
      <FlowStatus title="Order not found" body="Start a new translation from the home page." />
    );
  } else if (view === "preview") {
    body = <FlowStatus title="Opening your preview…" body="" />;
  } else if (view === "quote") {
    body = <QuoteView token={token} onOrder={setLatest} />;
  } else {
    body = <ProcessingView token={token} onOrder={reportPreviewReady} />;
  }

  return (
    <>
      <OrderAnnouncement
        message={orderLiveMessage({
          loading: loading && !current,
          error,
          order: current,
        })}
      />
      {body}
    </>
  );
}
