import { UNIT_PRICE_CENTS } from "./constants";
import { HttpError } from "./errors";
import { normalizeLanguage } from "./languages";
import {
  evaluationKinds,
  parseCatalogServices,
  priceServices,
  readServicesField,
  resolveServices,
  servicesWithTranslation,
  type CatalogService,
} from "./service-selection";
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

/**
 * Evaluation the customer also asked to translate.
 * English still prices translation at $0, and the opt-in flag stays on so the
 * order follows the preview path instead of paying first.
 */
export function isTranslationBundle(order: {
  includeTranslation?: boolean | null;
  service?: string | null;
  orderType?: string | null;
  serviceType?: string | null;
}): boolean {
  if (order.includeTranslation !== true) return false;
  return (
    order.service === "diploma" ||
    order.service === "course_by_course" ||
    order.orderType === "evaluation" ||
    order.serviceType === "evaluation"
  );
}

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
  services?: readonly string[] | null;
}): {
  orderType: "translation" | "evaluation";
  service: EvaluationService | null;
  degreeCount: number | null;
  /** True only for an evaluation the customer also wants translated. */
  includeTranslation: boolean;
  /** Every selected upload service, in catalog order. */
  services: CatalogService[];
} {
  if (fields.services != null) return parseExplicitServices(fields);
  const orderType = fields.orderType ?? "translation";
  if (orderType === "translation") {
    return {
      orderType: "translation",
      service: null,
      degreeCount: null,
      includeTranslation: false,
      services: ["translation"],
    };
  }
  if (orderType !== "evaluation") {
    throw new HttpError("orderType must be translation or evaluation", 400);
  }
  if (fields.service !== "diploma" && fields.service !== "course_by_course") {
    throw new HttpError("service must be diploma or course_by_course", 400);
  }
  const degreeCount = parseDegreeCount(fields.degreeCount);
  const includeTranslation = parseIncludeTranslation(fields.includeTranslation);
  const services: CatalogService[] = includeTranslation ? ["translation", fields.service] : [fields.service];
  return {
    orderType: "evaluation",
    service: fields.service,
    degreeCount,
    includeTranslation,
    services,
  };
}

function parseExplicitServices(fields: {
  orderType: string | null;
  service: string | null;
  degreeCount: string | null;
  includeTranslation?: string | null;
  services?: readonly string[] | null;
}): {
  orderType: "translation" | "evaluation";
  service: EvaluationService | null;
  degreeCount: number | null;
  includeTranslation: boolean;
  services: CatalogService[];
} {
  const services = parseCatalogServices(fields.services ?? []);
  const kinds = evaluationKinds(services);
  if (fields.orderType != null && fields.orderType !== "translation" && fields.orderType !== "evaluation") {
    throw new HttpError("orderType must be translation or evaluation", 400);
  }
  if (fields.orderType === "translation" && kinds.length > 0) {
    throw new HttpError("orderType does not match services", 400);
  }
  if (fields.orderType === "evaluation" && kinds.length === 0) {
    throw new HttpError("orderType does not match services", 400);
  }
  if (fields.service != null && fields.service !== "") {
    if (fields.service !== "diploma" && fields.service !== "course_by_course") {
      throw new HttpError("service must be diploma or course_by_course", 400);
    }
    if (!services.includes(fields.service)) throw new HttpError("service does not match services", 400);
  }
  const flagged =
    fields.includeTranslation == null || fields.includeTranslation === ""
      ? null
      : parseIncludeTranslation(fields.includeTranslation);
  const includeTranslation = kinds.length > 0 && services.includes("translation");
  if (flagged === true && !includeTranslation) {
    throw new HttpError("includeTranslation does not match services", 400);
  }
  if (flagged === false && includeTranslation) {
    throw new HttpError("includeTranslation does not match services", 400);
  }
  if (kinds.length === 0) {
    return {
      orderType: "translation",
      service: null,
      degreeCount: null,
      includeTranslation: false,
      services,
    };
  }
  return {
    orderType: "evaluation",
    service: kinds.length === 1 ? kinds[0]! : null,
    degreeCount: parseDegreeCount(fields.degreeCount),
    includeTranslation,
    services,
  };
}

/**
 * `services` is the upload contract: any non-empty subset of
 * `translation`, `diploma`, and `course_by_course`.
 * When `services` is omitted, `service` plus `includeTranslation` still selects one evaluation.
 * A client total is not read.
 */
