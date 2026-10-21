import { describe, expect, it } from "vitest";
import {
  COURSE_BY_COURSE_CENTS,
  DIPLOMA_EVALUATION_CENTS,
} from "@/lib/evaluations/catalog";
import { UNIT_PRICE_CENTS } from "@/lib/orders/constants";
import { clampDegreeCount, uploadServiceQuote } from "./upload-quote";

const translation = { translation: true, diploma: false, courseByCourse: false };
const diploma = { translation: false, diploma: true, courseByCourse: false };
const both = { translation: true, diploma: false, courseByCourse: true };

describe("upload service quote", () => {
  it("prices a translation from the per-page rate and the detected page count", () => {
    expect(uploadServiceQuote({ checks: translation, degreeCount: 1, pageCount: 2 })).toEqual({
      degreeCount: 1,
      translationCents: 2 * UNIT_PRICE_CENTS,
      diplomaCents: null,
      courseCents: null,
      evaluationCents: null,
      totalCents: 2 * UNIT_PRICE_CENTS,
    });
  });

  it("leaves the translation amount unknown until pages are detected", () => {
    expect(uploadServiceQuote({ checks: translation, degreeCount: 1, pageCount: null }).totalCents).toBeNull();
  });

  it("prices each evaluation as the catalog unit times the degree count", () => {
    expect(uploadServiceQuote({ checks: diploma, degreeCount: 1, pageCount: null })).toMatchObject({
      evaluationCents: DIPLOMA_EVALUATION_CENTS,
      totalCents: DIPLOMA_EVALUATION_CENTS,
    });
    expect(uploadServiceQuote({ checks: both, degreeCount: 3, pageCount: 4 })).toEqual({
      degreeCount: 3,
      translationCents: 4 * UNIT_PRICE_CENTS,
      diplomaCents: null,
      courseCents: 3 * COURSE_BY_COURSE_CENTS,
      evaluationCents: 3 * COURSE_BY_COURSE_CENTS,
      totalCents: 4 * UNIT_PRICE_CENTS + 3 * COURSE_BY_COURSE_CENTS,
    });
    expect(
      uploadServiceQuote({
        checks: { translation: false, diploma: true, courseByCourse: true },
        degreeCount: 2,
        pageCount: null,
      }),
    ).toMatchObject({
      diplomaCents: 2 * DIPLOMA_EVALUATION_CENTS,
      courseCents: 2 * COURSE_BY_COURSE_CENTS,
      evaluationCents: 2 * (DIPLOMA_EVALUATION_CENTS + COURSE_BY_COURSE_CENTS),
      totalCents: 2 * (DIPLOMA_EVALUATION_CENTS + COURSE_BY_COURSE_CENTS),
    });
  });

  it("adds every checked service, including both evaluations", () => {
    const all = { translation: true, diploma: true, courseByCourse: true };
    const quote = uploadServiceQuote({ checks: all, degreeCount: 2, pageCount: 3 });
    expect(quote.diplomaCents).toBe(2 * DIPLOMA_EVALUATION_CENTS);
    expect(quote.courseCents).toBe(2 * COURSE_BY_COURSE_CENTS);
    expect(quote.translationCents).toBe(3 * UNIT_PRICE_CENTS);
    expect(quote.totalCents).toBe(
      3 * UNIT_PRICE_CENTS + 2 * DIPLOMA_EVALUATION_CENTS + 2 * COURSE_BY_COURSE_CENTS,
    );
    expect(uploadServiceQuote({ checks: all, degreeCount: 1, pageCount: null }).totalCents).toBeNull();
  });

  it("keeps the degree count between 1 and 5", () => {
    expect(clampDegreeCount(0)).toBe(1);
    expect(clampDegreeCount(1.5)).toBe(1);
    expect(clampDegreeCount(9)).toBe(5);
    expect(uploadServiceQuote({ checks: diploma, degreeCount: 9, pageCount: null }).evaluationCents).toBe(
      5 * DIPLOMA_EVALUATION_CENTS,
    );
  });
});
