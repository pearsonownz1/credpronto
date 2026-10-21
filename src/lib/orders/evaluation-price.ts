import { UNIT_PRICE_CENTS } from "./constants";
import { HttpError } from "./errors";
import { normalizeLanguage } from "./languages";
import type { EvaluationLine, EvaluationResult, EvaluationService } from "./types";

export const DIPLOMA_UNIT_CENTS = 1995;
export const COURSE_BY_COURSE_UNIT_CENTS = 3995;
/** New orders accept this many credentials. Older rows above the cap still price. */
export const MAX_DEGREE_COUNT = 5;

const CUSTOMER_PAGE_FIELDS = [
  "pages",
  "requestedPages",
  "requested_pages",
  "pageCount",
  "billablePages",
  "detectedPages",
] as const;

/** Customers do not send a page quantity. The quote counts pages from the upload. */
export function rejectCustomerPageCount(record: Record<string, unknown>): void {
  for (const field of CUSTOMER_PAGE_FIELDS) {
    if (!(field in record)) continue;
    const value = record[field];
    if (value == null || value === "") continue;
    throw new HttpError("Pages are counted from the upload.", 400);
  }
}

/** Stored on a paid credential evaluation while staff prepare the report. */
export const EVALUATION_REVIEW_REASON = "Credential evaluation is reviewed by staff.";

export function evaluationUnitCents(service: EvaluationService): number {
  return service === "diploma" ? DIPLOMA_UNIT_CENTS : COURSE_BY_COURSE_UNIT_CENTS;
}

/** Known at upload, before language detection or a page count. */
export function evaluationFeeCents(service: EvaluationService, degreeCount: number): number {
  return degreeCount * evaluationUnitCents(service);
}

export type EvaluationPrice = {
  unitPriceCents: number;
  evaluationCents: number;
  translationCents: 0;
  totalCents: number;
};

/** Flat diploma or course-by-course price. The translation page rate is not part of it. */
export function evaluationPrice(order: {
  service: EvaluationService | string | null;
  degreeCount?: number | null;
  addonCents?: number;
}): EvaluationPrice | null {
  if (order.service !== "diploma" && order.service !== "course_by_course") return null;
  if (order.degreeCount == null || !Number.isInteger(order.degreeCount) || order.degreeCount < 1) return null;
  const unitPriceCents = evaluationUnitCents(order.service);
  const evaluationCents = evaluationFeeCents(order.service, order.degreeCount);
  return {
    unitPriceCents,
    evaluationCents,
    translationCents: 0,
    totalCents: evaluationCents + (order.addonCents ?? 0),
  };
}

export function evaluationServiceDescription(service: EvaluationService): string {
  return service === "diploma" ? "Diploma evaluation" : "Course-by-course evaluation";
}

export function parseOrderChoice(fields: {
  orderType: string | null;
  service: string | null;
  degreeCount: string | null;
  includeTranslation?: string | null;
}): {
  orderType: "translation" | "evaluation";
  service: EvaluationService | null;
  degreeCount: number | null;
  /** True only for an evaluation the customer also wants translated. */
  includeTranslation: boolean;
} {
  const orderType = fields.orderType ?? "translation";
  if (orderType === "translation") {
    return { orderType: "translation", service: null, degreeCount: null, includeTranslation: false };
  }
  if (orderType !== "evaluation") {
    throw new HttpError("orderType must be translation or evaluation", 400);
  }
  if (fields.service !== "diploma" && fields.service !== "course_by_course") {
    throw new HttpError("service must be diploma or course_by_course", 400);
  }
  const degreeCount = Number(fields.degreeCount);
  if (!Number.isInteger(degreeCount) || degreeCount < 1 || degreeCount > MAX_DEGREE_COUNT) {
    throw new HttpError(`degreeCount must be an integer from 1 to ${MAX_DEGREE_COUNT}`, 400);
  }
  return {
    orderType: "evaluation",
    service: fields.service,
    degreeCount,
    includeTranslation: parseIncludeTranslation(fields.includeTranslation),
  };
}

