import { CJK_CHARS_PER_BILLABLE_PAGE, UNIT_PRICE_CENTS, WORDS_PER_BILLABLE_PAGE } from "./constants";
import { countWords, isCjkDominant } from "./words";

const CJK_CHAR =
  /^(?:\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul})$/u;
const ALNUM = /^[A-Za-z0-9]$/;
/** Separators that stay inside a number or Latin run when they sit between alphanumerics. */
const JOINER = /^[.,/-]$/;

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

const CJK_CHARS = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/gu;

/** Han, Hiragana, Katakana, and Hangul characters. Latin groups and digits are not counted. */
export function countCjkChars(text: string): number {
  return text.match(CJK_CHARS)?.length ?? 0;
}

export type BillingBasis = "words" | "chars";

/** Words for a word-based page, or CJK characters for a character-based page. */
export function countedForPage(text: string): { basis: BillingBasis; counted: number } {
  if (isCjkDominant(text)) return { basis: "chars", counted: countCjkChars(text) };
  return { basis: "words", counted: countWords(text) };
}

function assertCount(name: string, count: number): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

/** Word-based scripts: one physical page is 1 billable page through 250 words. */
export function billableUnits(wordCount: number): number {
  assertCount("wordCount", wordCount);
  return Math.max(1, Math.ceil(wordCount / WORDS_PER_BILLABLE_PAGE));
}

/** Character-based text: one physical page is 1 billable page through 1,000 CJK characters. */
export function billableCjkUnits(charCount: number): number {
  assertCount("charCount", charCount);
  return Math.max(1, Math.ceil(charCount / CJK_CHARS_PER_BILLABLE_PAGE));
}

export function billableForText(text: string): number {
  const counted = countedForPage(text);
  return counted.basis === "chars" ? billableCjkUnits(counted.counted) : billableUnits(counted.counted);
}

export const PAGE_RULE = "About 250 words (or 1,000 characters) per page.";

export const WORD_PAGE_RULE = PAGE_RULE;
export const CJK_PAGE_RULE = PAGE_RULE;

/** Quote-screen copy. The physical-page rule is the same for every detected language. */
export function pageRuleForLanguages(languages: Array<string | null | undefined>): string {
  void languages;
  return PAGE_RULE;
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
