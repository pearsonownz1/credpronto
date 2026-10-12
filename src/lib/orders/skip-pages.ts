import { needsBundledTranslation } from "./evaluation-price";
import { HttpError } from "./errors";
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
};

export function parseQuotePatch(body: unknown): QuotePatch {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError("Expected a JSON object.", 400);
  }
  const row = body as Record<string, unknown>;
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
  if (patch.skipPages == null && patch.targetLanguage == null) {
    throw new HttpError("Nothing to update.", 400);
  }
  return patch;
}

export function quotePriceAfterSkip(
  order: {
    service: EvaluationService | null;
    sourceLanguage: string | null;
    unitPriceCents: number;
    evaluationCents: number | null;
    addonCents: number;
  },
  billablePages: number,
): { billablePages: number; translationCents: number | null; totalCents: number } {
  if (order.service) {
    const translationCents = needsBundledTranslation(order.sourceLanguage)
      ? billablePages * order.unitPriceCents
      : 0;
    return {
      billablePages,
      translationCents,
      totalCents: (order.evaluationCents ?? 0) + translationCents + order.addonCents,
    };
  }
  return {
    billablePages,
    translationCents: null,
    totalCents: billablePages * order.unitPriceCents + order.addonCents,
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
