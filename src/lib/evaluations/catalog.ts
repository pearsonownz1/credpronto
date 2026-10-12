import { UNIT_PRICE_CENTS } from "@/lib/orders/constants";
import { formatMoney } from "@/lib/flow/pricing";

/** U.S. equivalency of the degree. One price per degree. */
export const DIPLOMA_EVALUATION_CENTS = 1995;

/** Each course converted to U.S. semester hours and grade, plus GPA. One price per degree. */
export const COURSE_BY_COURSE_CENTS = 3995;

export const EVALUATIONS_CANONICAL_URL = "https://www.credpronto.com/evaluations";

export const DIPLOMA_PRICE_LABEL = `${formatMoney(DIPLOMA_EVALUATION_CENTS)} per degree`;
export const COURSE_BY_COURSE_PRICE_LABEL = `${formatMoney(COURSE_BY_COURSE_CENTS)} per degree`;
export const TRANSLATION_PAGE_LABEL = `${formatMoney(UNIT_PRICE_CENTS)}/page`;

export const DIPLOMA_DETAIL = "U.S. equivalency of the degree";
export const COURSE_BY_COURSE_DETAIL =
  "Each course converted to U.S. semester hours and grade, plus GPA.";

/** Certified translation is optional and is charged only after the customer opts in. */
export const TRANSLATION_ADDON =
  `You can add a certified translation at ${TRANSLATION_PAGE_LABEL}. It is charged only if you choose it, on the same invoice.`;

export const DIPLOMA_OFFER = `Diploma evaluation is ${DIPLOMA_PRICE_LABEL} (${DIPLOMA_DETAIL}).`;

const courseParenthetical = (() => {
  const detail = COURSE_BY_COURSE_DETAIL.replace(/\.$/, "");
  return detail.charAt(0).toLowerCase() + detail.slice(1);
})();

export const COURSE_BY_COURSE_OFFER = `Course-by-course is ${COURSE_BY_COURSE_PRICE_LABEL} (${courseParenthetical}).`;

export const EVALUATION_STEPS = [
  {
    title: "1 · Upload",
    detail: "Send the diploma or transcript for the degree.",
  },
  {
    title: "2 · Preview",
    detail: "Read the watermarked report before you pay.",
  },
  {
    title: "3 · Pay",
    detail: "The evaluation and any translation share one invoice.",
  },
  {
    title: "4 · Sign-off",
    detail: "Staff sign off before the report is released.",
  },
] as const;

const TURNAROUND_CLAIM =
  /10[\s-]*min|ten minutes|same[\s-]*day|within minutes|instant(?:ly)?|hours or less/i;

/** Marketing lines for evaluations. None of them promise a clock time. */
export function evaluationMarketingLines(): string[] {
  return [
    DIPLOMA_OFFER,
    COURSE_BY_COURSE_OFFER,
    TRANSLATION_ADDON,
    ...EVALUATION_STEPS.flatMap((step) => [step.title, step.detail]),
    "The preview is watermarked and is not for official use.",
    "A credential evaluator signs the report before CredPronto releases it.",
  ];
}

export function evaluationCopyPromisesTurnaround(lines: readonly string[] = evaluationMarketingLines()) {
  return lines.some((line) => TURNAROUND_CLAIM.test(line));
}
