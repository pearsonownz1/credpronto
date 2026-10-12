import {
  CJK_CHARS_PER_BILLABLE_PAGE,
  UNIT_PRICE_CENTS,
  WORDS_PER_BILLABLE_PAGE,
} from "./constants";
import { countWords, isCjkDominant } from "./words";

const CJK_CHAR =
  /^(?:\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul})$/u;
const CJK_CHARS =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const ALNUM = /^[A-Za-z0-9]$/;
/** Separators that stay inside a number or Latin run when they sit between alphanumerics. */
const JOINER = /^[.,/-]$/;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const OTHER_SCRIPT =
  /[\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Greek}\p{Script=Devanagari}\p{Script=Thai}]/gu;
/** Printed page marks, including OCR of "第 1 页, 共 2 页" and "1/1". */
const PAGE_MARK =
  /第\s*\d+\s*页(?:\s*[,，、]?\s*共\s*\d+\s*页)?|\b(?:page|p)\.?\s*\d+(?:\s*(?:of|\/)\s*\d+)?\b|\b\d+\s*[/／]\s*\d+\b/gi;

const ENGLISH_STOPS = new Set([
  "the", "of", "and", "to", "in", "is", "for", "that", "on", "with", "as", "by",
  "this", "be", "or", "from", "at", "an", "are", "was", "were", "been", "it",
  "its", "not", "your", "you", "we", "our", "has", "have", "had", "will",
  "which", "their", "his", "her", "they", "he", "she", "but", "if", "than",
]);

const ROMANCE_STOPS = new Set([
  "el", "los", "las", "del", "una", "por", "con", "para", "que", "un", "les",
  "des", "une", "est", "dans", "sur", "pour", "das", "uma", "dos", "em", "ao",
  "le", "la", "du", "au", "aux", "et", "ou", "ce", "il", "elle", "de", "da",
  "do", "en", "al", "se", "su", "lo", "os", "as", "na", "no", "nao", "como",
  "mais", "foi", "sao", "esta", "qui", "pas", "par", "avec", "sont", "dans",
]);

