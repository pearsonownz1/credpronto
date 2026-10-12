import { billableCjkUnits, billableUnits, countCjkChars, countedForPage, type BillingBasis } from "./billing";
import { isCjkDominant } from "./words";

export const SKIP_REASONS = ["target_language", "blank", "not_document", "customer"] as const;

export type SkipReason = (typeof SKIP_REASONS)[number];

export type QuotedPage = {
  pageIndex: number;
  /** Words on a word-based page, or CJK characters on a character-based page. */
  units: number;
  billingBasis: BillingBasis;
  /** Billable pages for this side. Zero when the side is skipped. */
  billableUnits: number;
  skip: boolean;
  skipReason: SkipReason | null;
};

const NON_DOCUMENT =
  /\b(dhl|fedex|ups|usps)\b|air\s*way\s*bill|airway\s*bill|shipping\s+label|\bwaybill\b/i;

const ENGLISH_WORDS =
  /\b(the|and|of|to|for|in|is|that|this|with|from|certificate|verification|student|university|born|name|date|report|hereby|following|true|correct|education|academic|transcript)\b/gi;

const LATIN_HINTS: Record<string, RegExp> = {
  es: /\b(el|la|los|las|de|del|que|certificado|universidad|estudiante)\b/gi,
  pt: /\b(de|da|do|que|certidão|certificado|universidade|estudante)\b/gi,
  fr: /\b(le|la|les|de|des|et|certificat|université|étudiant)\b/gi,
  de: /\b(der|die|das|und|von|zertifikat|universität|student)\b/gi,
  it: /\b(il|lo|la|di|che|certificato|università|studente)\b/gi,
};

/**
 * Pages already in the target language, blank pages, and non-documents
 * (a shipping label) are not billed.
 */
export function autoSkipReason(text: string, targetLanguage: string | null): SkipReason | null {
  if (isBlankPage(text)) return "blank";
  if (NON_DOCUMENT.test(text)) return "not_document";
  if (targetLanguage && alreadyInTargetLanguage(text, targetLanguage)) return "target_language";
  return null;
}

/**
 * Prices one physical page. `skipPages` null keeps the automatic decision.
 * An array is the full skip list: indexes in the list are skipped, and
 * indexes left out are billed even when they would have been skipped automatically.
 */
export function pricePage(input: {
  text: string;
  targetLanguage: string | null;
  pageIndex: number;
  skipPages: number[] | null;
}): QuotedPage {
  const counted = countedForPage(input.text);
  const auto = autoSkipReason(input.text, input.targetLanguage);
  const listed = input.skipPages?.includes(input.pageIndex) ?? false;
  const skip = input.skipPages ? listed : auto != null;
  const skipReason = skip ? (auto ?? "customer") : null;
  const billed =
    counted.basis === "chars" ? billableCjkUnits(counted.counted) : billableUnits(counted.counted);
  return {
    pageIndex: input.pageIndex,
    units: counted.counted,
    billingBasis: counted.basis,
    billableUnits: skip ? 0 : billed,
    skip,
    skipReason,
  };
}

function isBlankPage(text: string): boolean {
  if (!text.trim()) return true;
  if (countCjkChars(text) > 0) return false;
  return (text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) === 0;
}

export function quotePages(input: {
  texts: string[];
  targetLanguage: string | null;
  skipPages?: number[] | null;
}): QuotedPage[] {
  return input.texts.map((text, index) =>
    pricePage({
      text,
      targetLanguage: input.targetLanguage,
      pageIndex: index + 1,
      skipPages: input.skipPages ?? null,
    }),
  );
}

export function pagesForTranslation<T extends { skip?: boolean }>(pages: T[]): T[] {
  return pages.filter((page) => page.skip !== true);
}

export function previewOriginalPath(orderId: string, version: number): string {
  return `${orderId}/original-v${version}.pdf`;
}

function alreadyInTargetLanguage(text: string, targetLanguage: string): boolean {
  const code = targetLanguage.trim().toLowerCase().split("-")[0] ?? "";
  if (!code) return false;
  if (code === "zh" || code === "ja" || code === "ko") return cjkScript(text) === code;
  if (isCjkDominant(text)) return false;
  if (code === "en") return (text.match(ENGLISH_WORDS)?.length ?? 0) >= 2;
  const hints = LATIN_HINTS[code];
  return hints ? (text.match(hints)?.length ?? 0) >= 2 : false;
}

function cjkScript(text: string): "zh" | "ja" | "ko" | "other" {
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const kana = text.match(/\p{Script=Hiragana}|\p{Script=Katakana}/gu)?.length ?? 0;
  const hangul = text.match(/\p{Script=Hangul}/gu)?.length ?? 0;
  if (hangul > han && hangul >= kana) return "ko";
  if (kana > 0 && kana * 4 >= han) return "ja";
  if (han > 0) return "zh";
  return "other";
}
