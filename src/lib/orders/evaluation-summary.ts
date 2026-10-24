import { COURSE_BY_COURSE_UNIT_CENTS, DIPLOMA_UNIT_CENTS, MAX_DEGREE_COUNT } from "./evaluation-price";
import { orderEvaluationKinds } from "./service-selection";
import type { EvaluationResult, EvaluationService } from "./types";

export type EvaluationSummary = {
  service: EvaluationService;
  heading: string;
  lines: string[];
};

export type EvaluationGap = {
  service: EvaluationService;
  needsResult: boolean;
  needsFile: boolean;
};

type EvaluationSource = {
  services?: readonly string[] | null;
  service?: string | null;
  includeTranslation?: boolean | null;
  orderType?: string | null;
  serviceType?: string | null;
  evaluationResult?: EvaluationResult | null;
  evaluationResults?: readonly EvaluationResult[] | null;
  serviceFiles?: Partial<Record<EvaluationService, string>> | null;
  finalTranslationPath?: string | null;
  certificationPath?: string | null;
};

/**
 * Credential count used to build a paid evaluation.
 * A stored count wins. Otherwise the paid evaluation fees imply the count
 * (each selected evaluation is its unit price times that count). A paid
 * evaluation with no count stored is one credential, which is what checkout
 * charges when the customer does not pick a higher number.
 */
export function paidEvaluationDegreeCount(order: {
  degreeCount?: number | null;
  evaluationCents?: number | null;
  translationCents?: number | null;
  totalCents?: number | null;
  services?: readonly string[] | null;
  service?: string | null;
  includeTranslation?: boolean | null;
  orderType?: string | null;
  serviceType?: string | null;
}): number | null {
  const kinds = orderEvaluationKinds(order);
  if (kinds.length === 0) return null;
  const stored = order.degreeCount;
  if (stored != null && Number.isInteger(stored) && stored >= 1 && stored <= MAX_DEGREE_COUNT) return stored;

  const unit =
    (kinds.includes("diploma") ? DIPLOMA_UNIT_CENTS : 0) +
    (kinds.includes("course_by_course") ? COURSE_BY_COURSE_UNIT_CENTS : 0);
  const fromFees = degreeCountFromCents(order.evaluationCents, unit);
  if (fromFees) return fromFees;
  if (order.totalCents != null && order.translationCents != null) {
    const fromTotal = degreeCountFromCents(order.totalCents - order.translationCents, unit);
    if (fromTotal) return fromTotal;
  }
  return 1;
}

function degreeCountFromCents(cents: number | null | undefined, unit: number): number | null {
  if (cents == null || !Number.isInteger(cents) || unit < 1 || cents < unit || cents % unit !== 0) return null;
  const count = cents / unit;
  if (count < 1 || count > MAX_DEGREE_COUNT) return null;
  return count;
}

export function orderIsPaid(order: { status: string; paidAt?: string | null }): boolean {
  return (
    Boolean(order.paidAt) ||
    order.status === "paid" ||
    order.status === "approved" ||
    order.status === "delivered"
  );
}

export function evaluationServicePath(orderId: string, service: EvaluationService): string {
  return `${orderId}/${service}-evaluation.pdf`;
}

/**
 * GCS evaluation PDFs at this version use the GCS logo and footer.
 * Older finals paths still show the CredPronto mark and must be rewritten.
 */
export const GCS_EVALUATION_PDF_VERSION = 2;

export function gcsEvaluationPdfPath(orderId: string, kind: EvaluationService): string {
  return `${orderId}/gcs-${kind}-evaluation-v${GCS_EVALUATION_PDF_VERSION}.pdf`;
}

export function isCurrentGcsEvaluationPath(orderId: string, kind: EvaluationService, path: string): boolean {
  return path.trim() === gcsEvaluationPdfPath(orderId, kind);
}

/** Course-by-course wins when both reports were stored. */
export function storedEvaluationFile(
  files: Partial<Record<EvaluationService, string>> | null | undefined,
): { kind: EvaluationService; path: string } | null {
  const course = files?.course_by_course?.trim();
  if (course) return { kind: "course_by_course", path: course };
  const diploma = files?.diploma?.trim();
  if (diploma) return { kind: "diploma", path: diploma };
  return null;
}

