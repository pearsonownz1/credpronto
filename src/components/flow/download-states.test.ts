import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sampleCustomerOrder } from "@/lib/flow/sample-order";
import type { CustomerOrder } from "@/lib/orders/view";

const state = vi.hoisted(() => ({
  order: null as CustomerOrder | null,
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
    error: null,
    loading: false,
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
    expect(html).toContain(
      "Paid. Our certified translator is doing a quick final check, and your PDF will be emailed and appear right here.",
    );
    expect(html).toContain("buyer@example.com");
    expect(html).toContain("when the certified PDF is ready to download.");
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
    expect(html).toContain("quick final check");
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
    expect(html).toContain('data-testid="download-certified"');
    expect(html).not.toContain("Finalizing your certified PDF");
    expect(html).not.toContain("quick final check");
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
    expect(html).not.toContain("Finalizing your certified PDF");
    expect(html).not.toContain('data-testid="paid-preview"');
  });

  it("finalizes on Download while payment has not been recorded yet", () => {
    state.order = readyOrder({
      status: "preview_ready",
      payment: null,
      delivery: null,
      fulfillment: null,
      paidAt: null,
    });
    const html = renderToStaticMarkup(createElement(DownloadStates, { token: "token-1", pendingPayment: true }));
    expect(html).toContain("Finalizing your certified PDF…");
    expect(html).toContain('data-state="current" data-step="download"');
    expect(html).toContain('data-state="done" data-step="preview"');
    expect(html).not.toContain('data-testid="paid-preview"');
    expect(html).not.toContain('data-testid="download-certified"');
    expect(html).not.toContain("quick final check");
  });
});
