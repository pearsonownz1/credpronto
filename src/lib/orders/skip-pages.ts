import { evaluationPricePatch, MAX_DEGREE_COUNT, rejectCustomerPageCount } from "./evaluation-price";
import { HttpError } from "./errors";
import {
  orderHasEvaluation,
  resolveServices,
  selectionPricePatch,
  servicesWithTranslation,
} from "./service-selection";
import type { EvaluationService } from "./types";

export type QuoteLine = {
  billableUnits?: number | null;
  skip?: boolean;
};

/** Billable units for one physical page. A skipped page adds nothing. A missing count is one page. */
export function lineBillableUnits(line: QuoteLine): number {
  if (line.skip === true) return 0;
  if (typeof line.billableUnits !== "number" || !Number.isFinite(line.billableUnits)) return 1;
  return line.billableUnits;
}

export function sumQuotedBillable(lines: QuoteLine[]): number {
  return lines.reduce((sum, line) => sum + lineBillableUnits(line), 0);
}

export type QuotePatch = {
  /** Indexes into the order's pages, in the same order the quote returns them. */
  skipPages?: number[];
  targetLanguage?: string;
  /** Evaluation orders only. Certified translation is charged only when this is true. */
  includeTranslation?: boolean;
  /** Credentials to price. Integer from 1 to 5. Pages are not accepted. */
  degreeCount?: number;
};

export function parseQuotePatch(body: unknown): QuotePatch {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError("Expected a JSON object.", 400);
  }
  const row = body as Record<string, unknown>;
  rejectCustomerPageCount(row);
  const patch: QuotePatch = {};
  if ("skipPages" in row) {
    if (!Array.isArray(row.skipPages)) {
      throw new HttpError("skipPages must be a list of page indexes.", 400);
    }
    const indexes: number[] = [];
    for (const entry of row.skipPages) {
      if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0) {
        throw new HttpError("skipPages must be a list of page indexes.", 400);
      }
      if (!indexes.includes(entry)) indexes.push(entry);
    }
    patch.skipPages = indexes;
  }
  if ("targetLanguage" in row) {
    if (typeof row.targetLanguage !== "string" || row.targetLanguage.trim() === "") {
      throw new HttpError("Choose a target language.", 400);
    }
    patch.targetLanguage = row.targetLanguage;
  }
  if ("includeTranslation" in row) {
    if (typeof row.includeTranslation !== "boolean") {
      throw new HttpError("includeTranslation must be true or false.", 400);
    }
    patch.includeTranslation = row.includeTranslation;
  }
  if ("degreeCount" in row) {
    const degreeCount = typeof row.degreeCount === "number" ? row.degreeCount : Number(row.degreeCount);
    if (!Number.isInteger(degreeCount) || degreeCount < 1 || degreeCount > MAX_DEGREE_COUNT) {
      throw new HttpError(`degreeCount must be an integer from 1 to ${MAX_DEGREE_COUNT}`, 400);
    }
    patch.degreeCount = degreeCount;
  }
  if (
    patch.skipPages == null &&
    patch.targetLanguage == null &&
    patch.includeTranslation == null &&
    patch.degreeCount == null
  ) {
    throw new HttpError("Nothing to update.", 400);
  }
  return patch;
}

export function quotePriceAfterSkip(
  order: {
    service: EvaluationService | null;
    services?: readonly string[] | null;
    orderType?: string | null;
    serviceType?: string | null;
    degreeCount?: number | null;
    sourceLanguage: string | null;
    unitPriceCents: number;
    evaluationCents: number | null;
    addonCents: number;
    includeTranslation?: boolean;
  },
  billablePages: number,
): {
  billablePages: number;
  evaluationCents: number | null;
  translationCents: number | null;
  totalCents: number;
  includeTranslation: boolean;
  unitPriceCents: number;
} {
  if (orderHasEvaluation(order) && order.degreeCount != null) {
    const services = servicesWithTranslation(resolveServices(order), order.includeTranslation === true);
    const priced = selectionPricePatch({
      services,
      includeTranslation: order.includeTranslation === true,
      degreeCount: order.degreeCount,
      sourceLanguage: order.sourceLanguage,
      billablePages,
      addonCents: order.addonCents,
    });
    if (!priced && order.service) {
      const single = evaluationPricePatch({
        service: order.service,
        degreeCount: order.degreeCount,
        sourceLanguage: order.sourceLanguage,
        billablePages,
        includeTranslation: order.includeTranslation === true,
        addonCents: order.addonCents,
      });
      return {
        billablePages,
        evaluationCents: single.evaluation_cents,
        translationCents: single.translation_cents,
        totalCents: single.total_cents,
        includeTranslation: single.include_translation,
        unitPriceCents: single.unit_price_cents,
      };
    }
    if (!priced) {
      return {
        billablePages,
        evaluationCents: order.evaluationCents,
        translationCents: 0,
        includeTranslation: order.includeTranslation === true,
        totalCents: (order.evaluationCents ?? 0) + order.addonCents,
        unitPriceCents: order.unitPriceCents,
      };
    }
    return {
      billablePages,
      evaluationCents: priced.evaluation_cents,
      translationCents: priced.translation_cents,
      totalCents: priced.total_cents,
      includeTranslation: priced.include_translation,
      unitPriceCents: priced.unit_price_cents,
    };
  }
  if (order.service) {
    return {
      billablePages,
      evaluationCents: order.evaluationCents,
      translationCents: 0,
      includeTranslation: false,
      totalCents: (order.evaluationCents ?? 0) + order.addonCents,
      unitPriceCents: order.unitPriceCents,
    };
  }
  return {
    billablePages,
    evaluationCents: null,
    translationCents: null,
    includeTranslation: false,
    totalCents: billablePages * order.unitPriceCents + order.addonCents,
    unitPriceCents: order.unitPriceCents,
  };
}

/** Status tag for one page in the quote details. */
export function pageStatusTag(line: {
  skip?: boolean;
  skipReason?: string | null;
  billableUnits?: number | null;
}): string {
  if (line.skip === true) return freePageTag(line.skipReason);
  if (typeof line.billableUnits === "number" && Number.isFinite(line.billableUnits) && line.billableUnits > 1) {
    return `Counts as ${line.billableUnits}`;
  }
  return "Translate";
}

function freePageTag(skipReason: string | null | undefined): string {
  const reason = skipReason?.trim() ?? "";
  if (!reason) return "Free";
  const key = reason.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (key === "already english" || key === "english") return "Free (English)";
  if (key.startsWith("skipped ")) return freePageTag(key.slice("skipped ".length));
  return `Free (${key})`;
}

export function skipPageNote(skipReason: string | null | undefined): string {
  const reason = skipReason?.trim() ?? "";
  if (!reason) return "Skipped";
  const key = reason.toLowerCase().replace(/[_-]+/g, " ");
  if (key === "already english" || key === "english") return "Skipped: already English";
  if (key === "not a document" || key === "not document" || key === "non document") {
    return "Skipped: not a document";
  }
  if (/^skipped:/i.test(reason)) return reason;
  return `Skipped: ${reason}`;
}
