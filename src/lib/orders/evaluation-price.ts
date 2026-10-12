import { UNIT_PRICE_CENTS } from "./constants";
import { HttpError } from "./errors";
import type { EvaluationLine, EvaluationResult, EvaluationService } from "./types";

export const DIPLOMA_UNIT_CENTS = 1995;
export const COURSE_BY_COURSE_UNIT_CENTS = 3995;

export function evaluationUnitCents(service: EvaluationService): number {
  return service === "diploma" ? DIPLOMA_UNIT_CENTS : COURSE_BY_COURSE_UNIT_CENTS;
}

/** Known at upload, before language detection or a page count. */
export function evaluationFeeCents(service: EvaluationService, degreeCount: number): number {
  return degreeCount * evaluationUnitCents(service);
}

export function evaluationServiceDescription(service: EvaluationService): string {
  return service === "diploma" ? "Diploma evaluation" : "Course-by-course evaluation";
}

export function parseOrderChoice(fields: {
  orderType: string | null;
  service: string | null;
  degreeCount: string | null;
}): {
  orderType: "translation" | "evaluation";
  service: EvaluationService | null;
  degreeCount: number | null;
} {
  const orderType = fields.orderType ?? "translation";
  if (orderType === "translation") {
    return { orderType: "translation", service: null, degreeCount: null };
  }
  if (orderType !== "evaluation") {
    throw new HttpError("orderType must be translation or evaluation", 400);
  }
  if (fields.service !== "diploma" && fields.service !== "course_by_course") {
    throw new HttpError("service must be diploma or course_by_course", 400);
  }
  const degreeCount = Number(fields.degreeCount);
  if (!Number.isInteger(degreeCount) || degreeCount < 1) {
    throw new HttpError("degreeCount must be an integer of at least 1", 400);
  }
  return { orderType: "evaluation", service: fields.service, degreeCount };
}

export function needsBundledTranslation(sourceLanguage: string | null): boolean {
  return sourceLanguage != null && sourceLanguage !== "en";
}

export function evaluationQuote(input: {
  service: EvaluationService;
  degreeCount: number;
  sourceLanguage: string | null;
  billablePages: number;
}): {
  evaluationCents: number;
  translationCents: number;
  totalCents: number;
  lineItems: EvaluationLine[];
} {
  const unitAmountCents = evaluationUnitCents(input.service);
  const evaluationCents = evaluationFeeCents(input.service, input.degreeCount);
  const translationCents = needsBundledTranslation(input.sourceLanguage)
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
      if (!applicant || !institution || !country || !name || !field || !dates || !usEquivalency || !documentsReviewed) {
        return null;
      }
      credentials.push({ applicant, institution, country, credential: name, field, dates, usEquivalency, documentsReviewed });
    }
    return { kind: "diploma", credentials };
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
  return { kind: "course_by_course", applicant, institution, country, credential, years, totalHours, gpa, gradeScale };
}
