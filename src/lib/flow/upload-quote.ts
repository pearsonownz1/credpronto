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
  /** Null when translation is off, or on but the page count is not known yet. */
  translationCents: number | null;
  /** Null when diploma evaluation is off. */
  diplomaCents: number | null;
  /** Null when course-by-course evaluation is off. */
  courseCents: number | null;
  /** Null when neither evaluation is selected. Sum of the selected evaluation fees. */
  evaluationCents: number | null;
  /** Null while a selected translation is still waiting on a page count. */
  totalCents: number | null;
};

/**
 * Translation is the per-page rate times detected pages.
 * An evaluation is the catalog per-degree unit times `degreeCount`.
 */
export function uploadServiceQuote(input: {
  checks: ServiceChecks;
  degreeCount: number;
  pageCount: number | null;
}): UploadServiceQuote {
  const degreeCount = clampDegreeCount(input.degreeCount);
  const translationCents =
    input.checks.translation && input.pageCount != null ? input.pageCount * UNIT_PRICE_CENTS : null;
  const diplomaCents = input.checks.diploma ? degreeCount * DIPLOMA_EVALUATION_CENTS : null;
  const courseCents = input.checks.courseByCourse ? degreeCount * COURSE_BY_COURSE_CENTS : null;
  const evaluationCents =
    diplomaCents == null && courseCents == null ? null : (diplomaCents ?? 0) + (courseCents ?? 0);
  const translationPending = input.checks.translation && input.pageCount == null;
  const totalCents = translationPending ? null : (translationCents ?? 0) + (evaluationCents ?? 0);
  return { degreeCount, translationCents, diplomaCents, courseCents, evaluationCents, totalCents };
}
