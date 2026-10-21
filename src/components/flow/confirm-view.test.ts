import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleCustomerOrder } from "@/lib/flow/sample-order";
import { evaluationQuote } from "@/lib/orders/evaluation-price";
import type { CustomerOrder } from "@/lib/orders/view";

const flow = vi.hoisted(() => ({
  order: null as CustomerOrder | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams("lang=es"),
}));

vi.mock("./use-order", () => ({
  useStoredToken: () => "tok",
  useStoredEmail: () => "ada@example.com",
  useCustomerOrder: () => ({
    order: flow.order,
    error: null,
    loading: false,
  }),
}));

import { ConfirmView } from "./confirm-view";

function evaluationOrder(): CustomerOrder {
  const quote = evaluationQuote({
    service: "diploma",
    degreeCount: 1,
    sourceLanguage: "es",
    billablePages: 1,
  });
  const base = sampleCustomerOrder();
  return {
    ...base,
    orderType: "evaluation",
    service: "diploma",
    degreeCount: 1,
    sourceLanguage: "es",
    billablePages: 1,
    evaluationCents: quote.evaluationCents,
    translationCents: quote.translationCents,
    totalCents: quote.totalCents,
    lineItems: quote.lineItems,
    documents: base.documents.slice(0, 1),
    evaluation: {
      kind: "diploma",
      credentials: [
        {
          applicant: "Ada Lovelace",
          institution: "Example University",
          country: "France",
          credential: "Licence",
          field: "Mathematics",
          dates: "2018–2022",
          usEquivalency: "Bachelor's degree",
          documentsReviewed: ["acta-nacimiento.pdf"],
        },
      ],
    },
  };
}

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

function withField(
  order: CustomerOrder,
  documentId: string,
  fieldKey: string,
  originalValue: string | null,
  confirmedValue: string | null = null,
): CustomerOrder {
  return {
    ...order,
    confirmations: [
      ...order.confirmations.filter(
        (field) => !(field.documentId === documentId && field.fieldKey === fieldKey),
      ),
      { documentId, fieldKey, originalValue, confirmedValue },
    ],
  };
}

function selectedFormat(html: string, label: string): string | null {
  const select = html.match(new RegExp(`<select aria-label="${label}"[\\s\\S]*?</select>`));
  const chosen = select?.[0].match(/<option([^>]*?)selected=""([^>]*)>/);
  const value = `${chosen?.[1] ?? ""} ${chosen?.[2] ?? ""}`.match(/value="([^"]+)"/);
  return value?.[1] ?? null;
}

describe("evaluation confirm", () => {
  beforeEach(() => {
    flow.order = evaluationOrder();
  });

  it("opens payment instead of a credential form", () => {
    const html = renderToStaticMarkup(createElement(ConfirmView, { token: "tok" }));
    expect(html).toContain("Opening payment…");
    expect(html).not.toContain("Credential holder name");
    expect(html).not.toContain("Date of birth");
    expect(html).not.toContain("Place of birth");
    expect(html).not.toContain("Continue to payment");
    expect(html).not.toContain('data-testid="continue-to-pay"');
    expect(html).not.toContain("Start my free preview");
    expect(html).toContain('data-step="confirm"');
    expect(html).not.toContain('data-step="quote"');
    expect(html).not.toContain('data-step="preview"');
  });

  it("shows the evaluation on its own line above the total for a bundle", () => {
    const quote = evaluationQuote({
      service: "diploma",
      degreeCount: 1,
      sourceLanguage: "es",
      billablePages: 1,
      includeTranslation: true,
    });
    flow.order = {
      ...evaluationOrder(),
      includeTranslation: true,
      evaluationCents: quote.evaluationCents,
      translationCents: quote.translationCents,
      totalCents: quote.totalCents,
      lineItems: quote.lineItems,
    };
    const html = renderToStaticMarkup(createElement(ConfirmView, { token: "tok" }));
    const evaluationAt = html.indexOf('data-testid="evaluation-price"');
    const totalAt = html.indexOf('data-testid="quote-total"');
    expect(html).toContain("Diploma evaluation");
    expect(html).toContain("$19.95");
    expect(html).toContain("$29.90");
    expect(evaluationAt).toBeGreaterThan(-1);
    expect(totalAt).toBeGreaterThan(evaluationAt);
    expect(html).toContain("Start my free preview");
    expect(html).toContain('data-step="preview"');
    expect(html).not.toContain("Opening payment…");
  });
});

describe("translation date format", () => {
  it("defaults the toggle to DD/MM when the hint and a Mexican acta date say DD/MM", () => {
    let order = sampleCustomerOrder();
    order = withField(order, "acta", "date_of_birth", "19/09/1996", "");
    order = withField(order, "acta", "date_format", "DD/MM", "");
    order = withField(order, "back", "date_format", "MM/DD/YYYY", null);
    flow.order = order;

    const html = renderToStaticMarkup(createElement(ConfirmView, { token: "tok" }));
    expect(selectedFormat(html, "Date format · acta-nacimiento.pdf")).toBe("DD/MM/YYYY");
    expect(html).toContain("Dates in the translation use DD/MM/YYYY");
    expect(selectedFormat(html, "Date format · IMG_4021.HEIC")).toBe("MM/DD/YYYY");
    expect(html).toContain("Dates in the translation use MM/DD/YYYY");
  });

  it("keeps MM/DD when that is the stored reading", () => {
    flow.order = sampleCustomerOrder();
    const html = renderToStaticMarkup(createElement(ConfirmView, { token: "tok" }));
    expect(selectedFormat(html, "Date format · acta-nacimiento.pdf")).toBe("MM/DD/YYYY");
    expect(html).toContain("Dates in the translation use MM/DD/YYYY");
  });
});