export function serviceChoiceFromBody(
  body: unknown,
  fallback: {
    service?: string | null;
    services?: readonly string[] | null;
    includeTranslation?: boolean | null;
    degreeCount?: number | null;
    orderType?: string | null;
    serviceType?: string | null;
  },
): {
  orderType: "translation" | "evaluation";
  service: EvaluationService | null;
  degreeCount: number | null;
  includeTranslation: boolean;
  services: CatalogService[];
} | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const servicesPresent = "services" in record && record.services != null && record.services !== "";
  const servicePresent = "service" in record && record.service != null && record.service !== "";
  const includePresent =
    "includeTranslation" in record && record.includeTranslation != null && record.includeTranslation !== "";
  const degreePresent = "degreeCount" in record && record.degreeCount != null && record.degreeCount !== "";
  if (!servicesPresent && !servicePresent && !includePresent && !degreePresent) return null;

  const degreeCount = degreePresent
    ? degreeText(record.degreeCount)
    : fallback.degreeCount == null
      ? null
      : String(fallback.degreeCount);
  const includeFlag = includePresent ? includeFlagText(record.includeTranslation) : null;

  if (servicesPresent) {
    return parseOrderChoice({
      orderType: null,
      service: servicePresent ? textValue(record.service) : null,
      degreeCount,
      includeTranslation: includeFlag,
      services: parseCatalogServices(readServicesField(record.services)),
    });
  }

  const include = includePresent ? includeFlag === "true" : fallback.includeTranslation === true;
  const service = servicePresent ? textValue(record.service) : (fallback.service ?? null);
  if (service === "diploma" || service === "course_by_course") {
    return parseOrderChoice({
      orderType: "evaluation",
      service,
      degreeCount,
      includeTranslation: include ? "true" : "false",
      services: include ? ["translation", service] : [service],
    });
  }
  if (!servicePresent && (includePresent || degreePresent)) {
    return parseOrderChoice({
      orderType: null,
      service: null,
      degreeCount,
      includeTranslation: include ? "true" : "false",
      services: servicesWithTranslation(resolveServices(fallback), include),
    });
  }
  throw new HttpError("service must be diploma or course_by_course", 400);
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function includeFlagText(value: unknown): string {
  if (value === true || value === "true") return "true";
  if (value === false || value === "false") return "false";
  throw new HttpError("includeTranslation must be true or false.", 400);
}

function degreeText(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new HttpError(`degreeCount must be an integer from 1 to ${MAX_DEGREE_COUNT}`, 400);
}

function parseDegreeCount(value: string | null): number {
  const degreeCount = Number(value);
  if (!Number.isInteger(degreeCount) || degreeCount < 1 || degreeCount > MAX_DEGREE_COUNT) {
    throw new HttpError(`degreeCount must be an integer from 1 to ${MAX_DEGREE_COUNT}`, 400);
  }
  return degreeCount;
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
 * Page count already stored on the order, or on its documents.
 * The upload quote uses this count. Checkout must not wait for another recount.
 */
export function knownBillablePages(order: {
  billablePages?: number | null;
  documents?: ReadonlyArray<{ pageCount?: number | null }>;
}): number | null {
  if (typeof order.billablePages === "number" && order.billablePages > 0) return order.billablePages;
  let sum = 0;
  let found = false;
  for (const document of order.documents ?? []) {
    if (typeof document.pageCount !== "number" || document.pageCount < 1) continue;
    sum += document.pageCount;
    found = true;
  }
  if (found) return sum;
  return typeof order.billablePages === "number" ? order.billablePages : null;
}

/**
 * Combined orders still need a page count before pay.
 * A count already on the order or its documents is enough. Unknown language is not a recount.
 * English evaluations are ready without a translation line.
 */
export function checkoutQuotePending(order: {
  service?: string | null;
  services?: readonly string[] | null;
  includeTranslation?: boolean;
  orderType?: string | null;
  serviceType?: string | null;
  sourceLanguage?: string | null;
  billablePages?: number | null;
  documents?: ReadonlyArray<{ pageCount?: number | null }>;
}): boolean {
  const services = resolveServices(order);
  if (!services.includes("translation") || evaluationKinds(services).length === 0) return false;
  if (normalizeLanguage(order.sourceLanguage ?? null) === "en") return false;
  const pages = knownBillablePages(order);
  return pages == null || pages < 1;
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
  const language = normalizeLanguage(input.sourceLanguage);
  const translationCents =
    input.includeTranslation && language !== "en" ? input.billablePages * UNIT_PRICE_CENTS : 0;
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
  /** Checkout prices an opted-in translation before language detection. English stays off. */
  chargeUnknownLanguage?: boolean;
}): {
  evaluationCents: number;
  translationCents: number;
  includeTranslation: boolean;
  totalCents: number;
} {
  const language = normalizeLanguage(input.sourceLanguage);
  const includeTranslation =
    input.includeTranslation &&
    language !== "en" &&
    (language != null || input.chargeUnknownLanguage === true);
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
  chargeUnknownLanguage?: boolean;
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
    include_translation: input.includeTranslation,
    total_cents: priced.totalCents,
    unit_price_cents:
      priced.translationCents > 0 ? UNIT_PRICE_CENTS : evaluationUnitCents(input.service),
  };
}

