"use client";

import { useEffect } from "react";
import { formatMoney } from "@/lib/flow/pricing";
import { TRANSLATION_REVIEW_COPY } from "@/lib/flow/preview-progress";
import { evaluationTracker, type EvalStatus } from "@/lib/evalStatus";
import {
  CONFIRMING_PAYMENT_COPY,
  CONFIRMING_PAYMENT_DETAIL,
  QUICK_CHECK_COPY,
  QUICK_CHECK_DETAIL,
  isCustomerEvaluation,
  isTranslationBundle,
  type DownloadPhase,
} from "@/lib/flow/present";
import { TRANSLATION_TIMEOUT_REASON } from "@/lib/orders/translation-failure";
import type { CustomerOrder } from "@/lib/orders/view";

const LOADING_ORDER = "Loading your order";

const PREVIEW_WAIT = new Set(["processing", "confirmed", "correction_requested", "needs_review"]);

export function orderLiveMessage(input: {
  loading: boolean;
  error?: string | null;
  /** Checkout return before release, or a flagged order still with the translator. */
  phase?: DownloadPhase | null;
  checkout?: string | null;
  order: (Pick<CustomerOrder, "status" | "billablePages" | "totalCents"> & {
    fulfillment?: CustomerOrder["fulfillment"];
    delayed?: boolean;
    reviewReason?: string | null;
    orderType?: CustomerOrder["orderType"];
    service?: CustomerOrder["service"];
    serviceType?: string | null;
    includeTranslation?: boolean | null;
    evaluationStatus?: EvalStatus | null;
    progress?: { step?: string | null } | null;
  }) | null;
}): string {
  if (input.checkout === "cancel") return "Payment canceled.";
  if (input.phase === "finalizing" && input.checkout === "success") {
    return `${CONFIRMING_PAYMENT_COPY}. ${CONFIRMING_PAYMENT_DETAIL}`;
  }
  const order = input.order;
  if (!order) {
    if (input.loading) return "Loading your order…";
    if (input.error) return "We couldn't load this order.";
    return "Order not found.";
  }

  const pages = order.billablePages ?? 0;
  const pageText = `${pages} ${pages === 1 ? "page" : "pages"}`;
  const evaluation = isCustomerEvaluation(order);
  const bundle = isTranslationBundle(order);
  if (input.phase === "certifying" || order.fulfillment === "awaiting_review") {
    if (!evaluation) return `${QUICK_CHECK_COPY}. ${QUICK_CHECK_DETAIL}`;
    return evaluationLiveLine(order.evaluationStatus);
  }
  if (
    order.fulfillment === "released" ||
    order.status === "paid" ||
    order.status === "approved" ||
    order.status === "delivered"
  ) {
    if (evaluation && order.evaluationStatus === "evaluation_complete") return "Evaluation complete.";
    return evaluation ? "Your credential evaluation is ready." : "Your translation is ready.";
  }
  if (
    order.status === "needs_review" &&
    (!evaluation || bundle) &&
    (order.delayed || order.reviewReason === TRANSLATION_TIMEOUT_REASON)
  ) {
    return TRANSLATION_REVIEW_COPY;
  }
  if (order.status === "needs_review" && order.delayed) {
    return "Taking longer than usual, we're on it.";
  }
  if (order.status === "quoted" || order.status === "needs_review") {
    if (order.totalCents == null) return `Quote ready: ${pageText}`;
    return `Quote ready: ${pageText}, ${formatMoney(order.totalCents)}`;
  }
  if (order.status === "draft") return "Reading your files…";
  if (order.status === "failed") return "We couldn't read these files.";
  if (order.status === "preview_ready" || (order.progress?.step === "done" && order.status !== "needs_review")) {
    return "Your preview is ready.";
  }
  if (order.delayed && PREVIEW_WAIT.has(order.status)) {
    return "Taking longer than usual, we're on it.";
  }
  if (evaluation && !bundle && order.status === "confirmed") return "Ready to pay.";
  if (
    order.status === "processing" ||
    order.status === "confirmed" ||
    order.status === "correction_requested"
  ) {
    return "Translating your document.";
  }
  return "";
}

function evaluationLiveLine(status: EvalStatus | null | undefined): string {
  const tracker = evaluationTracker({ evaluationStatus: status });
  if (tracker.status === "evaluation_complete") return "Evaluation complete.";
  return tracker.steps.find((step) => step.state === "current")?.detail ?? "We're checking your documents.";
}

/** The App Router announcer keeps the loading heading after the quote replaces it. */
function routeAnnouncerNode(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const host = document.getElementsByTagName("next-route-announcer")[0];
  const node = host?.shadowRoot?.querySelector("#__next-route-announcer__");
  return node instanceof HTMLElement ? node : null;
}

export function OrderAnnouncement({ message }: { message: string }) {
  useEffect(() => {
    const node = routeAnnouncerNode();
    if (!node) return;
    const current = node.textContent ?? "";
    if (!current.includes(LOADING_ORDER) || current === message) return;
    node.textContent = message;
  }, [message]);

  return (
    <p data-testid="order-announcement" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </p>
  );
}
