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
    addonOptions: addonOptions(1, { serviceType: "evaluation", orderType: "evaluation", service: "diploma" }),
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
    expect(html).not.toContain("reviewed the report");
    expect(html).not.toContain("Confirm the credential details");
    expect(html).toContain('data-step="confirm"');
    expect(html).toContain('data-step="review"');
    expect(html).not.toContain('data-step="quote"');
    expect(html).not.toContain('data-step="preview"');
    expect(html).not.toContain("Expedited");
    expect(html).not.toContain('data-testid="addon-expedited"');
    expect(state.order.addonOptions.map((option) => option.id)).toEqual(["notarization", "mail"]);
    expect(html).not.toContain("per page");
    expect(html).not.toContain("$29.90");
    expect(html).not.toContain("Certificate of accuracy");
    expect(html).toContain("birth-certificate.pdf");
    expect(html).not.toContain("We'll confirm the language");
    expect(html).not.toContain("1 page");
    expect(html).not.toContain("0 pages");
  });

  it("lets a draft evaluation pay the flat fee", () => {
    state.order = { ...checkoutOrder(false), status: "draft" };
    const html = renderToStaticMarkup(createElement(CheckoutView, { token: "token-1" }));
    expect(html).not.toContain("Confirm the credential details");
    expect(html).toContain("Pay $19.95");
    expect(html).toMatch(/<button type="button" data-testid="pay-button" class="/);
    expect(html).not.toContain('data-step="quote"');
    expect(html).not.toContain('data-step="preview"');
  });

  it("shows $29.90 after translation is included", () => {
    state.order = checkoutOrder(true);
    const html = renderToStaticMarkup(createElement(CheckoutView, { token: "token-1" }));
    expect(html).toContain("$29.90");
    expect(html).toContain("Certified translation");
    expect(html).toContain("1 billable page");
    expect(html).toContain("Pay $29.90");
    expect(html).toContain("birth-certificate.pdf");
    expect(html).not.toContain("We'll confirm the language");
    expect(html).not.toContain("1 pages");
  });

  it("never offers Expedited on checkout, even when the payload includes it", () => {
    state.order = {
      ...sampleCustomerOrder(),
      status: "preview_ready",
      addonOptions: [
        ...sampleCustomerOrder().addonOptions,
        { id: "expedited", label: "Expedited", unitCents: 995, per: "page", totalCents: 1990 },
      ],
      addons: ["expedited"],
    };
    const html = renderToStaticMarkup(createElement(CheckoutView, { token: "token-1" }));
    expect(html).not.toContain("Expedited");
    expect(html).not.toContain('data-testid="addon-expedited"');
    expect(html).not.toContain("per page");
    expect(html).toContain("$17.95 per order");
    expect(html).toContain("$12.95 per order");
    expect(html).toContain("acta-nacimiento.pdf");
    expect(html).toContain("Spanish → English");
    expect(html).toContain("2 pages");

    state.order = {
      ...checkoutOrder(false),
      addonOptions: [
        ...checkoutOrder(false).addonOptions,
        { id: "expedited", label: "Expedited", unitCents: 995, per: "order", totalCents: 995 },
      ],
      addons: ["expedited"],
    };
    const evaluation = renderToStaticMarkup(createElement(CheckoutView, { token: "token-1" }));
    expect(evaluation).not.toContain("Expedited");
    expect(evaluation).not.toContain('data-testid="addon-expedited"');
    expect(evaluation).toContain("birth-certificate.pdf");
    expect(evaluation).not.toContain("1 page");
    expect(evaluation).not.toContain("We'll confirm the language");
  });

  it("lists each evaluation file by name when language and pages are still unknown", () => {
    state.order = {
      ...checkoutOrder(false),
      sourceLanguage: null,
      billablePages: 0,
      documents: [
        {
          id: "diploma",
          filename: "diploma.pdf",
          pageCount: null,
          detectedLanguage: null,
          confidence: null,
          uploadPosition: 1,
          appliedPosition: 1,
        },
        {
          id: "transcript",
          filename: "transcript.pdf",
          pageCount: null,
          detectedLanguage: null,
          confidence: null,
          uploadPosition: 2,
          appliedPosition: 2,
        },
      ],
    };
    const html = renderToStaticMarkup(createElement(CheckoutView, { token: "token-1" }));
    expect(html).toContain("diploma.pdf");
    expect(html).toContain("transcript.pdf");
    expect(html).toContain("$19.95");
    expect(html).not.toContain("We'll confirm the language");
    expect(html).not.toContain("0 pages");
    expect(html).not.toContain("1 page");
  });

  it("shows the translation line from the upload page count without waiting for a recount", () => {
    const diploma = checkoutOrder(true);
    const stuck: CustomerOrder = {
      ...diploma,
      status: "draft",
      sourceLanguage: null,
      languageConfirmed: false,
      billablePages: null,
      translationCents: 0,
      totalCents: 1995,
      includeTranslation: true,
      lineItems: checkoutOrder(false).lineItems,
      documents: [
        {
          id: "diploma",
          filename: "diploma.pdf",
          pageCount: 1,
          detectedLanguage: null,
          confidence: null,
          uploadPosition: 1,
          appliedPosition: 1,
        },
      ],
    };

    state.order = stuck;
    const fromDocuments = renderToStaticMarkup(createElement(CheckoutView, { token: "token-1" }));
    expect(fromDocuments).toContain("Buy your credential evaluation");
    expect(fromDocuments).toContain("Certified translation");
    expect(fromDocuments).toContain("$29.90");
    expect(fromDocuments).toContain("Pay $29.90");
    expect(fromDocuments).not.toContain("We're still counting pages.");
    expect(fromDocuments).not.toContain("Counting pages…");
    expect(fromDocuments).not.toContain("Pending");

    state.order = {
      ...stuck,
      billablePages: 1,
      documents: [{ ...stuck.documents[0], pageCount: null }],
    };
    const fromOrder = renderToStaticMarkup(createElement(CheckoutView, { token: "token-1" }));
    expect(fromOrder).toContain("Certified translation");
    expect(fromOrder).toContain("Pay $29.90");
    expect(fromOrder).not.toContain("Counting pages…");

    state.order = {
      ...stuck,
      service: "course_by_course",
      degreeCount: 2,
      evaluationCents: 7990,
      unitPriceCents: 3995,
      totalCents: 7990,
    };
    const course = renderToStaticMarkup(createElement(CheckoutView, { token: "token-1" }));
    expect(course).toContain("Certified translation");
    expect(course).toContain("$89.85");
    expect(course).toContain("Pay $89.85");
    expect(course).not.toContain("Counting pages…");

    state.order = { ...stuck, sourceLanguage: "en", billablePages: 1 };
    const english = renderToStaticMarkup(createElement(CheckoutView, { token: "token-1" }));
    expect(english).toContain("Pay $19.95");
    expect(english).not.toContain("Certified translation");
    expect(english).not.toContain("Counting pages…");
  });
});