/** One checkout total: every selected service, summed. A client total is not read. */
export function checkoutServiceCharge(order: {
  service: EvaluationService | string | null;
  services?: readonly string[] | null;
  degreeCount: number | null;
  sourceLanguage: string | null;
  billablePages: number | null;
  includeTranslation: boolean;
  orderType?: string | null;
  serviceType?: string | null;
}): {
  evaluationCents: number;
  translationCents: number;
  includeTranslation: boolean;
  unitPriceCents: number;
  serviceCents: number;
} | null {
  const services = resolveServices(order);
  if (evaluationKinds(services).length === 0) return null;
  if (order.degreeCount == null || !Number.isInteger(order.degreeCount) || order.degreeCount < 1) return null;
  const priced = priceServices({
    services,
    degreeCount: order.degreeCount,
    sourceLanguage: order.sourceLanguage,
    billablePages: order.billablePages ?? 0,
    chargeUnknownLanguage: true,
  });
  if (!priced) return null;
  return {
    evaluationCents: priced.evaluationCents,
    translationCents: priced.translationCents,
    includeTranslation: priced.includeTranslation,
    unitPriceCents: priced.unitPriceCents,
    serviceCents: priced.serviceCents,
  };
}

/**
 * Customer quote amounts. `billablePages` is the detected page count (read-only).
 * `unitPriceCents` on an evaluation is the per-degree rate. The translation line uses $9.95.
 */
export function customerServiceQuote(order: {
  service: EvaluationService | string | null;
  services?: readonly string[] | null;
  orderType?: string | null;
  serviceType?: string | null;
  degreeCount?: number | null;
  sourceLanguage?: string | null;
  billablePages?: number | null;
  unitPriceCents: number;
  evaluationCents?: number | null;
  translationCents?: number | null;
  includeTranslation?: boolean;
  addonCents?: number;
  totalCents?: number | null;
  documents?: ReadonlyArray<{ pageCount?: number | null }>;
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
  const billablePages = knownBillablePages(order);
  const services = resolveServices(order);
  const kinds = evaluationKinds(services);
  const degreeCount = order.degreeCount;
  const degreeReady =
    kinds.length > 0 && degreeCount != null && Number.isInteger(degreeCount) && degreeCount >= 1;
  if (!degreeReady) {
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
  const priced = priceServices({
    services,
    degreeCount,
    sourceLanguage: order.sourceLanguage ?? null,
    billablePages,
    addonCents: 0,
    chargeUnknownLanguage: true,
  });
  if (!priced) {
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
  const optedIn = priced.includeTranslation;
  const pending = checkoutQuotePending({
    ...order,
    includeTranslation: optedIn,
    billablePages,
  });
  const translationCents = pending ? 0 : priced.translationCents;
  const primary = kinds[0] ?? null;
  return {
    evaluation: true,
    evaluationCents: priced.evaluationCents,
    translationCents,
    includeTranslation: optedIn,
    unitPriceCents: primary ? evaluationUnitCents(primary) : priced.unitPriceCents,
    totalCents: pending ? null : priced.evaluationCents + translationCents + (order.addonCents ?? 0),
    translationOfferCents: optedIn
      ? null
      : translationOfferCents({
          service: primary,
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
  services?: readonly string[] | null;
  includeTranslation?: boolean;
  orderType?: string | null;
  serviceType?: string | null;
  sourceLanguage?: string | null;
  degreeCount: number | null;
  evaluationCents: number | null;
  translationCents: number | null;
  billablePages: number | null;
}): EvaluationLine[] {
  const services = input.services?.length
    ? resolveServices(input)
    : input.service
      ? resolveServices({ service: input.service, includeTranslation: (input.translationCents ?? 0) > 0 })
      : [];
  const kinds = evaluationKinds(services);
  if (kinds.length > 1 && input.degreeCount != null) {
    const priced = priceServices({
      services,
      degreeCount: input.degreeCount,
      sourceLanguage: input.sourceLanguage ?? null,
      billablePages: input.billablePages,
    });
    if (!priced) return [];
    const lines = [...priced.lineItems];
    if ((input.translationCents ?? 0) > 0 && !lines.some((line) => line.kind === "translation")) {
      lines.push({
        kind: "translation",
        description: "Certified translation",
        quantity: input.billablePages ?? 0,
        unitAmountCents: UNIT_PRICE_CENTS,
        amountCents: input.translationCents ?? 0,
      });
    }
    return lines;
  }
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
  services?: readonly string[] | null;
  includeTranslation?: boolean;
  orderType?: string | null;
  serviceType?: string | null;
  sourceLanguage?: string | null;
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
    description: item.kind === "evaluation" ? item.description : input.description,
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
