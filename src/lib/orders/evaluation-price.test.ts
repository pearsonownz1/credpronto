import { describe, expect, it } from "vitest";
import {
  checkoutPriceLines,
  checkoutServiceCharge,
  evaluationCheckoutTotal,
  evaluationFeeCents,
  evaluationQuote,
  lineItemsForOrder,
  parseEvaluationResult,
  parseOrderChoice,
  rejectCustomerPageCount,
  translationOfferCents,
} from "./evaluation-price";

describe("evaluation quote", () => {
  it("prices a diploma and adds the translation only after the customer opts in", () => {
    const quote = evaluationQuote({
      service: "diploma",
      degreeCount: 2,
      sourceLanguage: "fr",
      billablePages: 3,
      includeTranslation: true,
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

  it("quotes one Spanish diploma at $19.95 until translation is chosen", () => {
    const quoted = evaluationCheckoutTotal({
      service: "diploma",
      degreeCount: 1,
      sourceLanguage: "es",
      billablePages: 1,
      includeTranslation: false,
    });
    expect(quoted).toEqual({
      evaluationCents: 1995,
      translationCents: 0,
      includeTranslation: false,
      totalCents: 1995,
    });
    expect(evaluationQuote({
      service: "diploma",
      degreeCount: 1,
      sourceLanguage: "es",
      billablePages: 1,
    }).lineItems).toHaveLength(1);

    const optedIn = evaluationCheckoutTotal({
      service: "diploma",
      degreeCount: 1,
      sourceLanguage: "es",
      billablePages: 1,
      includeTranslation: true,
    });
    expect(optedIn).toEqual({
      evaluationCents: 1995,
      translationCents: 995,
      includeTranslation: true,
      totalCents: 2990,
    });
    expect(translationOfferCents({
      service: "diploma",
      sourceLanguage: "es",
      billablePages: 1,
      unitPriceCents: 995,
    })).toBe(995);
    expect(translationOfferCents({
      service: "diploma",
      sourceLanguage: "en",
      billablePages: 1,
      unitPriceCents: 995,
    })).toBeNull();
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
      includeTranslation: false,
    });
    expect(
      parseOrderChoice({ orderType: "evaluation", service: "diploma", degreeCount: "2" }),
    ).toEqual({ orderType: "evaluation", service: "diploma", degreeCount: 2, includeTranslation: false });
    expect(
      parseOrderChoice({
        orderType: "evaluation",
        service: "course_by_course",
        degreeCount: "1",
        includeTranslation: "true",
      }),
    ).toEqual({
      orderType: "evaluation",
      service: "course_by_course",
      degreeCount: 1,
      includeTranslation: true,
    });
    expect(
      parseOrderChoice({ orderType: "translation", service: null, degreeCount: null, includeTranslation: "true" }),
    ).toEqual({
      orderType: "translation",
      service: null,
      degreeCount: null,
      includeTranslation: false,
    });
    expect(() => parseOrderChoice({ orderType: "evaluation", service: "transcript", degreeCount: "1" })).toThrow(
      /diploma or course_by_course/,
    );
    expect(() => parseOrderChoice({ orderType: "evaluation", service: "diploma", degreeCount: "0" })).toThrow(
      /degreeCount/,
    );
    expect(() => parseOrderChoice({ orderType: "evaluation", service: "diploma", degreeCount: "6" })).toThrow(
      /1 to 5/,
    );
    expect(parseOrderChoice({ orderType: "evaluation", service: "course_by_course", degreeCount: "5" }).degreeCount).toBe(
      5,
    );
    expect(() => rejectCustomerPageCount({ pages: 2 })).toThrow(/counted from the upload/);
    expect(() => rejectCustomerPageCount({ degreeCount: "2" })).not.toThrow();
    expect(() =>
      parseOrderChoice({
        orderType: "evaluation",
        service: "diploma",
        degreeCount: "1",
        includeTranslation: "yes",
      }),
    ).toThrow(/includeTranslation/);
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

describe("combined checkout charge", () => {
  it("prices detected pages and each degree at the flat rate on one total", () => {
    const charge = checkoutServiceCharge({
      service: "diploma",
      degreeCount: 3,
      sourceLanguage: "es",
      billablePages: 4,
      includeTranslation: true,
    });
    expect(charge).toEqual({
      evaluationCents: 5985,
      translationCents: 3980,
      includeTranslation: true,
      unitPriceCents: 995,
      serviceCents: 9965,
    });
    const lines = checkoutPriceLines({
      service: "diploma",
      degreeCount: 3,
      evaluationCents: charge?.evaluationCents ?? 0,
      translationCents: charge?.translationCents ?? 0,
      billablePages: 4,
      description: "Spanish to English",
      imageUrl: null,
    });
    const sum = (lines ?? []).reduce((total, line) => total + line.quantity * line.unitAmountCents, 0);
    expect(sum).toBe(charge?.serviceCents);
    expect(lines?.map((line) => line.name)).toEqual(["Diploma evaluation", "Certified translation"]);
  });

  it("leaves an English evaluation as the degree fee only", () => {
    expect(
      checkoutServiceCharge({
        service: "course_by_course",
        degreeCount: 2,
        sourceLanguage: "en",
        billablePages: 3,
        includeTranslation: true,
      }),
    ).toMatchObject({ evaluationCents: 7990, translationCents: 0, serviceCents: 7990, unitPriceCents: 3995 });
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
        description: "Diploma evaluation",
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

  it("uses only the evaluation name when the order has no language or page count", () => {
    expect(
      checkoutPriceLines({
        service: "course_by_course",
        degreeCount: 1,
        evaluationCents: 3995,
        translationCents: 0,
        billablePages: 0,
        description: "Unknown → English · diploma.pdf · 0 pages",
        imageUrl: null,
      }),
    ).toEqual([
      {
        quantity: 1,
        unitAmountCents: 3995,
        name: "Course-by-course evaluation",
        description: "Course-by-course evaluation",
        imageUrl: null,
      },
    ]);
  });
});
