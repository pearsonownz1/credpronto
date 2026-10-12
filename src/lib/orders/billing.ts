import { UNIT_PRICE_CENTS, UNITS_PER_BILLABLE_PAGE } from "./constants";

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

/**
 * One physical page is one billable page until it exceeds 1,000 units.
 * A skipped page is billed separately as zero.
 */
export function billableUnits(unitCount: number): number {
  assertCount("unitCount", unitCount);
  return Math.max(1, Math.ceil(unitCount / UNITS_PER_BILLABLE_PAGE));
}

/** Same 1,000-unit rule as billableUnits. Kept so older call sites keep working. */
export function billableCjkUnits(unitCount: number): number {
  return billableUnits(unitCount);
}

export const PAGE_RULE =
  "$9.95 per physical page. A page counts as more than one billable page only when it exceeds 1,000 units. Each Chinese, Japanese, or Korean character counts as 1 unit, and each number or Latin-letter group (such as 2019, GPA, or 3.85) counts as 1. Spaces and punctuation count as 0.";

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
