import {
  COURSE_BY_COURSE_CENTS,
  DIPLOMA_EVALUATION_CENTS,
} from "@/lib/evaluations/catalog";
import { UNIT_PRICE_CENTS } from "@/lib/orders/constants";
import type { ServiceChecks } from "./order-choice";

export const MIN_DEGREE_COUNT = 1;
export const MAX_DEGREE_COUNT = 5;

/** The stepper stays on the catalog unit. Values outside 1–5 snap to that range. */
export function clampDegreeCount(value: number): number {
  if (!Number.isInteger(value)) return MIN_DEGREE_COUNT;
  return Math.min(MAX_DEGREE_COUNT, Math.max(MIN_DEGREE_COUNT, value));
}

export type UploadServiceQuote = {
  degreeCount: number;
  /** Null when diploma evaluation is off. */
  diplomaCents: number | null;
  /** Null when course-by-course is off. */
  courseCents: number | null;
  /**
   * Floor shown before the server quote: checked fixed fees, plus one
   * translation page when translation is checked. Billable pages are not
   * known until the server reads the document.
   */
  fromCents: number;
};

/** Fixed services use their catalog unit. Translation contributes one page until the server quotes. */
export function uploadServiceQuote(input: {
  checks: ServiceChecks;
  degreeCount: number;
}): UploadServiceQuote {
  const degreeCount = clampDegreeCount(input.degreeCount);
  const diplomaCents = input.checks.diploma ? degreeCount * DIPLOMA_EVALUATION_CENTS : null;
  const courseCents = input.checks.courseByCourse ? degreeCount * COURSE_BY_COURSE_CENTS : null;
  const fromCents =
    (diplomaCents ?? 0) + (courseCents ?? 0) + (input.checks.translation ? UNIT_PRICE_CENTS : 0);
  return { degreeCount, diplomaCents, courseCents, fromCents };
}
