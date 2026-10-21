import { describe, expect, it } from "vitest";
import {
  COURSE_BY_COURSE_CENTS,
  DIPLOMA_EVALUATION_CENTS,
} from "@/lib/evaluations/catalog";
import { UNIT_PRICE_CENTS } from "@/lib/orders/constants";
import { clampDegreeCount, uploadServiceQuote } from "./upload-quote";

const translation = { translation: true, diploma: false, courseByCourse: false };
const diploma = { translation: false, diploma: true, courseByCourse: false };
const courseAndTranslation = { translation: true, diploma: false, courseByCourse: true };

describe("upload service quote", () => {
  it("prices translation as one page until the server quotes the document", () => {
    expect(uploadServiceQuote({ checks: translation, degreeCount: 1 })).toEqual({
      degreeCount: 1,
      diplomaCents: null,
      courseCents: null,
      fromCents: UNIT_PRICE_CENTS,
    });
  });

  it("prices each evaluation as the catalog unit times the degree count", () => {
    expect(uploadServiceQuote({ checks: diploma, degreeCount: 1 })).toMatchObject({
      diplomaCents: DIPLOMA_EVALUATION_CENTS,
      courseCents: null,
      fromCents: DIPLOMA_EVALUATION_CENTS,
    });
    expect(
      uploadServiceQuote({
        checks: { translation: true, diploma: true, courseByCourse: false },
        degreeCount: 2,
      }),
    ).toEqual({
      degreeCount: 2,
      diplomaCents: 2 * DIPLOMA_EVALUATION_CENTS,
      courseCents: null,
      fromCents: 2 * DIPLOMA_EVALUATION_CENTS + UNIT_PRICE_CENTS,
    });
    expect(uploadServiceQuote({ checks: courseAndTranslation, degreeCount: 3 })).toEqual({
      degreeCount: 3,
      diplomaCents: null,
      courseCents: 3 * COURSE_BY_COURSE_CENTS,
      fromCents: 3 * COURSE_BY_COURSE_CENTS + UNIT_PRICE_CENTS,
    });
  });

  it("adds every checked fixed service to one translation page", () => {
    expect(
      uploadServiceQuote({
        checks: { translation: true, diploma: true, courseByCourse: true },
        degreeCount: 1,
      }).fromCents,
    ).toBe(DIPLOMA_EVALUATION_CENTS + COURSE_BY_COURSE_CENTS + UNIT_PRICE_CENTS);
  });

  it("keeps the degree count between 1 and 5", () => {
    expect(clampDegreeCount(0)).toBe(1);
    expect(clampDegreeCount(1.5)).toBe(1);
    expect(clampDegreeCount(9)).toBe(5);
    expect(uploadServiceQuote({ checks: diploma, degreeCount: 9 }).diplomaCents).toBe(
      5 * DIPLOMA_EVALUATION_CENTS,
    );
  });
});
