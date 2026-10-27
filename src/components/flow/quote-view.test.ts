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
  it("explains an image_quality hold without showing the slug", () => {
    const html = htmlFor(
      englishReview({
        sourceLanguage: "ar",
        targetLanguage: "en",
        reviewReason: "image_quality",
      }),
    );
    expect(html).toContain("This photo looks blurry, dark, or cropped. Please upload a clearer photo or scan.");
    expect(html).not.toContain("image_quality");
  });

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

  it("puts a turnaround row under Preview and leaves the file card without that byline", () => {
    const html = htmlFor(sampleCustomerOrder());
    const preview = html.indexOf(">Preview<");
    const turnaround = html.indexOf('data-testid="quote-turnaround"');
    const total = html.indexOf('data-testid="quote-total"');
    expect(preview).toBeGreaterThan(-1);
    expect(total).toBeGreaterThan(preview);
    expect(turnaround).toBeGreaterThan(total);
    expect(html).toContain("Turnaround time");
    expect(html).toContain("uppercase");
    expect(html).toContain("Translation ready in about 1 minute.");
    expect(html).not.toContain("Evaluation ready in about 5 minutes.");
    expect(html).not.toContain("3 minutes");
    expect(html).toContain(">Fast<");
    expect(html).toContain("bg-[#EEF3FF]");
    expect(html).toContain("rounded-[4px]");
    expect(html).toContain("p-3.5");
    expect(html).toContain("text-[22px]");
    expect(html).toContain('width="20"');
    expect(html).toContain("text-primary");
    expect(html).not.toContain('data-testid="file-turnaround"');
    expect(html).not.toContain("10 minutes");
    expect(html).not.toContain('data-testid="file-thumb-skeleton"');
    expect(html).not.toContain('data-testid="page-details"');
    expect(html).not.toContain('data-testid="page-thumb"');
    expect(html).not.toContain("page-skip-");
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
    expect(html).not.toContain('data-testid="account-card"');
  });

  it("offers an account before Continue and leaves Continue in place", () => {
    const html = renderToStaticMarkup(
      createElement(QuoteBody, {
        order: sampleCustomerOrder(),
        token: "tok",
        onReplaced: () => {},
        showAccount: true,
      }),
    );
    expect(html).toContain("Create your account to track your order");
    expect(html).toContain('data-testid="account-card"');
    expect(html).toContain('data-testid="continue"');
    expect(html.indexOf('data-testid="account-card"')).toBeLessThan(html.indexOf('data-testid="continue"'));
    expect(html).toContain("#1F5EFF");
    expect(html).toContain("rounded-[4px]");
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
    expect(html).toContain("Diploma evaluation");
    expect(html).toContain("Evaluation report");
    expect(html).not.toContain("1 degree ×");
    expect(html).not.toContain(QUOTE_BILLING_NOTE);
    expect(html).not.toContain('data-testid="file-billable"');
    expect(html).not.toContain("Page details");
    expect(html).not.toContain("$29.90");
    expect(html).toContain('data-testid="continue"');
    expect(html).not.toContain("Pay only after");
    expect(html).not.toContain("3 minutes");
    expect(html).toContain("Evaluation ready in about 5 minutes.");
    expect(html).not.toContain("Translation ready in about 1 minute.");
    expect(html).not.toContain(">Preview<");
    expect(html).toContain("Pay from this quote");
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
    expect(html).toContain("Diploma evaluation");
    expect(html).toContain("Certified translation, 1 billable page");
    expect(html).toContain("$9.95");
    expect(html).toContain('data-testid="include-translation"');
    expect(html).toMatch(/data-testid="include-translation"[^>]*checked/);
    expect(html).toContain('data-testid="file-billable"');
    expect(html).toContain(">Preview<");
    expect(html).toContain("Pay only after");
    expect(html).not.toContain("Pay from this quote");
    expect(html).toContain("Evaluation ready in about 5 minutes.");
    expect(html).not.toContain("Translation ready in about 1 minute.");
  });

  it("uses the evaluation time when the service list includes a diploma", () => {
    const html = htmlFor({
      ...sampleCustomerOrder(),
      orderType: "translation",
      service: null,
      services: ["translation", "course_by_course"],
      includeTranslation: false,
    });
    expect(html).toContain("Evaluation ready in about 5 minutes.");
    expect(html).not.toContain("Translation ready in about 1 minute.");
  });
});
