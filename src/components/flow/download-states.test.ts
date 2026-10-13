import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EVALUATION_REVIEW_COPY } from "@/lib/flow/present";
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
  });

  it("shows the evaluator wait and switches the step to Review", () => {
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
    });
    const html = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1" }));
    expect(html).toContain(EVALUATION_REVIEW_COPY.replaceAll("'", "&#x27;"));
    expect(html).toContain('data-testid="evaluation-review"');
    expect(html).toContain('data-state="current" data-step="review"');
    expect(html).not.toContain("Quick final check");
    expect(html).not.toContain('data-testid="paid-preview"');
    expect(html).not.toContain('data-step="preview"');
  });

  it("keeps the certified translation and certification page for a translation", () => {
    state.order = readyOrder({ orderType: "translation", service: null });
    const html = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1" }));
    expect(html).toContain("Your certified translation is ready.");
    expect(html).toContain("birth-certificate-EN-certified.pdf");
    expect(html).toContain('data-testid="download-certified"');
    expect(html).toContain('data-testid="download-certification"');
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
    expect(html).toContain("Quick final check");
    expect(html).toContain("The certified PDF is not released yet.");
    expect(html).toContain("buyer@example.com");
    expect(html).toContain("when it is released.");
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
    expect(html).toContain("Quick final check");
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
    expect(html).not.toContain("Confirming payment");
    expect(html).not.toContain("Quick final check");
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
    expect(html).not.toContain("Quick final check");
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