const LABEL_PATTERNS: RegExp[] = [
  /\b(?:ups|fedex|usps|dhl)\b/i,
  /\bship\s*to\b/i,
  /\bshipping\s+label\b/i,
  /\btracking(?:\s+(?:number|no\.?|#))?/i,
  /\bwaybill\b/i,
  /\bair\s*waybill\b/i,
  /顺丰|圆通|中通|申通|韵达/,
  /快递单|运单号|运单|面单/,
];

export type SkipReason = "english" | "blank" | "label";

/** One physical page on the quote. `pageIndex` is 0-based in combined order. */
export type PageLineItem = {
  pageIndex: number;
  billableUnits: number;
  skip: boolean;
  /** Auto skips use english, blank, or label. A customer skip can keep its own wording. */
  skipReason: string | null;
};

export type PageQuote = PageLineItem & {
  /** Words, or CJK characters, stored in `document_pages.word_count`. */
  counted: number;
  billingBasis: "words" | "cjk";
};

/**
 * Chinese, Japanese, and Korean billing units.
 * Each Han, Hiragana, Katakana, or Hangul character is one unit.
 * Each maximal run of ASCII digits or Latin letters is one unit.
 * A run may contain `.` `,` `/` `-` only when that mark sits between alphanumerics
 * (`3.85`, `2019-06`). Spaces and other punctuation are zero.
 */
export function countCjkUnits(text: string): number {
  const chars = Array.from(text);
  let units = 0;
  let index = 0;

  while (index < chars.length) {
    const char = chars[index] ?? "";
    if (CJK_CHAR.test(char)) {
      units += 1;
      index += 1;
      continue;
    }

    if (ALNUM.test(char)) {
      index += 1;
      while (index < chars.length) {
        const next = chars[index] ?? "";
        if (ALNUM.test(next)) {
          index += 1;
          continue;
        }
        const after = chars[index + 1] ?? "";
        if (JOINER.test(next) && ALNUM.test(after)) {
          index += 1;
          continue;
        }
        break;
      }
      units += 1;
      continue;
    }

    index += 1;
  }

  return units;
}

/** Han, Hiragana, Katakana, and Hangul characters. Latin runs and digits are not counted. */
export function countCjkChars(text: string): number {
  return text.match(CJK_CHARS)?.length ?? 0;
}

function assertCount(name: string, count: number): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

/** One kept Latin page is at least one billable page. Every further 250 words is another. */
export function billableUnits(wordCount: number): number {
  assertCount("wordCount", wordCount);
  return Math.max(1, Math.ceil(wordCount / WORDS_PER_BILLABLE_PAGE));
}

/** One kept CJK page is at least one billable page. Every further 1000 characters is another. */
export function billableCjkUnits(charCount: number): number {
  assertCount("charCount", charCount);
  return Math.max(1, Math.ceil(charCount / CJK_CHARS_PER_BILLABLE_PAGE));
}

export function isCjkBillingLanguage(language: string | null | undefined): boolean {
  if (!language) return false;
  const base = language.trim().toLowerCase().split("-")[0] ?? "";
  return base === "zh" || base === "ja" || base === "ko";
}

function targetBase(language: string | null | undefined): string {
  return language?.trim().toLowerCase().split("-")[0] || "en";
}

function withoutPageMarks(text: string): string {
  return text.replace(PAGE_MARK, " ");
}

/**
 * Blank when nothing readable remains, or only a page mark, a logo, or a few OCR scraps.
 * A real line of text is not blank.
 */
function isBlankPage(text: string): boolean {
  const body = withoutPageMarks(text);
  if (!LETTER_OR_NUMBER.test(body)) return true;
  const tokens = body.match(/[A-Za-z]{2,}/g)?.length ?? 0;
  return countCjkChars(body) < 8 && tokens < 3;
}

function isShippingLabel(text: string): boolean {
  const hits = LABEL_PATTERNS.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
  if (hits >= 2) return true;
  // One carrier or waybill cue on a short page, including a Chinese label whose characters outnumber the Latin words.
  return hits === 1 && countWords(text) < 80;
}

function latinWords(text: string): string[] {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/[a-z]+/g) ?? [];
}

function scriptLetters(text: string): { latin: number; cjk: number; other: number } {
  return {
    latin: text.match(/[A-Za-z]/g)?.length ?? 0,
    cjk: countCjkChars(text),
    other: text.match(OTHER_SCRIPT)?.length ?? 0,
  };
}

/**
 * Mostly Latin English prose, and only when the customer asked for English.
 * A Chinese footer or seal on an English translation does not keep the page billable.
 * Checked per page, not from the document language.
 */
function isEnglishOnly(text: string, targetLanguage: string | null | undefined): boolean {
  if (targetBase(targetLanguage) !== "en") return false;
  const letters = scriptLetters(text);
  if (letters.latin === 0 || letters.latin <= letters.cjk + letters.other) return false;
  const words = latinWords(text);
  if (words.length === 0) return false;
  let english = 0;
  let romance = 0;
  for (const word of words) {
    if (ENGLISH_STOPS.has(word)) english += 1;
    if (ROMANCE_STOPS.has(word)) romance += 1;
  }
  return english >= 2 && english > romance;
}

function measure(text: string): { billingBasis: "words" | "cjk"; counted: number } {
  if (isCjkDominant(text)) {
    return { billingBasis: "cjk", counted: countCjkChars(text) };
  }
  return { billingBasis: "words", counted: countWords(text) };
}

/**
 * Bill one physical page.
 * Latin text is `max(1, ceil(words / 250))`. CJK text is `max(1, ceil(chars / 1000))`.
 * A page that is mostly Latin English (when the target is English), a blank page, or a shipping label is 0.
 */
export function quotePage(input: {
  text: string;
  targetLanguage?: string | null;
  pageIndex: number;
}): PageQuote {
  if (!Number.isInteger(input.pageIndex) || input.pageIndex < 0) {
    throw new Error("pageIndex must be a non-negative integer");
  }
  const text = input.text ?? "";
  if (isShippingLabel(text)) {
    const measured = measure(text);
    return {
      pageIndex: input.pageIndex,
      billableUnits: 0,
      skip: true,
      skipReason: "label",
      counted: measured.counted,
      billingBasis: measured.billingBasis,
    };
  }
  if (isBlankPage(text)) {
    return {
      pageIndex: input.pageIndex,
      billableUnits: 0,
      skip: true,
      skipReason: "blank",
      counted: 0,
      billingBasis: "words",
    };
  }
  const measured = measure(text);
  if (isEnglishOnly(text, input.targetLanguage)) {
    return {
      pageIndex: input.pageIndex,
      billableUnits: 0,
      skip: true,
      skipReason: "english",
      counted: countWords(text),
      billingBasis: "words",
    };
  }
  if (measured.billingBasis === "cjk") {
    return {
      pageIndex: input.pageIndex,
      billableUnits: billableCjkUnits(measured.counted),
      skip: false,
      skipReason: null,
      counted: measured.counted,
      billingBasis: "cjk",
    };
  }
  return {
    pageIndex: input.pageIndex,
    billableUnits: billableUnits(measured.counted),
    skip: false,
    skipReason: null,
    counted: measured.counted,
    billingBasis: "words",
  };
}

export function quotePages(
  texts: readonly string[],
  targetLanguage?: string | null,
): { lineItems: PageLineItem[]; billablePages: number; totalCents: number } {
  const lineItems = texts.map((text, pageIndex) => {
    const quote = quotePage({ text, targetLanguage, pageIndex });
    return {
      pageIndex: quote.pageIndex,
      billableUnits: quote.billableUnits,
      skip: quote.skip,
      skipReason: quote.skipReason,
    };
  });
  const billablePages = lineItems.reduce((sum, item) => sum + item.billableUnits, 0);
  return { lineItems, billablePages, totalCents: totalCents(billablePages) };
}

/**
 * Density written to `document_pages.billable_units`.
 * A skipped page still stores the formula, at least 1, so turning the skip off charges that page.
 */
export function storedDensity(
  quote: Pick<PageQuote, "skip" | "billingBasis" | "counted" | "billableUnits">,
): number {
  if (!quote.skip) return quote.billableUnits;
  if (quote.billingBasis === "cjk") return billableCjkUnits(quote.counted);
  return billableUnits(quote.counted);
}

/**
 * Charged line for a stored page. `skip: false` bills the stored density.
 * `skip: true`, or a missing flag on a page the live quote would skip, bills 0.
 * A stored reason such as "already English" is kept.
 */
export function lineItemForStoredPage(input: {
  pageIndex: number;
  text: string | null;
  targetLanguage?: string | null;
  billableUnits: number | null;
  skip?: boolean;
  skipReason?: string | null;
}): PageLineItem {
  const live = quotePage({
    text: input.text ?? "",
    targetLanguage: input.targetLanguage,
    pageIndex: input.pageIndex,
  });
  if (input.skip === false) {
    const units =
      input.billableUnits == null
        ? live.skip
          ? storedDensity(live)
          : live.billableUnits
        : input.billableUnits;
    return {
      pageIndex: input.pageIndex,
      billableUnits: units,
      skip: false,
      skipReason: null,
    };
  }
  const storedReason = input.skipReason?.trim() ? input.skipReason : null;
  const autoSkip = input.skip == null && (live.skip || input.billableUnits === 0);
  if (input.skip === true || autoSkip) {
    return {
      pageIndex: input.pageIndex,
      billableUnits: 0,
      skip: true,
      skipReason: storedReason ?? live.skipReason ?? (input.billableUnits === 0 ? "blank" : null),
    };
  }
  if (input.billableUnits == null) {
    return {
      pageIndex: live.pageIndex,
      billableUnits: live.billableUnits,
      skip: live.skip,
      skipReason: live.skipReason,
    };
  }
  return {
    pageIndex: input.pageIndex,
    billableUnits: input.billableUnits,
    skip: false,
    skipReason: null,
  };
}

const SKIP_PAGE_RULE =
  "Blank pages and shipping labels are not billed. Pages that are already English are not billed when the translation is into English.";

export const WORD_PAGE_RULE = `250 words per billable page. Each page with text counts as at least 1. ${SKIP_PAGE_RULE}`;

export const CJK_PAGE_RULE = `1000 Chinese, Japanese, or Korean characters per billable page. Each page with those characters counts as at least 1. ${SKIP_PAGE_RULE}`;

/** Quote-screen copy for the rule that priced this order. */
export function pageRuleForLanguages(languages: Array<string | null | undefined>): string {
  const known = [
    ...new Set(
      languages
        .map((language) => language?.trim().toLowerCase().split("-")[0] ?? "")
        .filter((language) => language.length > 0),
    ),
  ];
  if (known.length === 0) return WORD_PAGE_RULE;
  const cjk = known.some((language) => isCjkBillingLanguage(language));
  const other = known.some((language) => !isCjkBillingLanguage(language));
  if (cjk && other) {
    return `1000 Chinese, Japanese, or Korean characters per billable page. 250 words per billable page. Each page with text counts as at least 1. ${SKIP_PAGE_RULE}`;
  }
  if (cjk) return CJK_PAGE_RULE;
  return WORD_PAGE_RULE;
}

export function sumBillableUnits(wordCounts: number[]): number {
  return wordCounts.reduce((sum, words) => sum + billableUnits(words), 0);
}

export function totalCents(
  billablePages: number,
  unitPriceCents: number = UNIT_PRICE_CENTS,
): number {
  if (!Number.isInteger(billablePages) || billablePages < 0) {
    throw new Error("billablePages must be a non-negative integer");
  }
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
    throw new Error("unitPriceCents must be a non-negative integer");
  }

  return billablePages * unitPriceCents;
}