function parseIncludeTranslation(value: string | null | undefined): boolean {
  if (value == null || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new HttpError("includeTranslation must be true or false.", 400);
}

/** A non-English source can take an optional certified translation. It is not added unless the customer opts in. */
export function needsBundledTranslation(sourceLanguage: string | null): boolean {
  const language = normalizeLanguage(sourceLanguage);
  return language != null && language !== "en";
}

/**
 * Combined orders cannot be charged until the detected language and page count exist.
 * Paying earlier used to store the evaluation fee alone and drop the translation.
 */
export function checkoutQuotePending(order: {
  service?: string | null;
  includeTranslation?: boolean;
  sourceLanguage?: string | null;
  billablePages?: number | null;
}): boolean {
  if (order.service !== "diploma" && order.service !== "course_by_course") return false;
  if (order.includeTranslation !== true) return false;
  if (!needsBundledTranslation(order.sourceLanguage ?? null)) {
    return normalizeLanguage(order.sourceLanguage ?? null) == null;
  }
  return (order.billablePages ?? 0) < 1;
}

export function evaluationQuote(input: {
  service: EvaluationService;
  degreeCount: number;
  sourceLanguage: string | null;
  billablePages: number;
  /** Charge the translation line only when the customer opted in and the source is not English. */
  includeTranslation?: boolean;
}): {
  evaluationCents: number;
  translationCents: number;
  totalCents: number;
  lineItems: EvaluationLine[];
} {
  const unitAmountCents = evaluationUnitCents(input.service);
  const evaluationCents = evaluationFeeCents(input.service, input.degreeCount);
  const translationCents =
    input.includeTranslation && needsBundledTranslation(input.sourceLanguage)
      ? input.billablePages * UNIT_PRICE_CENTS
      : 0;
  const lineItems: EvaluationLine[] = [
    {
      kind: "evaluation",
      description: evaluationServiceDescription(input.service),
      quantity: input.degreeCount,
      unitAmountCents,
      amountCents: evaluationCents,
    },
  ];
  if (translationCents > 0) {
    lineItems.push({
      kind: "translation",
      description: "Certified translation",
      quantity: input.billablePages,
      unitAmountCents: UNIT_PRICE_CENTS,
      amountCents: translationCents,
    });
  }
  return {
    evaluationCents,
    translationCents,
    totalCents: evaluationCents + translationCents,
    lineItems,
  };
}

/** The amount checkout charges for the evaluation, before add-ons. Translation is included only after opt-in. */
export function evaluationCheckoutTotal(input: {
  service: EvaluationService;
  degreeCount: number;
  sourceLanguage: string | null;
  billablePages: number;
  includeTranslation: boolean;
  addonCents?: number;
}): {
  evaluationCents: number;
  translationCents: number;
  includeTranslation: boolean;
  totalCents: number;
} {
  const includeTranslation = input.includeTranslation && needsBundledTranslation(input.sourceLanguage);
  const quote = evaluationQuote({ ...input, includeTranslation });
  return {
    evaluationCents: quote.evaluationCents,
    translationCents: quote.translationCents,
    includeTranslation,
    totalCents: quote.totalCents + (input.addonCents ?? 0),
  };
}

/**
 * Columns written when an evaluation is priced.
 * `unit_price_cents` is the page rate only while a translation line is charged,
 * so `translation_cents = billable_pages * unit_price_cents` still holds.
 * With no translation line it is the per-degree rate.
 */
export function evaluationPricePatch(input: {
  service: EvaluationService;
  degreeCount: number;
  sourceLanguage: string | null;
  billablePages: number;
  includeTranslation: boolean;
  addonCents?: number;
}): {
  evaluation_cents: number;
  translation_cents: number;
  include_translation: boolean;
  total_cents: number;
  unit_price_cents: number;
} {
  const priced = evaluationCheckoutTotal(input);
  return {
    evaluation_cents: priced.evaluationCents,
    translation_cents: priced.translationCents,
    include_translation: priced.includeTranslation,
    total_cents: priced.totalCents,
    unit_price_cents:
      priced.translationCents > 0 ? UNIT_PRICE_CENTS : evaluationUnitCents(input.service),
  };
}

/** One checkout total: flat per-degree fee plus detected pages when translation is on. */
export function checkoutServiceCharge(order: {
  service: EvaluationService | string | null;
  degreeCount: number | null;
  sourceLanguage: string | null;
  billablePages: number | null;
  includeTranslation: boolean;
}): {
  evaluationCents: number;
  translationCents: number;
  includeTranslation: boolean;
  unitPriceCents: number;
  serviceCents: number;
} | null {
  if (order.service !== "diploma" && order.service !== "course_by_course") return null;
  if (order.degreeCount == null || !Number.isInteger(order.degreeCount) || order.degreeCount < 1) return null;
  const patch = evaluationPricePatch({
    service: order.service,
    degreeCount: order.degreeCount,
    sourceLanguage: order.sourceLanguage,
    billablePages: order.billablePages ?? 0,
    includeTranslation: order.includeTranslation,
  });
  return {
    evaluationCents: patch.evaluation_cents,
    translationCents: patch.translation_cents,
    includeTranslation: patch.include_translation,
    unitPriceCents: patch.unit_price_cents,
    serviceCents: patch.evaluation_cents + patch.translation_cents,
  };
}

/**
 * Customer quote amounts. `billablePages` is the detected page count (read-only).
 * `unitPriceCents` on an evaluation is the per-degree rate. The translation line uses $9.95.
 */
export function customerServiceQuote(order: {
  service: EvaluationService | string | null;
  degreeCount?: number | null;
  sourceLanguage?: string | null;
  billablePages?: number | null;
  unitPriceCents: number;
  evaluationCents?: number | null;
  translationCents?: number | null;
  includeTranslation?: boolean;
  addonCents?: number;
  totalCents?: number | null;
}): {
  evaluation: boolean;
  evaluationCents: number | null;
  translationCents: number | null;
  includeTranslation: boolean;
  unitPriceCents: number;
  totalCents: number | null;
  translationOfferCents: number | null;
  billablePages: number | null;
} {
  const billablePages = order.billablePages ?? null;
  const flat = evaluationPrice({
    service: order.service,
    degreeCount: order.degreeCount,
    addonCents: 0,
  });
  if (!flat || (order.service !== "diploma" && order.service !== "course_by_course")) {
    return {
      evaluation: false,
      evaluationCents: order.evaluationCents ?? null,
      translationCents: order.translationCents ?? null,
      includeTranslation: false,
      unitPriceCents: order.unitPriceCents,
      totalCents: order.totalCents ?? null,
      translationOfferCents: null,
      billablePages,
    };
  }
  const optedIn = order.includeTranslation === true;
  const pages = billablePages ?? 0;
  const pending = checkoutQuotePending({
    service: order.service,
    includeTranslation: optedIn,
    sourceLanguage: order.sourceLanguage,
    billablePages,
  });
  const translationCents =
    optedIn && needsBundledTranslation(order.sourceLanguage ?? null) && pages > 0
      ? pages * UNIT_PRICE_CENTS
      : 0;
  return {
    evaluation: true,
    evaluationCents: flat.evaluationCents,
    translationCents,
    includeTranslation: optedIn,
    unitPriceCents: flat.unitPriceCents,
    totalCents: pending ? null : flat.evaluationCents + translationCents + (order.addonCents ?? 0),
    translationOfferCents: optedIn
      ? null
      : translationOfferCents({
          service: order.service,
          sourceLanguage: order.sourceLanguage ?? null,
          billablePages,
          unitPriceCents: UNIT_PRICE_CENTS,
        }),
    billablePages,
  };
}

/** Page price offered on the quote. Null when this order cannot add a translation. */
export function translationOfferCents(input: {
  service: EvaluationService | null;
  sourceLanguage: string | null;
  billablePages: number | null;
  unitPriceCents: number;
}): number | null {
  if (!input.service || !needsBundledTranslation(input.sourceLanguage)) return null;
  const pages = input.billablePages ?? 0;
  if (pages < 1) return null;
  return pages * input.unitPriceCents;
}

export function lineItemsForOrder(input: {
  service: EvaluationService | null;
  degreeCount: number | null;
  evaluationCents: number | null;
  translationCents: number | null;
  billablePages: number | null;
}): EvaluationLine[] {
  if (!input.service || input.degreeCount == null || input.evaluationCents == null || input.translationCents == null) {
    return [];
  }
  const lineItems: EvaluationLine[] = [
    {
      kind: "evaluation",
      description: evaluationServiceDescription(input.service),
      quantity: input.degreeCount,
      unitAmountCents: evaluationUnitCents(input.service),
      amountCents: input.evaluationCents,
    },
  ];
  if (input.translationCents > 0) {
    lineItems.push({
      kind: "translation",
      description: "Certified translation",
      quantity: input.billablePages ?? 0,
      unitAmountCents: UNIT_PRICE_CENTS,
      amountCents: input.translationCents,
    });
  }
  return lineItems;
}

export function checkoutPriceLines(input: {
  service: EvaluationService | null;
  degreeCount: number | null;
  evaluationCents: number | null;
  translationCents: number | null;
  billablePages: number | null;
  description: string;
  imageUrl: string | null;
}): Array<{
  quantity: number;
  unitAmountCents: number;
  name: string;
  description: string;
  imageUrl: string | null;
}> | null {
  const items = lineItemsForOrder(input);
  if (items.length === 0) return null;
  return items.map((item, index) => ({
    quantity: item.quantity,
    unitAmountCents: item.unitAmountCents,
    name: item.description,
    description:
      item.kind === "evaluation" && input.service
        ? evaluationServiceDescription(input.service)
        : input.description,
    imageUrl: index === 0 ? input.imageUrl : null,
  }));
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  return value;
}

export function parseEvaluationResult(value: unknown): EvaluationResult | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (record.kind === "diploma") {
    if (!Array.isArray(record.credentials)) return null;
    const credentials = [];
    for (const entry of record.credentials) {
      if (!entry || typeof entry !== "object") return null;
      const credential = entry as Record<string, unknown>;
      const applicant = text(credential.applicant);
      const institution = text(credential.institution);
      const country = text(credential.country);
      const name = text(credential.credential);
      const field = text(credential.field);
      const dates = text(credential.dates);
      const usEquivalency = text(credential.usEquivalency);
      const documentsReviewed = stringList(credential.documentsReviewed);
      const equivalencyBasis = text(credential.equivalencyBasis);
      if (!applicant || !institution || !country || !name || !field || !dates || !usEquivalency || !documentsReviewed) {
        return null;
      }
      credentials.push({
        applicant,
        institution,
        country,
        credential: name,
        field,
        dates,
        usEquivalency,
        documentsReviewed,
        ...(equivalencyBasis ? { equivalencyBasis } : {}),
      });
    }
    const pageCount = finite(record.pageCount);
    return pageCount == null ? { kind: "diploma", credentials } : { kind: "diploma", credentials, pageCount };
  }
  if (record.kind !== "course_by_course" || !Array.isArray(record.years)) return null;
  const applicant = text(record.applicant);
  const institution = text(record.institution);
  const country = text(record.country);
  const credential = text(record.credential);
  const gradeScale = text(record.gradeScale);
  const totalHours = finite(record.totalHours);
  const gpa = finite(record.gpa);
  if (!applicant || !institution || !country || !credential || !gradeScale || totalHours == null || gpa == null) {
    return null;
  }
  const years = [];
  for (const entry of record.years) {
    if (!entry || typeof entry !== "object") return null;
    const year = entry as Record<string, unknown>;
    const label = text(year.year);
    if (!label || !Array.isArray(year.courses)) return null;
    const courses = [];
    for (const courseEntry of year.courses) {
      if (!courseEntry || typeof courseEntry !== "object") return null;
      const course = courseEntry as Record<string, unknown>;
      const originalName = text(course.originalName);
      const englishName = text(course.englishName);
      const localCredits = finite(course.localCredits);
      const localGrade = text(course.localGrade);
      const usSemesterHours = finite(course.usSemesterHours);
      const usGrade = text(course.usGrade);
      const gradePoints = finite(course.gradePoints);
      if (!originalName || !englishName || localCredits == null || !localGrade || usSemesterHours == null || !usGrade || gradePoints == null) {
        return null;
      }
      courses.push({ originalName, englishName, localCredits, localGrade, usSemesterHours, usGrade, gradePoints });
    }
    years.push({ year: label, courses });
  }
  const pageCount = finite(record.pageCount);
  const usEquivalency = text(record.usEquivalency);
  const equivalencyBasis = text(record.equivalencyBasis);
  return {
    kind: "course_by_course",
    applicant,
    institution,
    country,
    credential,
    years,
    totalHours,
    gpa,
    gradeScale,
    ...(usEquivalency ? { usEquivalency } : {}),
    ...(equivalencyBasis ? { equivalencyBasis } : {}),
    ...(pageCount == null ? {} : { pageCount }),
  };
}
