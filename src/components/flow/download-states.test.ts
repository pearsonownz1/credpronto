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

  it("shows the evaluation tracker under the order id, including a translation bundle", () => {
    state.order = readyOrder({
      status: "paid",
      payment: { status: "paid" },
      delivery: { status: "pending" },
      fulfillment: "awaiting_review",
      orderType: "evaluation",
      service: "diploma",
      degreeCount: 1,
      evaluationCents: 1995,
      translationCents: 995,
      includeTranslation: true,
      totalCents: 2990,
    });
    const html = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1" }));
    expect(html).toContain("Order CP-24817");
    expect(html).toContain('data-testid="evaluation-tracker"');
    expect(html).toContain('data-status="under_review"');
    expect(html).toContain("Under review");
    expect(html).toContain("Performing evaluation");
    expect(html).toContain("Performing layout");
    expect(html).toContain("Evaluation complete");
    expect(html).toContain("We&#x27;re checking your documents.");
    expect(html).toContain('data-step="under_review" data-state="current"');
    expect(html).toContain('data-step="performing_evaluation" data-state="upcoming"');
    expect(html).toContain("animate-ping");
    expect(html).toContain("motion-reduce:animate-none");
    expect(html).toContain("bg-[#1F5EFF]");
    expect(html).not.toContain("In review");
    expect(html).not.toContain("%");
    expect(html).not.toContain('data-testid="download-evaluation"');
    expect(html).toContain('data-testid="evaluation-review"');
    expect(html).toContain('data-state="current" data-step="download"');
    expect(html).toContain('data-step="pay"');
    expect(html).not.toContain('data-step="review"');
    expect(html).not.toContain("finishing your certified PDF");
    expect(html).not.toContain('data-testid="paid-preview"');
    expect(html).not.toContain('data-testid="download-certified"');
  });

  it("shows Paid and the certified translation download while the evaluation tracker stays up", () => {
    state.order = readyOrder({
      status: "paid",
      payment: { status: "paid" },
      delivery: { status: "pending" },
      fulfillment: "awaiting_review",
      orderType: "evaluation",
      service: "diploma",
      degreeCount: 1,
      evaluationCents: 1995,
      translationCents: 995,
      includeTranslation: true,
      translationReady: true,
      totalCents: 2990,
      evaluationStatus: "under_review",
    });
    const html = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1" }));
    const paidAt = html.indexOf("Paid $29.90");
    const downloadAt = html.indexOf('data-testid="download-certified"');
    const trackerAt = html.indexOf('data-testid="evaluation-tracker"');
    expect(paidAt).toBeGreaterThan(-1);
    expect(downloadAt).toBeGreaterThan(paidAt);
    expect(trackerAt).toBeGreaterThan(downloadAt);
    expect(html).toContain('data-testid="bundle-translation"');
    expect(html).toContain("Certified translation · PDF");
    expect(html).toContain('data-status="under_review"');
    expect(html).not.toContain("Buy &amp; download");
    expect(html).not.toContain("Opening checkout");
  });

  it("follows a stored evaluation status and keeps the download disabled until the file is ready", () => {
    state.order = readyOrder({
      status: "paid",
      payment: { status: "paid" },
      delivery: { status: "pending" },
      fulfillment: "awaiting_review",
      orderType: "evaluation",
      service: "diploma",
      degreeCount: 1,
      evaluationCents: 1995,
      translationCents: 0,
      totalCents: 1995,
      evaluationStatus: "performing_evaluation",
      evaluationStatusAt: { under_review: "2026-10-21T17:02:00.000Z" },
    });
    const working = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1" }));
    expect(working).toContain('data-status="performing_evaluation"');
    expect(working).toContain("An evaluator is working on your evaluation.");
    expect(working).toContain('dateTime="2026-10-21T17:02:00.000Z"');
    expect(working).toContain('stroke="#1F5EFF"');
    expect(working).not.toContain('data-testid="download-evaluation"');

    state.order = readyOrder({
      status: "paid",
      payment: { status: "paid" },
      delivery: { status: "pending" },
      fulfillment: "awaiting_review",
      orderType: "evaluation",
      service: "course_by_course",
      degreeCount: 1,
      evaluationCents: 3995,
      translationCents: 0,
      totalCents: 3995,
      evaluationStatus: "evaluation_complete",
      evaluationStatusAt: {
        under_review: "2026-10-21T17:02:00.000Z",
        performing_evaluation: "2026-10-21T17:11:00.000Z",
        performing_layout: "2026-10-21T17:24:00.000Z",
      },
    });
    const waiting = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1" }));
    expect(waiting).toContain("Evaluation complete");
    expect(waiting).toContain('data-testid="download-evaluation"');
    expect(downloadButton(waiting)).toMatch(/\sdisabled(?:=|>|\s)/);
    expect(waiting).toContain("h-[52px]");
    expect(waiting).toContain("bg-primary");
    expect(waiting).not.toContain("We&#x27;re formatting your report.");
  });

  it("links a finished evaluation to the existing download", () => {
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
    expect(html).toContain('data-status="evaluation_complete"');
    expect(downloadButton(html)).not.toMatch(/\sdisabled(?:=|>|\s)/);
    expect(html).not.toContain("Your credential evaluation is ready.");
    expect(html).toContain('data-state="current" data-step="download"');
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
    expect(html).toContain('data-step="download"');
    expect(html).toContain('data-state="current"');
    expect(html).not.toContain('data-state="done" data-step="download"');
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
    expect(html).toContain("nothing you need to do");
    expect(html).toContain("buyer@example.com");
    expect(html).toContain("when your certified PDF is ready.");
    expect(html).toContain("You can close this page.");
    expect(html).toContain('data-testid="paid-receipt"');
    expect(html).toContain("Paid $19.90 on April 1, 2026");
    expect(html).toContain('data-testid="release-progress"');
    expect(html).toContain('aria-valuetext="Final review"');
    expect(html).not.toContain("aria-valuenow");
    expect(html).not.toMatch(/\d+%/);
    expect(html).toContain('data-testid="release-step-paid" data-state="done"');
    expect(html).toContain('data-testid="release-step-translated" data-state="done"');
    expect(html).toContain('data-testid="release-step-review" data-state="current"');
    expect(html).toContain('data-testid="release-step-ready" data-state="upcoming"');
    expect(html).toContain("release-indeterminate");
    expect(html).toContain("motion-reduce:animate-none");
    expect(html).toContain("Back to dashboard");
    expect(html).toContain('href="/account"');
    expect(html).not.toMatch(/second|minute|countdown|usually/i);
    expect(html).not.toContain("being certified");
    expect(html).toContain('data-testid="paid-preview"');
    expect(html).toContain('data-testid="email-note"');
    expect(html).toContain('data-state="done" data-step="preview"');
    expect(html).toContain('data-state="current" data-step="download"');
    expect(html).not.toContain('data-state="done" data-step="download"');
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
    expect(html).toContain("We also emailed it to maria.ruiz@email.com.");
    expect(html).toContain('data-testid="download-certified"');
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
    expect(html).toContain('data-state="current" data-step="download"');
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
