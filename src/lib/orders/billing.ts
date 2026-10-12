import {
  CJK_UNITS_PER_BILLABLE_PAGE,
  UNIT_PRICE_CENTS,
  WORDS_PER_BILLABLE_PAGE,
} from "./constants";

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

function assertCount(name: string, count: number): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

/** One original side is at least one billable page. Every further 250 words is another. */
export function billableUnits(wordCount: number): number {
  assertCount("wordCount", wordCount);
  return Math.max(1, Math.ceil(wordCount / WORDS_PER_BILLABLE_PAGE));
}

/** One original side is at least one billable page. Every further 400 CJK units is another. */
export function billableCjkUnits(unitCount: number): number {
  assertCount("unitCount", unitCount);
  return Math.max(1, Math.ceil(unitCount / CJK_UNITS_PER_BILLABLE_PAGE));
}

export function isCjkBillingLanguage(language: string | null | undefined): boolean {
  if (!language) return false;
  const base = language.trim().toLowerCase().split("-")[0] ?? "";
  return base === "zh" || base === "ja" || base === "ko";
}

export const WORD_PAGE_RULE =
  "250 words per billable page. Each original page side counts as at least 1.";

export const CJK_PAGE_RULE =
  "400 units per billable page. Each Chinese, Japanese, or Korean character counts as 1 unit, and each number or Latin-letter group (such as 2019, GPA, or 3.85) counts as 1. Spaces and punctuation count as 0. Each original page side counts as at least 1.";

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
  if (cjk && other) return `${CJK_PAGE_RULE} ${WORD_PAGE_RULE}`;
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
