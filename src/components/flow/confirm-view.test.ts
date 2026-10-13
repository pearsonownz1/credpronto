import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sampleCustomerOrder } from "@/lib/flow/sample-order";
import { evaluationQuote } from "@/lib/orders/evaluation-price";
import type { CustomerOrder } from "@/lib/orders/view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
  useSearchParams: () => new URLSearchParams("lang=es"),
}));

vi.mock("./use-order", () => ({
  useStoredToken: () => "tok",
  useStoredEmail: () => "ada@example.com",
  useCustomerOrder: () => ({
    order: evaluationOrder(),
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

describe("evaluation confirm", () => {
  it("asks for the credential instead of birth-certificate fields", () => {
    const html = renderToStaticMarkup(createElement(ConfirmView, { token: "tok" }));
    expect(html).toContain("Credential holder name");
    expect(html).toContain("School");
    expect(html).toContain("Degree");
    expect(html).toContain("Dates attended");
    expect(html).toContain("Date awarded");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Example University");
    expect(html).toContain("Licence");
    expect(html).toContain("Diploma evaluation");
    expect(html).toContain("$19.95");
    expect(html).not.toContain("Date of birth");
    expect(html).not.toContain("Place of birth");
    expect(html).not.toContain("Father");
    expect(html).not.toContain("Mother");
    expect(html).toContain("Continue to payment");
    expect(html).toContain('data-testid="continue-to-pay"');
    expect(html).not.toContain("Start my free preview");
    expect(html).toContain('data-step="review"');
    expect(html).not.toContain('data-step="preview"');
  });
});
