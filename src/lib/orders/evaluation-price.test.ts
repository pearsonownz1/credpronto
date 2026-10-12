import { describe, expect, it } from "vitest";
import {
  checkoutPriceLines,
  evaluationFeeCents,
  evaluationQuote,
  lineItemsForOrder,
  parseEvaluationResult,
  parseOrderChoice,
} from "./evaluation-price";

describe("evaluation quote", () => {
  it("prices a diploma and adds the translation when the source is not English", () => {
    const quote = evaluationQuote({
      service: "diploma",
      degreeCount: 2,
      sourceLanguage: "fr",
      billablePages: 3,
    });
    expect(quote.evaluationCents).toBe(3990);
    expect(quote.translationCents).toBe(2985);
    expect(quote.totalCents).toBe(6975);
    expect(quote.lineItems).toEqual([
      {
        kind: "evaluation",
        description: "Diploma evaluation",
        quantity: 2,
        unitAmountCents: 1995,
        amountCents: 3990,
      },
      {
        kind: "translation",
        description: "Certified translation",
        quantity: 3,
        unitAmountCents: 995,
        amountCents: 2985,
      },
    ]);
  });

  it("prices an English source once a different target is chosen", () => {
    const quote = evaluationQuote({
      service: "diploma",
      degreeCount: 1,
      sourceLanguage: "en",
      targetLanguage: "es",
      billablePages: 2,
    });
    expect(quote.translationCents).toBe(1990);
    expect(quote.totalCents).toBe(1995 + 1990);
    expect(quote.lineItems.map((item) => item.kind)).toEqual(["evaluation", "translation"]);
  });

  it("prices course-by-course in English without a translation line", () => {
    const quote = evaluationQuote({
      service: "course_by_course",
      degreeCount: 1,
      sourceLanguage: "en",
      billablePages: 4,
    });
    expect(quote.evaluationCents).toBe(3995);
    expect(quote.translationCents).toBe(0);
    expect(quote.totalCents).toBe(3995);
    expect(quote.lineItems).toHaveLength(1);
    expect(quote.lineItems[0]?.description).toBe("Course-by-course evaluation");
  });

  it("rebuilds stored line items and ignores an unfinished quote", () => {
    expect(
      lineItemsForOrder({
        service: "diploma",
        degreeCount: 1,
        evaluationCents: 1995,
        translationCents: 0,
        billablePages: 1,
      }),
    ).toHaveLength(1);
    expect(
      lineItemsForOrder({
        service: null,
        degreeCount: null,
        evaluationCents: null,
        translationCents: null,
        billablePages: null,
      }),
    ).toEqual([]);
  });

  it("prices the evaluation fee at upload, before a translation quote", () => {
    expect(evaluationFeeCents("diploma", 1)).toBe(1995);
    expect(evaluationFeeCents("diploma", 2)).toBe(3990);
    expect(evaluationFeeCents("course_by_course", 3)).toBe(11985);
  });

  it("requires a service and a degree count for an evaluation upload", () => {
    expect(parseOrderChoice({ orderType: null, service: null, degreeCount: null })).toEqual({
      orderType: "translation",
      service: null,
      degreeCount: null,
    });
    expect(
      parseOrderChoice({ orderType: "evaluation", service: "diploma", degreeCount: "2" }),
    ).toEqual({ orderType: "evaluation", service: "diploma", degreeCount: 2 });
    expect(() => parseOrderChoice({ orderType: "evaluation", service: "transcript", degreeCount: "1" })).toThrow(
      /diploma or course_by_course/,
    );
    expect(() => parseOrderChoice({ orderType: "evaluation", service: "diploma", degreeCount: "0" })).toThrow(
      /degreeCount/,
    );
  });

  it("reads a diploma result and rejects a partial one", () => {
    const result = parseEvaluationResult({
      kind: "diploma",
      credentials: [
        {
          applicant: "Ada Lovelace",
          institution: "Université de Paris",
          country: "France",
          credential: "Licence",
          field: "Mathematics",
          dates: "2016–2019",
          usEquivalency: "Bachelor's degree",
          documentsReviewed: ["fr_diplome-licence.pdf"],
        },
      ],
    });
    expect(result?.kind).toBe("diploma");
    expect(parseEvaluationResult({ kind: "diploma", credentials: [{}] })).toBeNull();
    expect(parseEvaluationResult({ ...result, pageCount: 1 })?.pageCount).toBe(1);
  });
});

describe("checkout price lines", () => {
  it("splits an evaluation and its translation into separate Stripe lines", () => {
    const lines = checkoutPriceLines({
      service: "diploma",
      degreeCount: 1,
      evaluationCents: 1995,
      translationCents: 1990,
      billablePages: 2,
      description: "French → English · diploma.pdf · 2 pages",
      imageUrl: "https://files.example/preview.png",
    });
    expect(lines).toEqual([
      {
        quantity: 1,
        unitAmountCents: 1995,
        name: "Diploma evaluation",
        description: "French → English · diploma.pdf · 2 pages",
        imageUrl: "https://files.example/preview.png",
      },
      {
        quantity: 2,
        unitAmountCents: 995,
        name: "Certified translation",
        description: "French → English · diploma.pdf · 2 pages",
        imageUrl: null,
      },
    ]);
    expect(checkoutPriceLines({
      service: null,
      degreeCount: null,
      evaluationCents: null,
      translationCents: null,
      billablePages: 2,
      description: "translation",
      imageUrl: null,
    })).toBeNull();
  });
});
