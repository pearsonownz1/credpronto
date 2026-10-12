import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sampleCustomerOrder } from "@/lib/flow/sample-order";
import { CJK_PAGE_RULE } from "@/lib/orders/billing";
import { QUOTE_BILLING_NOTE } from "@/lib/flow/present";
import { evaluationQuote } from "@/lib/orders/evaluation-price";
import type { CustomerOrder } from "@/lib/orders/view";
import { QuoteBody } from "./quote-view";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

function englishReview(patch: Partial<CustomerOrder> = {}): CustomerOrder {
  return {
    ...sampleCustomerOrder(),
    status: "needs_review",
    sourceLanguage: "en",
    targetLanguage: "en",
    reviewReason:
      "The document appears to already be in English. A reviewer will confirm whether a translation is needed.",
    lineItems: [],
    billablePages: 0,
    totalCents: null,
    documents: [
      {
        id: "cv",
        filename: "GuyPearsonCV_under2MB.pdf",
        pageCount: 3,
        detectedLanguage: "en",
        confidence: 0.99,
        uploadPosition: 1,
        appliedPosition: 1,
      },
    ],
    ...patch,
  };
}

function htmlFor(order: CustomerOrder) {
  return renderToStaticMarkup(
    createElement(QuoteBody, { order, token: "tok", onReplaced: () => {} }),
  );
}

describe("quote step actions", () => {
  it("hides Continue for an English needs_review order with no line items", () => {
    const html = htmlFor(englishReview());
    expect(html).not.toContain('data-testid="continue"');
    expect(html).toContain('data-testid="target-language"');
    expect(html).toContain("Update language");
    expect(html).toContain('data-testid="update-language"');
    expect(html).toContain("disabled");
  });

  it("still hides Continue when that review has a stored total but no line items", () => {
    const html = htmlFor(
      englishReview({
        billablePages: 3,
        totalCents: 2985,
        unitPriceCents: 995,
      }),
    );
    expect(html).not.toContain('data-testid="continue"');
    expect(html).toContain("Update language");
    expect(html).toContain("$29.85");
  });

  it("shows the CJK page rule without a 400-unit density", () => {
    const html = htmlFor({
      ...sampleCustomerOrder(),
      sourceLanguage: "zh",
      pageRule: CJK_PAGE_RULE,
    });
    expect(html).toContain(QUOTE_BILLING_NOTE);
    expect(html).toContain("1,000 characters");
    expect(html).not.toContain("400 units");
    expect(CJK_PAGE_RULE).not.toContain("400 units");
  });

  it("shows the turnaround beside the file name", () => {
    const html = htmlFor(sampleCustomerOrder());
    expect(html).toContain('data-testid="file-turnaround"');
    expect(html).toContain("Ready in a few minutes");
    expect(html).not.toContain("10 minutes");
    expect(html).toContain("text-[var(--cp-ok)]");
    expect(html).toContain("md:flex-row");
    expect(html).toContain('data-testid="file-thumb-skeleton"');
    expect(html).toContain('data-testid="page-viewer"');
    expect(html).toContain("md:w-[420px]");
    expect(html).toContain("Page 1");
    expect(html).not.toContain("#fbf8ef");
    expect(html).not.toContain("#e9e4d6");
  });

  it("shows Continue for a quoted order with a page line and a total", () => {
    const html = htmlFor(sampleCustomerOrder());
    expect(html).toContain('data-testid="continue"');
    expect(html).toContain('href="/confirm?lang=es&amp;target=en"');
    expect(html).not.toContain('data-testid="update-language"');
  });

  it("shows Continue for a quoted order with line items and a total", () => {
    const html = htmlFor({
      ...sampleCustomerOrder(),
      billablePages: 0,
      totalCents: 1990,
      lineItems: [
        {
          kind: "translation",
          description: "Certified translation",
          quantity: 2,
          unitAmountCents: 995,
          amountCents: 1990,
        },
      ],
    });
    expect(html).toContain('data-testid="continue"');
    expect(html).toContain("$19.90");
  });

  it("quotes a diploma at $19.95 and shows the translation as an opt-in", () => {
    const quote = evaluationQuote({
      service: "diploma",
      degreeCount: 1,
      sourceLanguage: "es",
      billablePages: 1,
    });
    const html = htmlFor({
      ...sampleCustomerOrder(),
      orderType: "evaluation",
      service: "diploma",
      degreeCount: 1,
      sourceLanguage: "es",
      billablePages: 1,
      evaluationCents: quote.evaluationCents,
      translationCents: quote.translationCents,
      includeTranslation: false,
      translationOfferCents: 995,
      totalCents: quote.totalCents,
      lineItems: quote.lineItems,
    });
    expect(html).toContain('data-testid="quote-total"');
    expect(html).toContain("$19.95");
    expect(html).toContain('data-testid="include-translation"');
    expect(html).toContain("Certified translation");
    expect(html).toContain("$9.95");
    expect(html).toContain("Evaluation report");
    expect(html).not.toContain("$29.90");
    expect(html).toContain('data-testid="continue"');
  });

  it("shows the $29.90 total after the customer opts into translation", () => {
    const quote = evaluationQuote({
      service: "diploma",
      degreeCount: 1,
      sourceLanguage: "es",
      billablePages: 1,
      includeTranslation: true,
    });
    const html = htmlFor({
      ...sampleCustomerOrder(),
      orderType: "evaluation",
      service: "diploma",
      degreeCount: 1,
      sourceLanguage: "es",
      billablePages: 1,
      evaluationCents: quote.evaluationCents,
      translationCents: quote.translationCents,
      includeTranslation: true,
      translationOfferCents: 995,
      totalCents: quote.totalCents,
      lineItems: quote.lineItems,
    });
    expect(html).toContain("$29.90");
    expect(html).toContain('data-testid="include-translation"');
    expect(html).toMatch(/data-testid="include-translation"[^>]*checked/);
  });
});