/** Diploma first, then course-by-course. A later copy of the same kind replaces the earlier one. */
export function collectedEvaluationResults(order: {
  evaluationResult?: EvaluationResult | null;
  evaluationResults?: readonly EvaluationResult[] | null;
}): EvaluationResult[] {
  const byKind = new Map<EvaluationResult["kind"], EvaluationResult>();
  for (const result of order.evaluationResults ?? []) {
    if (result?.kind === "diploma" || result?.kind === "course_by_course") byKind.set(result.kind, result);
  }
  const primary = order.evaluationResult;
  if (primary?.kind === "diploma" || primary?.kind === "course_by_course") byKind.set(primary.kind, primary);
  const diploma = byKind.get("diploma");
  const course = byKind.get("course_by_course");
  return [diploma, course].filter((item): item is EvaluationResult => item != null);
}

export function evaluationSummaries(results: readonly EvaluationResult[]): EvaluationSummary[] {
  return results.map((result) => {
    if (result.kind === "diploma") {
      const lines = result.credentials.map((credential) => {
        const equivalency = credential.usEquivalency.trim();
        const name = `${credential.credential} (${credential.institution})`;
        return equivalency ? `${name} — ${equivalency}` : name;
      });
      return {
        service: "diploma",
        heading: "Diploma evaluation",
        lines: lines.length > 0 ? lines : ["No diploma credentials stored."],
      };
    }
    const courses = result.years.flatMap((year) =>
      year.courses.map((course) => `${year.year}: ${course.englishName} — ${course.usGrade}`),
    );
    return {
      service: "course_by_course",
      heading: "Course-by-course evaluation",
      lines: [
        `${result.credential} (${result.institution})`,
        `GPA ${result.gpa} · ${result.totalHours} US semester hours`,
        ...(courses.length > 0 ? courses : ["No courses stored."]),
      ],
    };
  });
}

/**
 * A single evaluation with no translation stores its PDF on the order file columns.
 * A certified translation path is not that report.
 */
function legacyEvaluationFile(order: EvaluationSource, kinds: readonly EvaluationService[]): boolean {
  if (kinds.length !== 1 || order.includeTranslation === true) return false;
  const path = order.finalTranslationPath || order.certificationPath || "";
  return /\/evaluation(?:-v\d+)?\.pdf$/.test(path);
}

/** Purchased evaluations that still need a stored result, a PDF, or both. */
export function pendingEvaluationWork(order: EvaluationSource): EvaluationGap[] {
  const kinds = orderEvaluationKinds(order);
  const legacy = legacyEvaluationFile(order, kinds);
  const stored = collectedEvaluationResults(order);
  return kinds.flatMap((service) => {
    const needsResult = !stored.some((result) => result.kind === service);
    const needsFile = !order.serviceFiles?.[service] && !legacy;
    if (!needsResult && !needsFile) return [];
    return [{ service, needsResult, needsFile }];
  });
}

export type ProducedEvaluation = {
  service: EvaluationService;
  result: EvaluationResult;
  /** Null keeps the PDF already stored for this service. */
  path: string | null;
};

/** Columns written for generated reports. Payment, status, and the certified translation stay out. */
export function paidEvaluationPatch(
  order: EvaluationSource,
  produced: readonly ProducedEvaluation[],
): Record<string, unknown> | null {
  if (produced.length === 0) return null;
  const byKind = new Map<EvaluationResult["kind"], EvaluationResult>();
  for (const result of collectedEvaluationResults(order)) byKind.set(result.kind, result);
  const files: Partial<Record<EvaluationService, string>> = { ...(order.serviceFiles ?? {}) };
  for (const item of produced) {
    byKind.set(item.result.kind, item.result);
    if (item.path) files[item.service] = item.path;
  }
  const kinds = orderEvaluationKinds(order);
  const results = kinds.flatMap((kind) => {
    const result = byKind.get(kind);
    return result ? [result] : [];
  });
  const primary = results.find((result) => result.kind === "diploma") ?? results[0] ?? null;
  const patch: Record<string, unknown> = {};
  if (primary) patch.evaluation_result = primary;
  if (results.length > 0) patch.evaluation_results = results;
  if (Object.keys(files).length > 0) patch.service_files = files;
  return Object.keys(patch).length > 0 ? patch : null;
}
