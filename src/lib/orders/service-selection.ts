import { UNIT_PRICE_CENTS } from "./constants";
import { HttpError } from "./errors";
import { normalizeLanguage } from "./languages";
import type { EvaluationLine, EvaluationService } from "./types";

/** Upload checkboxes. Stored in this order. */
export const CATALOG_SERVICES = ["translation", "diploma", "course_by_course"] as const;

export type CatalogService = (typeof CATALOG_SERVICES)[number];

const DIPLOMA_CENTS = 1995;
const COURSE_CENTS = 3995;

const CATALOG_SET = new Set<string>(CATALOG_SERVICES);

export type PricedServices = {
  services: CatalogService[];
  degreeCount: number | null;
  orderType: "translation" | "evaluation";
  /** Set only when exactly one evaluation is selected. Both evaluations leave this null. */
  service: EvaluationService | null;
  /** True when translation is selected together with an evaluation. */
  includeTranslation: boolean;
  diplomaCents: number;
  courseCents: number;
  /** Sum of the selected evaluation fees. Zero when translation is the only service. */
  evaluationCents: number;
  translationCents: number;
  /** Sum of billable pages across every file. */
  billablePages: number;
  /** Evaluation fees plus the translation line. Add-ons are not included. */
  serviceCents: number;
  totalCents: number;
  /**
   * Page rate while a translation line is charged, so translation cents stay
   * pages times this rate. Otherwise the per-degree rate of the only evaluation.
   */
  unitPriceCents: number;
  lineItems: EvaluationLine[];
};

export function isCatalogService(value: string): value is CatalogService {
  return CATALOG_SET.has(value);
}

/** A JSON array or a comma-separated string. Empty and unknown ids are rejected by `parseCatalogServices`. */
export function readServicesField(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  if (!Array.isArray(value)) {
    throw new HttpError("services must be a list of translation, diploma, and course_by_course", 400);
  }
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new HttpError("services must be a list of translation, diploma, and course_by_course", 400);
    }
    names.push(item.trim());
  }
  return names;
}

/** Rejects an empty list and any name outside the three upload services. */
export function parseCatalogServices(values: readonly string[]): CatalogService[] {
  const names = values.map((value) => value.trim()).filter((value) => value.length > 0);
  if (names.length === 0) throw new HttpError("Choose a service.", 400);
  for (const name of names) {
    if (!isCatalogService(name)) {
      throw new HttpError("services must be translation, diploma, or course_by_course", 400);
    }
  }
  const services = normalizeCatalogServices(names);
  if (!services) throw new HttpError("Choose a service.", 400);
  return services;
}

/** Stable order, no duplicates. Unknown names are dropped. */
export function normalizeCatalogServices(values: readonly string[] | null | undefined): CatalogService[] | null {
  if (values == null) return null;
  const selected = new Set<CatalogService>();
  for (const value of values) {
    const name = value.trim();
    if (!isCatalogService(name)) continue;
    selected.add(name);
  }
  if (selected.size === 0) return null;
  return CATALOG_SERVICES.filter((service) => selected.has(service));
}

export function evaluationKinds(services: readonly CatalogService[]): EvaluationService[] {
  return services.filter((service): service is EvaluationService => service !== "translation");
}

/**
 * Selected services for an order.
 * A stored `services` list wins. Older rows are derived from `service` and `include_translation`.
 */
export function resolveServices(order: {
  services?: readonly string[] | null;
  service?: string | null;
  includeTranslation?: boolean | null;
  orderType?: string | null;
  serviceType?: string | null;
}): CatalogService[] {
  const explicit = normalizeCatalogServices(order.services);
  if (explicit) {
    if (
      order.includeTranslation === true &&
      evaluationKinds(explicit).length > 0 &&
      !explicit.includes("translation")
    ) {
      return CATALOG_SERVICES.filter((service) => service === "translation" || explicit.includes(service));
    }
    return explicit;
  }
  const evaluation = order.service === "diploma" || order.service === "course_by_course";
  const selected = new Set<CatalogService>();
  if (evaluation && order.includeTranslation === true) selected.add("translation");
  if (!evaluation) selected.add("translation");
  if (order.service === "diploma") selected.add("diploma");
  if (order.service === "course_by_course") selected.add("course_by_course");
  return CATALOG_SERVICES.filter((service) => selected.has(service));
}

export function orderEvaluationKinds(order: {
  services?: readonly string[] | null;
  service?: string | null;
  includeTranslation?: boolean | null;
  orderType?: string | null;
  serviceType?: string | null;
}): EvaluationService[] {
  return evaluationKinds(resolveServices(order));
}

export function orderHasEvaluation(order: Parameters<typeof orderEvaluationKinds>[0]): boolean {
  return orderEvaluationKinds(order).length > 0;
}

/** Adds or removes certified translation without dropping the selected evaluations. */
export function servicesWithTranslation(services: readonly string[], include: boolean): CatalogService[] {
  const selected = new Set(normalizeCatalogServices(services) ?? []);
  if (include) selected.add("translation");
  else selected.delete("translation");
  const next = CATALOG_SERVICES.filter((service) => selected.has(service));
  return next.length > 0 ? next : ["translation"];
}

/** Page count already summed across files, or still missing. */
export function sumFilePages(filePages: readonly number[]): number {
  let sum = 0;
  for (const pages of filePages) {
    if (!Number.isInteger(pages) || pages < 1) continue;
    sum += pages;
  }
  return sum;
}

