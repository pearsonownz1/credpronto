import {
  COURSE_BY_COURSE_UNIT_CENTS,
  DIPLOMA_UNIT_CENTS,
  MAX_DEGREE_COUNT,
} from "@/lib/orders/evaluation-price";
import { HttpError } from "@/lib/orders/errors";
import { EVALUATION_TURNAROUND_COPY, TRANSLATION_TURNAROUND_COPY } from "@/lib/flow/present";
import { sourceLanguageChoices, targetLanguageChoices, isSupportedSourceLanguage, normalizeLanguage } from "@/lib/orders/languages";
import { UNIT_PRICE_CENTS } from "@/lib/orders/constants";
import { priceServices, type CatalogService } from "@/lib/orders/service-selection";
import { rejectIdentityFields } from "./scope";

export const MCP_ENDPOINT = "https://credpronto.com/api/mcp";
export const BILLING_PATH = "/dashboard/billing";

export function billingPageUrl(origin?: string): string {
  const base = (origin || "https://credpronto.com").replace(/\/$/, "");
  return `${base}${BILLING_PATH}`;
}

const TURNAROUND = [
  {
    id: "standard",
    translation: TRANSLATION_TURNAROUND_COPY,
    evaluation: EVALUATION_TURNAROUND_COPY,
    rush: false,
  },
] as const;

export function listServices() {
  return {
    services: [
      {
        id: "translation",
        name: "Certified translation",
        unitCents: UNIT_PRICE_CENTS,
        per: "page",
      },
      {
        id: "diploma",
        name: "Credential evaluation",
        evaluationType: "diploma",
        unitCents: DIPLOMA_UNIT_CENTS,
        per: "credential",
      },
      {
        id: "course_by_course",
        name: "Credential evaluation",
        evaluationType: "course_by_course",
        unitCents: COURSE_BY_COURSE_UNIT_CENTS,
        per: "credential",
      },
    ],
    languages: {
      source: sourceLanguageChoices(),
      target: targetLanguageChoices(),
    },
    turnaround: TURNAROUND,
    rushOffered: false,
    maxCredentials: MAX_DEGREE_COUNT,
  };
}

export type QuoteInput = {
  service: "translation" | "evaluation";
  evaluationType: "diploma" | "course_by_course" | null;
  pageCount: number | null;
  degreeCount: number | null;
  sourceLanguage: string | null;
  targetLanguage: string;
  includeTranslation: boolean;
  rush: boolean;
};

export function quoteInput(value: unknown): QuoteInput {
  rejectIdentityFields(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError("Expected a JSON object", 400, "validation_error");
  }
  const record = value as Record<string, unknown>;
  const service = record.service;
  if (service !== "translation" && service !== "evaluation") {
    throw new HttpError("service must be translation or evaluation", 400, "validation_error");
  }
  if (record.rush === true) throw new HttpError("Expedited is no longer offered", 400, "validation_error");
  const evaluationType = record.evaluationType ?? record.evaluation_type ?? null;
  if (service === "evaluation" && evaluationType !== "diploma" && evaluationType !== "course_by_course") {
    throw new HttpError("evaluationType must be diploma or course_by_course", 400, "validation_error");
  }
  const pageCount = optionalCount(record.pageCount ?? record.page_count, "pageCount");
  const degreeCount = optionalCount(record.degreeCount ?? record.degree_count, "degreeCount");
  const sourceLanguage = optionalLanguage(record.sourceLanguage ?? record.source_language, "sourceLanguage");
  const targetLanguage = optionalLanguage(record.targetLanguage ?? record.target_language, "targetLanguage") ?? "en";
  const includeTranslation = record.includeTranslation === true || record.include_translation === true;
  if (service === "translation" || includeTranslation) {
    if (!sourceLanguage || !isSupportedSourceLanguage(sourceLanguage)) {
      throw new HttpError("sourceLanguage is not supported", 400, "validation_error");
    }
    if (pageCount == null) throw new HttpError("pageCount is required", 400, "validation_error");
  }
  if (service === "evaluation") {
    const count = degreeCount ?? 1;
    if (count < 1 || count > MAX_DEGREE_COUNT) {
      throw new HttpError("degreeCount is not supported", 400, "validation_error");
    }
  }
  return {
    service,
    evaluationType: evaluationType === "diploma" || evaluationType === "course_by_course" ? evaluationType : null,
    pageCount: pageCount ?? null,
    degreeCount: service === "evaluation" ? (degreeCount ?? 1) : null,
    sourceLanguage,
    targetLanguage,
    includeTranslation: service === "evaluation" && includeTranslation,
    rush: false,
  };
}

export function getQuote(value: unknown) {
  const input = quoteInput(value);
  const services = quoteServices(input);
  const priced = priceServices({
    services,
    degreeCount: input.degreeCount,
    sourceLanguage: input.sourceLanguage ?? null,
    billablePages: input.pageCount,
  });
  if (!priced || priced.totalCents < 1) {
    throw new HttpError("This order cannot be priced", 409, "quote_unavailable");
  }
  const evaluation = services.some((item) => item === "diploma" || item === "course_by_course");
  return {
    service: input.service,
    services,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    pageCount: input.pageCount,
    degreeCount: input.degreeCount,
    amountCents: priced.totalCents,
    currency: "usd",
    unitPriceCents: priced.unitPriceCents,
    turnaround: evaluation ? EVALUATION_TURNAROUND_COPY : TRANSLATION_TURNAROUND_COPY,
    rushOffered: false,
  };
}

export function quoteServices(input: QuoteInput): CatalogService[] {
  const services: CatalogService[] = [];
  if (input.service === "translation" || input.includeTranslation) services.push("translation");
  if (input.service === "evaluation" && input.evaluationType) services.push(input.evaluationType);
  return services;
}

function optionalCount(value: unknown, field: string): number | null {
  if (value == null || value === "") return null;
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(count) || count < 1) throw new HttpError(`${field} must be a positive integer`, 400, "validation_error");
  return count;
}

function optionalLanguage(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(`${field} is not supported`, 400, "validation_error");
  const code = normalizeLanguage(value);
  if (!code) throw new HttpError(`${field} is not supported`, 400, "validation_error");
  return code;
}
