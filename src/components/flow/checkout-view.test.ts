import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { addonOptions } from "@/lib/orders/addons";
import { evaluationQuote } from "@/lib/orders/evaluation-price";
import { sampleCustomerOrder } from "@/lib/flow/sample-order";
import type { CustomerOrder } from "@/lib/orders/view";

const state = vi.hoisted(() => ({
  order: null as CustomerOrder | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
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

import { CheckoutView } from "./checkout-view";

function checkoutOrder(includeTranslation: boolean): CustomerOrder {
  const quote = evaluationQuote({
    service: "diploma",
    degreeCount: 1,
    sourceLanguage: "es",
    billablePages: 1,
    includeTranslation,
  });
  return {
    ...sampleCustomerOrder(),
    status: "preview_ready",
    orderType: "evaluation",
    service: "diploma",
    degreeCount: 1,
    sourceLanguage: "es",
    billablePages: 1,
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
    evaluationCents: quote.evaluationCents,
    translationCents: quote.translationCents,
    includeTranslation,
    translationOfferCents: includeTranslation ? null : 995,
    totalCents: quote.totalCents,
    lineItems: quote.lineItems,
    addons: [],
    addonOptions: addonOptions(1),
  };
}

describe("evaluation checkout", () => {
  it("shows $19.95 and the evaluation report before the customer opts in", () => {
    state.order = checkoutOrder(false);
    const html = renderToStaticMarkup(createElement(CheckoutView, { token: "token-1" }));
    expect(html).toContain('data-testid="order-total"');
    expect(html).toContain("$19.95");
    expect(html).toContain("Evaluation report");
    expect(html).toContain("CredPronto Certification Team");
    expect(html).toContain("Pay $19.95");
    expect(html).not.toContain("$29.90");
    expect(html).not.toContain("Certificate of accuracy");
  });

  it("shows $29.90 after translation is included", () => {
    state.order = checkoutOrder(true);
    const html = renderToStaticMarkup(createElement(CheckoutView, { token: "token-1" }));
    expect(html).toContain("$29.90");
    expect(html).toContain("Certified translation");
    expect(html).toContain("Pay $29.90");
  });
});
