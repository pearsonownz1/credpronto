import { LOW_LANGUAGE_CONFIDENCE, UNIT_PRICE_CENTS } from "./constants";
import { totalCents } from "./billing";
import { IMAGE_QUALITY_REASON } from "./image-quality";
import { isSupportedSourceLanguage, normalizeLanguage } from "./languages";

/** Detected English with the default target still English. Not a silent en → en quote. */
export const SAME_LANGUAGE_REASON = "same_language";

export function englishSourceWithoutTarget(
  source: string | null | undefined,
  target: string | null | undefined,
): boolean {
  return normalizeLanguage(source) === "en" && (normalizeLanguage(target) ?? "en") === "en";
}

export type QuoteDecision = {
  status: "quoted" | "needs_review";
  reviewReason: string | null;
  billablePages: number;
  totalCents: number;
  etaHours: number;
};

export function decideQuote(input: {
  billableUnits: number[];
  pageNeedsReview: boolean[];
  language: string | null;
  confidence: number | null;
  detectionAvailable: boolean;
  languagesDisagree: boolean;
  unitPriceCents?: number;
  imageQuality?: boolean;
  targetLanguage?: string | null;
}): QuoteDecision {
  const unit = input.unitPriceCents ?? UNIT_PRICE_CENTS;
  const billablePages = input.billableUnits.reduce((sum, pages) => sum + pages, 0);
  const price = totalCents(billablePages, unit);
  if (input.imageQuality) {
    return {
      status: "needs_review",
      reviewReason: IMAGE_QUALITY_REASON,
      billablePages,
      totalCents: price,
      etaHours: 24,
    };
  }
  if (
    englishSourceWithoutTarget(input.language, input.targetLanguage) &&
    input.detectionAvailable &&
    !input.languagesDisagree &&
    input.billableUnits.length > 0
  ) {
    return {
      status: "needs_review",
      reviewReason: SAME_LANGUAGE_REASON,
      billablePages,
      totalCents: price,
      etaHours: 24,
    };
  }
  const reasons: string[] = [];

  if (input.billableUnits.length === 0) {
    reasons.push("No pages could be read from the upload.");
  }
  if (!input.detectionAvailable) {
    reasons.push(
      "Automatic language detection is unavailable. A reviewer will confirm the language before this price is final.",
    );
  } else if (!input.language) {
    reasons.push("The source language could not be detected.");
  } else if (input.language === "en") {
    if (input.confidence == null || input.confidence < LOW_LANGUAGE_CONFIDENCE) {
      const shown = input.confidence == null ? "unknown" : input.confidence.toFixed(2);
      reasons.push(
        `Language detection confidence is low (${shown}). A reviewer will confirm the language before this price is final.`,
      );
    }
  } else if (!isSupportedSourceLanguage(input.language)) {
    reasons.push(
      `Detected language "${input.language}" is not supported for automatic translation. A reviewer will take a look.`,
    );
  } else if (input.confidence == null || input.confidence < LOW_LANGUAGE_CONFIDENCE) {
    const shown =
      input.confidence == null ? "unknown" : input.confidence.toFixed(2);
    reasons.push(
      `Language detection confidence is low (${shown}). A reviewer will confirm the language before this price is final.`,
    );
  }
  if (input.languagesDisagree) {
    reasons.push("The files appear to be in different languages.");
  }
  if (input.pageNeedsReview.some(Boolean)) {
    reasons.push("At least one page could not be read clearly.");
  }

  if (reasons.length > 0) {
    return {
      status: "needs_review",
      reviewReason: reasons.join(" "),
      billablePages,
      totalCents: price,
      etaHours: 24,
    };
  }

  return {
    status: "quoted",
    reviewReason: null,
    billablePages,
    totalCents: price,
    etaHours: 1,
  };
}

export function etaFromNow(hours: number, now = Date.now()): string {
  return new Date(now + hours * 60 * 60 * 1000).toISOString();
}
