import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sampleCustomerOrder } from "@/lib/flow/sample-order";
import type { CustomerOrder } from "@/lib/orders/view";

const state = vi.hoisted(() => ({
  order: null as CustomerOrder | null,
  error: null as string | null,
  loading: false,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

vi.mock("./use-order", () => ({
  useStoredToken: () => "token-1",
  useStoredEmail: () => "ada@example.com",
  useCustomerOrder: () => ({
    order: state.order,
    error: state.error,
    loading: state.loading,
    reload: () => undefined,
  }),
}));

import { DownloadStates } from "./download-states";

function downloadButton(html: string): string {
  return html.match(/<button[^>]*data-testid="download-evaluation"[^>]*>/)?.[0] ?? "";
}

function readyOrder(patch: Partial<CustomerOrder>): CustomerOrder {
  return {
    ...sampleCustomerOrder(),
    status: "delivered",
    payment: { status: "paid" },
    delivery: { status: "delivered" },
    documents: [
      {
        id: "birth",
        filename: "birth-certificate.pdf",
        pageCount: 1,
        detectedLanguage: "es",
        confidence: 0.94,
        uploadPosition: 1,
        appliedPosition: 1,
      },
    ],
    documentTitle: "Birth certificate",
    ...patch,
  };
}

describe("download page", () => {
  it("names the evaluation report and does not offer a translation certificate", () => {
    state.error = null;
    state.loading = false;
    state.order = readyOrder({
      orderType: "evaluation",
      service: "diploma",
      degreeCount: 1,
      evaluationCents: 1995,
      translationCents: 0,
      includeTranslation: false,
      translationOfferCents: 995,
      totalCents: 1995,
    });
    const html = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1" }));
    expect(html).toContain("Your credential evaluation is ready.");
    expect(html).toContain("Evaluation report");
    expect(html).toContain("birth-certificate-evaluation.pdf");
    expect(html).toContain('data-testid="download-evaluation"');
    expect(html).not.toContain("birth-certificate-EN-certified.pdf");
    expect(html).not.toContain('data-testid="download-certified"');
    expect(html).not.toContain('data-testid="download-certification"');
    expect(html).not.toContain("Certified translation");
    expect(html).not.toContain("Evaluated in");
  });

  it("shows how long the evaluation took from payment to delivery", () => {
    state.error = null;
    state.loading = false;
    state.order = readyOrder({
      orderType: "evaluation",
      service: "diploma",
      degreeCount: 1,
      evaluationCents: 1995,
      translationCents: 0,
      totalCents: 1995,
      paidAt: "2026-10-12T00:00:00.000Z",
      deliveredAt: "2026-10-12T00:12:00.000Z",
      fulfillment: "released",
    });
    const html = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1" }));
    expect(html).toContain('data-phase="ready"');
    expect(html).toContain('data-testid="evaluation-speed"');
    expect(html).toContain("Evaluated in 12 minutes");
    expect(html).toContain("text-ink-muted");
  });

  it("uses the same three steps for a paid evaluation and does not offer a download", () => {
    state.order = readyOrder({
      status: "paid",
      payment: { status: "paid" },
      delivery: { status: "pending" },
      fulfillment: "awaiting_review",
      orderType: "translation",
      service: null,
      services: ["diploma"],
      includeTranslation: false,
      evaluationStatus: "under_review",
      totalCents: 1995,
    });
    const html = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1" }));
    expect(html).toContain("Order CP-24817");
    expect(html.match(/Order CP-24817/g)).toHaveLength(1);
    expect(html).toContain("Paid. We&#x27;re finishing your credential evaluation report.");
    expect(html).not.toContain("certified PDF");
    expect(html).toContain("Nothing to do. We&#x27;ll email you when it&#x27;s ready.");
    expect(html).toContain('data-testid="package-step-quick_review" data-state="current"');
    expect(html).toContain('data-testid="package-step-almost_ready" data-state="upcoming"');
    expect(html).toContain('data-testid="package-step-ready" data-state="upcoming"');
    expect(html).toContain("Quick Review");
    expect(html).toContain("Almost Ready");
    expect(html).not.toContain("Performing evaluation");
    expect(html).not.toContain("Performing layout");
    expect(html).not.toContain("Under review");
    expect(html).not.toContain("Final review");
    expect(html).not.toContain('data-testid="evaluation-tracker"');
    expect(html).not.toContain('data-testid="download-evaluation"');
    expect(html).not.toContain('data-testid="download-certified"');
    expect(html).toContain('href="/dashboard"');
    expect(html).not.toContain('data-testid="flow-stepper"');
    expect(html).toContain("bg-primary");
    expect(html).not.toContain("bg-[#d6e2ff]");
    expect(html).not.toContain("%");
  });

  it("keeps a combo in review with no download when the translation is already done", () => {
    state.order = readyOrder({
      orderId: "9b80cd30-57e1-4630-8354-9607210dbeac",
      status: "paid",
      payment: { status: "paid" },
      delivery: { status: "pending" },
      fulfillment: "awaiting_review",
      orderType: "translation",
      service: null,
      services: ["translation", "diploma"],
      includeTranslation: false,
      translationReady: true,
      evaluationStatus: "under_review",
      totalCents: 8975,
    });
    const html = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1" }));
    expect(html).toContain("Order 9b80cd30");
    expect(html).not.toContain("9b80cd30-57e1-4630-8354-9607210dbeac");
    expect(html.match(/Order 9b80cd30/g)).toHaveLength(1);
    expect(html).toContain("Paid. We&#x27;re finishing your certified translation and credential evaluation.");
    expect(html).not.toContain("certified PDF");
    expect(html).toContain("Nothing to do. We&#x27;ll email you when it&#x27;s ready.");
    expect(html).toContain('data-testid="package-step-quick_review" data-state="done"');
    expect(html).toContain('data-testid="package-step-almost_ready" data-state="current"');
    expect(html).toContain('data-testid="package-step-ready" data-state="upcoming"');
    expect(html).toContain("Paid $89.75");
    expect(html).not.toContain('data-testid="download-certified"');
    expect(html).not.toContain('data-testid="download-evaluation"');
    expect(html).not.toContain("Certified translation · PDF");
    expect(html).not.toContain("Performing layout");
    expect(html).toContain('href="/dashboard"');
    expect(html).not.toContain('data-testid="start-another-order"');
    expect(html).not.toContain('data-testid="flow-stepper"');
    expect(html).toContain("data-paid-compact");
  });

  it("hides the download until an evaluation package is approved", () => {
    state.order = readyOrder({
      status: "paid",
      payment: { status: "paid" },
      delivery: { status: "pending" },
      fulfillment: "awaiting_review",
      services: ["course_by_course"],
      service: null,
      orderType: "translation",
      evaluationStatus: "evaluation_complete",
    });
    const waiting = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1" }));
    expect(waiting).toContain('data-testid="package-step-almost_ready" data-state="current"');
    expect(waiting).not.toContain('data-testid="download-evaluation"');
    expect(waiting).not.toContain("Performing layout");
    expect(waiting).not.toContain("Evaluation complete");
  });

  it("links a finished evaluation to one download", () => {
    state.order = readyOrder({
      status: "delivered",
      payment: { status: "paid" },
      delivery: { status: "delivered" },
      fulfillment: "released",
      orderType: "evaluation",
      service: "diploma",
      degreeCount: 1,
      evaluationCents: 1995,
      translationCents: 0,
      totalCents: 1995,
      paidAt: "2026-10-21T17:00:00.000Z",
      deliveredAt: "2026-10-21T17:31:00.000Z",
      evaluationStatus: "evaluation_complete",
    });
    const html = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1" }));
    expect(html).toContain('data-phase="ready"');
    expect(html).toContain("Your credential evaluation is ready.");
    expect(html).toContain("We also emailed you a copy.");
    expect(html).toContain('data-testid="package-step-ready" data-state="current"');
    expect(downloadButton(html)).not.toMatch(/\sdisabled(?:=|>|\s)/);
    expect(html).toContain('data-testid="start-another-order"');
    expect(html).toContain("Start another order");
    expect(html).not.toContain("Nothing to do.");
    expect(html).not.toContain("Performing evaluation");
  });

  it("keeps the certified translation and certification page for a translation", () => {
    state.order = readyOrder({ orderType: "translation", service: null });
    const html = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1" }));
    expect(html).toContain("Your certified translation is ready.");
    expect(html).toContain("Birth certificate");
    expect(html).toContain("Certified translation · PDF");
    expect(html).toContain("bg-primary");
    expect(html).toContain('data-testid="download-certified"');
    expect(html).not.toContain('data-testid="download-certification"');
    expect(html).not.toContain("birth-certificate-EN-certified.pdf");
    expect(html).toContain('data-testid="package-step-ready" data-state="current"');
    expect(html).not.toContain('data-testid="flow-stepper"');
  });

  it("keeps a paid order on Download with the review copy and a read-only preview", () => {
    state.order = readyOrder({
      status: "paid",
      payment: { status: "paid" },
      delivery: { status: "pending" },
      fulfillment: "awaiting_review",
      paidAt: "2026-04-01T00:00:00.000Z",
      email: "buyer@example.com",
      orderType: "translation",
      service: null,
    });
    const html = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1" }));
    expect(html).toContain("finishing your certified PDF");
    expect(html).toContain("Nothing to do. We&#x27;ll email you when it&#x27;s ready.");
    expect(html).not.toContain("buyer@example.com");
    expect(html).toContain("You can close this page.");
    expect(html).toContain('data-testid="paid-receipt"');
    expect(html).toContain("Paid $19.90 on April 1, 2026");
    expect(html).toContain('data-testid="package-progress"');
    expect(html).toContain('aria-valuetext="Quick Review"');
    expect(html).not.toContain("aria-valuenow");
    expect(html).not.toMatch(/\d+%/);
    expect(html).toContain('data-testid="package-step-almost_ready" data-state="upcoming"');
    expect(html).toContain('data-testid="package-step-ready" data-state="upcoming"');
    expect(html).not.toContain("Final review");
    expect(html).not.toContain("Performing evaluation");
    expect(html).toContain('data-testid="package-step-quick_review" data-state="current"');
    expect(html).toContain("bg-primary");
    expect(html).not.toContain("bg-[#d6e2ff]");
    expect(html).not.toContain("release-indeterminate");
    expect(html).not.toContain('data-testid="flow-stepper"');
    expect(html).toContain("Back to dashboard");
    expect(html).toContain('href="/dashboard"');
    expect(html).not.toMatch(/second|minute|countdown|usually/i);
    expect(html).not.toContain("being certified");
    expect(html).toContain('data-testid="paid-preview"');
    expect(html).toContain('data-testid="email-note"');
    expect(html).not.toContain('data-testid="download-certified"');
    expect(html).not.toContain("Order not found");
    expect(html).not.toContain("flag-correction");
    expect(html).not.toContain("Pay ");
    expect(html).not.toContain("Finalizing your certified PDF");
  });

  it("stays on the quick check when fulfillment is awaiting_review", () => {
    state.order = readyOrder({
      status: "approved",
      payment: { status: "paid" },
      delivery: { status: "approved" },
      fulfillment: "awaiting_review",
      paidAt: "2026-04-01T00:00:00.000Z",
      orderType: "translation",
      service: null,
    });
    const html = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1" }));
    expect(html).toContain("finishing your certified PDF");
    expect(html).toContain('data-testid="paid-preview"');
    expect(html).not.toContain('data-testid="download-certified"');
  });

  it("shows the download button as soon as fulfillment is released", () => {
    state.order = readyOrder({
      status: "paid",
      payment: { status: "paid" },
      delivery: { status: "pending" },
      fulfillment: "released",
      paidAt: "2026-04-01T00:00:00.000Z",
    });
    const html = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1", pendingPayment: true }));
    expect(html).toContain("Your certified translation is ready.");
    expect(html).not.toContain("We also emailed you a copy.");
    expect(html).toContain('data-testid="download-certified"');
    expect(html).toContain('data-testid="package-step-ready" data-state="current"');
    expect(html).toContain('data-testid="start-another-order"');
    expect(html).toContain('data-phase="ready"');
    expect(html).toContain(">Download<");
    expect(html).not.toContain("Evaluated in");
    expect(html).not.toContain("Confirming payment");
    expect(html).not.toContain("finishing your certified PDF");
  });

  it("shows the download button as soon as a paid order is released", () => {
    state.order = readyOrder({
      status: "approved",
      payment: { status: "paid" },
      delivery: { status: "approved" },
      fulfillment: "released",
    });
    const html = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1", pendingPayment: true }));
    expect(html).toContain("Your certified translation is ready.");
    expect(html).toContain('data-testid="download-certified"');
    expect(html).toContain('data-testid="package-step-ready" data-state="current"');
    expect(html).not.toContain('data-testid="flow-stepper"');
    expect(html).not.toContain("Confirming payment");
    expect(html).not.toContain('data-testid="paid-preview"');
  });

  it("confirms payment on Download while the webhook has not recorded it", () => {
    state.order = readyOrder({
      status: "preview_ready",
      payment: null,
      delivery: null,
      fulfillment: null,
      paidAt: null,
    });
    const html = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1", pendingPayment: true }));
    expect(html).toContain("Confirming payment");
    expect(html).toContain("This page keeps checking.");
    expect(html).toContain('data-phase="confirming"');
    expect(html).toContain('data-state="current" data-step="download"');
    expect(html).toContain('data-state="done" data-step="preview"');
    expect(html).not.toContain('data-testid="paid-preview"');
    expect(html).not.toContain('data-testid="download-certified"');
    expect(html).not.toContain("finishing your certified PDF");
    expect(html).not.toMatch(/second|minute|countdown|usually/i);
  });

  it("stays on confirming payment when the order cannot be loaded yet", () => {
    state.order = null;
    state.error = "Order not found";
    state.loading = false;
    const html = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1", pendingPayment: true }));
    expect(html).toContain("Confirming payment");
    expect(html).toContain('data-state="current" data-step="download"');
    expect(html).not.toContain("We couldn't load this order");
    expect(html).not.toContain("Order not found");
    expect(html).not.toContain('data-testid="download-certified"');
  });
});
