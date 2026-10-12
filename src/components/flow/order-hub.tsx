"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { orderHubStep } from "@/lib/flow/present";
import { writeToken } from "@/lib/flow/session";
import { GoogleAdsConversion } from "@/components/google-ads-conversion";
import { DownloadStates } from "./download-states";
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
  const view = orderHubStep(checkout, order?.status);

  useEffect(() => {
    if (token) writeToken(token);
  }, [token]);

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

  if (view === "cancel") {
    return <FlowStatus title="Payment canceled" body="Taking you back to the preview." />;
  }

  if (checkout === "success" || (order && view === "download")) {
    return (
      <>
        <GoogleAdsConversion token={token} enabled={checkout === "success"} />
        <DownloadStates token={token} />
      </>
    );
  }

  if (loading && !order) {
    return <FlowStatus title="Loading your order…" body="" />;
  }

  if (error && !order) {
    return <FlowStatus title="We couldn't load this order" body={error} />;
  }

  if (!order) {
    return (
      <FlowStatus title="Order not found" body="Start a new translation from the home page." />
    );
  }

  if (view === "preview") {
    return <FlowStatus title="Opening your preview…" body="" />;
  }

  if (view === "quote") return <QuoteView token={token} />;
  return <ProcessingView token={token} />;
}
