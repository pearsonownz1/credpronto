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
  });
});