function translationLineCents(input: {
  selected: boolean;
  sourceLanguage: string | null;
  pages: number;
  chargeUnknownLanguage: boolean;
}): number {
  if (!input.selected || input.pages < 1) return 0;
  const language = normalizeLanguage(input.sourceLanguage);
  if (language === "en") return 0;
  if (language == null && input.chargeUnknownLanguage !== true) return 0;
  return input.pages * UNIT_PRICE_CENTS;
}

/**
 * Server price for every selected service.
 * Translation is the per-page rate times the sum of pages on every file.
 * Each evaluation is its own per-degree rate times `degreeCount`.
 * A client total is not an input.
 */
export function priceServices(input: {
  services: readonly CatalogService[];
  degreeCount: number | null;
  sourceLanguage: string | null;
  billablePages?: number | null;
  /** Per-file page counts. When set, they replace `billablePages`. */
  filePages?: readonly number[] | null;
  addonCents?: number;
  /** Checkout charges a translation before language detection. English stays off. */
  chargeUnknownLanguage?: boolean;
}): PricedServices | null {
  const services = normalizeCatalogServices(input.services) ?? [];
  if (services.length === 0) return null;
  const kinds = evaluationKinds(services);
  const degreeCount = input.degreeCount;
  if (kinds.length > 0 && (degreeCount == null || !Number.isInteger(degreeCount) || degreeCount < 1)) {
    return null;
  }
  const pages = input.filePages != null ? sumFilePages(input.filePages) : Math.max(0, input.billablePages ?? 0);
  const diplomaCents = kinds.includes("diploma") ? degreeCount! * DIPLOMA_CENTS : 0;
  const courseCents = kinds.includes("course_by_course") ? degreeCount! * COURSE_CENTS : 0;
  const evaluationCents = diplomaCents + courseCents;
  const translationSelected = services.includes("translation");
  const translationCents = translationLineCents({
    selected: translationSelected,
    sourceLanguage: input.sourceLanguage,
    pages,
    chargeUnknownLanguage: input.chargeUnknownLanguage === true,
  });
  const includeTranslation = translationSelected && kinds.length > 0;
  const service = kinds.length === 1 ? kinds[0]! : null;
  const addonCents = input.addonCents ?? 0;
  const serviceCents = evaluationCents + translationCents;
  const lineItems: EvaluationLine[] = [];
  if (diplomaCents > 0 && degreeCount != null) {
    lineItems.push({
      kind: "evaluation",
      description: "Diploma evaluation",
      quantity: degreeCount,
      unitAmountCents: DIPLOMA_CENTS,
      amountCents: diplomaCents,
    });
  }
  if (courseCents > 0 && degreeCount != null) {
    lineItems.push({
      kind: "evaluation",
      description: "Course-by-course evaluation",
      quantity: degreeCount,
      unitAmountCents: COURSE_CENTS,
      amountCents: courseCents,
    });
  }
  if (translationCents > 0) {
    lineItems.push({
      kind: "translation",
      description: "Certified translation",
      quantity: pages,
      unitAmountCents: UNIT_PRICE_CENTS,
      amountCents: translationCents,
    });
  }
  const unitPriceCents =
    translationCents > 0
      ? UNIT_PRICE_CENTS
      : service === "course_by_course"
        ? COURSE_CENTS
        : service === "diploma"
          ? DIPLOMA_CENTS
          : kinds.includes("diploma")
            ? DIPLOMA_CENTS
            : kinds.includes("course_by_course")
              ? COURSE_CENTS
              : UNIT_PRICE_CENTS;
  return {
    services,
    degreeCount: kinds.length > 0 ? degreeCount : null,
    orderType: kinds.length > 0 ? "evaluation" : "translation",
    service,
    includeTranslation,
    diplomaCents,
    courseCents,
    evaluationCents,
    translationCents,
    billablePages: pages,
    serviceCents,
    totalCents: serviceCents + addonCents,
    unitPriceCents,
    lineItems,
  };
}

/** Columns written when an evaluation order is priced. Null for a translation-only order. */
export function selectionPricePatch(input: {
  services: readonly string[] | null | undefined;
  service?: string | null;
  includeTranslation?: boolean | null;
  orderType?: string | null;
  serviceType?: string | null;
  degreeCount: number | null;
  sourceLanguage: string | null;
  billablePages: number;
  addonCents?: number;
  chargeUnknownLanguage?: boolean;
}): {
  evaluation_cents: number;
  translation_cents: number;
  include_translation: boolean;
  total_cents: number;
  unit_price_cents: number;
} | null {
  const services = resolveServices(input);
  if (evaluationKinds(services).length === 0) return null;
  const priced = priceServices({
    services,
    degreeCount: input.degreeCount,
    sourceLanguage: input.sourceLanguage,
    billablePages: input.billablePages,
    addonCents: input.addonCents,
    chargeUnknownLanguage: input.chargeUnknownLanguage,
  });
  if (!priced) return null;
  return {
    evaluation_cents: priced.evaluationCents,
    translation_cents: priced.translationCents,
    include_translation: priced.includeTranslation,
    total_cents: priced.totalCents,
    unit_price_cents: priced.unitPriceCents,
  };
}

/** A bundled translation still needs a page count before checkout. */
export function orderNeedsBundledPageCount(order: {
  services?: readonly string[] | null;
  service?: string | null;
  includeTranslation?: boolean | null;
  orderType?: string | null;
  serviceType?: string | null;
}): boolean {
  const services = resolveServices(order);
  return services.includes("translation") && evaluationKinds(services).length > 0;
}
