import { pinyin } from "pinyin-pro";
import { isElectronicSignatureToken } from "./pdf/structure";

export const QA_ISSUE_TYPES = ["name", "date", "number", "missing_text", "layout", "other"] as const;
export const QA_SEVERITIES = ["high", "medium", "low"] as const;
export const QA_STATUSES = ["pass", "fail", "retranslated"] as const;

export type QaIssueType = (typeof QA_ISSUE_TYPES)[number];
export type QaSeverity = (typeof QA_SEVERITIES)[number];
export type QaStatus = (typeof QA_STATUSES)[number];

export type QaIssue = {
  type: QaIssueType;
  severity: QaSeverity;
  page: number | null;
  original: string;
  translated: string;
  note: string;
};

export type QaAssessment = {
  pass: boolean;
  score: number;
  issues: QaIssue[];
};

export const QA_REVIEW_REASON = "QA found issues that were not fixed after 2 retranslations.";
export const MAX_QA_ATTEMPTS = 3;

/** Attempts belong to this translation call. Older QA rows on the order do not count. */
export function qaAttemptForRound(round: number): number {
  return round + 1;
}

const NAME_FIELDS = ["full_name", "parent_names", "place_of_birth"] as const;
const PENALTY: Record<QaSeverity, number> = { high: 25, medium: 10, low: 5 };

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function includesText(haystack: string, needle: string): boolean {
  const wanted = collapse(needle).toLowerCase();
  if (!wanted) return true;
  return collapse(haystack).toLowerCase().includes(wanted);
}

function digitRuns(text: string): string[] {
  return Array.from(text.matchAll(/\d{2,}/g), (match) => match[0]);
}

function issue(
  type: QaIssueType,
  page: number | null,
  original: string,
  translated: string,
  note: string,
  severity: QaSeverity = "high",
): QaIssue {
  return { type, severity, page, original, translated, note };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const CN_DIGIT: Record<string, number> = {
  〇: 0,
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const CYRILLIC: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

type CivilDate = { year: number; month: number; day: number };

function isLatinScriptName(value: string): boolean {
  const letters = value.match(/\p{L}/gu) ?? [];
  return letters.length === 0 || letters.every((letter) => /\p{Script=Latin}/u.test(letter));
}

function romanizedForms(name: string): string[] {
  const forms: string[] = [];
  if (/\p{Script=Han}/u.test(name)) {
    const syllables = pinyin(name, { toneType: "none", type: "array", nonZh: "consecutive" })
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    if (syllables.length > 0) {
      forms.push(syllables.join(" "), syllables.join(""));
    }
  }
  if (/\p{Script=Cyrillic}/u.test(name)) {
    const latin = Array.from(name.toLowerCase(), (char) => CYRILLIC[char] ?? char).join("");
    const cleaned = latin.replace(/\s+/g, " ").trim();
    if (cleaned) forms.push(cleaned);
  }
  return forms;
}

function includesLoose(haystack: string, needle: string): boolean {
  if (includesText(haystack, needle)) return true;
  const tightNeedle = needle.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!tightNeedle) return false;
  const tightHay = haystack.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return tightHay.includes(tightNeedle);
}

/** Case and diacritics fold so Çiğdem matches Cigdem and DAYAN matches Dayan. */
function foldName(value: string): string {
  return collapse(value).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** A birth certificate prints the given name and the surnames on separate lines. */
function wordsInOrder(haystack: string, name: string): boolean {
  const words = name.split(" ").filter((word) => word.length > 1);
  if (words.length < 2) return false;
  let from = 0;
  for (const word of words) {
    const at = haystack.indexOf(word, from);
    if (at < 0) return false;
    from = at + word.length;
  }
  return true;
}

function nameFound(translation: string, name: string): boolean {
  const wanted = foldName(name);
  const folded = foldName(translation);
  if (wanted && (folded.includes(wanted) || wordsInOrder(folded, wanted))) return true;
  return romanizedForms(name).some((form) => includesLoose(translation, form));
}

/** Digit runs that exist only inside an electronic signature are not record numbers. */
function digitsOutsideSignature(source: string): string {
  return source
    .split("\n")
    .map((line) => (isElectronicSignatureToken(line) ? "" : line))
    .join("\n");
}

function parseChineseNumber(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  if (/[十百千]/.test(text)) {
    let total = 0;
    let current = 0;
    const unit: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
    for (const char of text) {
      const scale = unit[char];
      if (scale) {
        total += (current || 1) * scale;
        current = 0;
        continue;
      }
      const digit = CN_DIGIT[char];
      if (digit == null) return null;
      current = digit;
    }
    return total + current;
  }
  let digits = "";
  for (const char of text) {
    const digit = CN_DIGIT[char];
    if (digit == null || digit > 9) return null;
    digits += String(digit);
  }
  return digits ? Number(digits) : null;
}

function civilDate(year: number, month: number, day: number): CivilDate | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

function monthIndex(name: string): number | null {
  const index = MONTHS.findIndex((month) => month.toLowerCase() === name.toLowerCase());
  return index >= 0 ? index + 1 : null;
}

function dateFormatOf(
  confirmations: Array<{ fieldKey: string; confirmedValue: string | null }>,
): "MM/DD/YYYY" | "DD/MM/YYYY" {
  const format = confirmations.find((field) => field.fieldKey === "date_format")?.confirmedValue?.trim();
  return format === "DD/MM/YYYY" ? "DD/MM/YYYY" : "MM/DD/YYYY";
}

export function parseConfirmedDate(
  value: string,
  format: "MM/DD/YYYY" | "DD/MM/YYYY",
): CivilDate | null {
  const text = collapse(value);
  const chinese = text.match(
    /^([〇零一二三四五六七八九十百千两\d]+)年([〇零一二三四五六七八九十百千两\d]+)月([〇零一二三四五六七八九十百千两\d]+)日(?:[〇零一二三四五六七八九十百千两\d]+时(?:[〇零一二三四五六七八九十百千两\d]+分)?)?$/,
  );
  if (chinese) {
    const year = parseChineseNumber(chinese[1] ?? "");
    const month = parseChineseNumber(chinese[2] ?? "");
    const day = parseChineseNumber(chinese[3] ?? "");
    if (year == null || month == null || day == null) return null;
    return civilDate(year, month, day);
  }

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return civilDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const named = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (named) {
    const month = monthIndex(named[1] ?? "");
    if (month == null) return null;
    return civilDate(Number(named[3]), month, Number(named[2]));
  }
  const namedDayFirst = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (namedDayFirst) {
    const month = monthIndex(namedDayFirst[2] ?? "");
    if (month == null) return null;
    return civilDate(Number(namedDayFirst[3]), month, Number(namedDayFirst[1]));
  }

  const numeric = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (!numeric) return null;
  const first = Number(numeric[1]);
  const second = Number(numeric[2]);
  const year = Number(numeric[3]);
  const ordered = format === "DD/MM/YYYY" ? civilDate(year, second, first) : civilDate(year, first, second);
  if (ordered) return ordered;
  return format === "DD/MM/YYYY" ? civilDate(year, first, second) : civilDate(year, second, first);
}

function dateForms(date: CivilDate): string[] {
  const month = MONTHS[date.month - 1] ?? "";
  const mm = String(date.month).padStart(2, "0");
  const dd = String(date.day).padStart(2, "0");
  return [
    `${month} ${date.day}, ${date.year}`,
    `${month} ${dd}, ${date.year}`,
    `${date.day} ${month} ${date.year}`,
    `${dd} ${month} ${date.year}`,
    `${mm}/${dd}/${date.year}`,
    `${dd}/${mm}/${date.year}`,
    `${date.month}/${date.day}/${date.year}`,
    `${date.day}/${date.month}/${date.year}`,
    `${date.year}-${mm}-${dd}`,
  ];
}

function dateFound(translation: string, value: string, format: "MM/DD/YYYY" | "DD/MM/YYYY"): boolean | null {
  const parsed = parseConfirmedDate(value, format);
  if (!parsed) return null;
  return dateForms(parsed).some((form) => includesText(translation, form));
}

/**
 * Each uploaded file that prints a confirmed name must keep it in its own translated pages.
 * A name printed on the transcript does not cover a diploma that dropped it.
 */
function missingNamesPerDocument(
  input: {
    originalPages: Array<{ number: number; text: string; documentId?: string }>;
    translatedPages: Array<{ number: number; text: string }>;
    confirmations: Array<{ fieldKey: string; confirmedValue: string | null; documentId?: string }>;
  },
  already: QaIssue[],
): QaIssue[] {
  const documentIds = [...new Set(input.originalPages.flatMap((page) => (page.documentId ? [page.documentId] : [])))];
  if (documentIds.length < 2) return [];
  const flagged = new Set(already.filter((item) => item.type === "name").map((item) => item.original));
  const translatedByNumber = new Map(input.translatedPages.map((page) => [page.number, page.text]));
  const found: QaIssue[] = [];
  for (const documentId of documentIds) {
    const pages = input.originalPages.filter((page) => page.documentId === documentId);
    const source = pages.map((page) => page.text).join("\n");
    const translated = pages.map((page) => translatedByNumber.get(page.number) ?? "").join("\n");
    const seen = new Set<string>();
    for (const field of input.confirmations) {
      if (!(NAME_FIELDS as readonly string[]).includes(field.fieldKey)) continue;
      if (field.documentId && field.documentId !== documentId) continue;
      for (const raw of collapse(field.confirmedValue ?? "").split(";")) {
        const part = collapse(raw);
        if (!part || seen.has(part) || flagged.has(part)) continue;
        seen.add(part);
        if (!nameFound(source, part) || nameFound(translated, part)) continue;
        found.push(
          issue(
            "name",
            pages[0]?.number ?? null,
            part,
            translated.slice(0, 240),
            `Confirmed ${field.fieldKey} is missing from the translation of this document.`,
            isLatinScriptName(part) ? "high" : "medium",
          ),
        );
      }
    }
  }
  return found;
}

export function scoreIssues(issues: QaIssue[]): number {
  const penalty = issues.reduce((sum, item) => sum + PENALTY[item.severity], 0);
  return Math.max(0, 100 - penalty);
}

function pageCountLabel(count: number): string {
  return count === 1 ? "1 page" : `${count} pages`;
}

export function assessTranslation(input: {
  /** documentId groups pages by uploaded file so a name missing from one file is caught. */
  originalPages: Array<{ number: number; text: string; documentId?: string }>;
  translatedPages: Array<{ number: number; text: string }>;
  confirmations: Array<{ fieldKey: string; confirmedValue: string | null; documentId?: string }>;
}): QaAssessment {
  const issues: QaIssue[] = [];
  const translation = input.translatedPages
    .map((page) => page.text)
    .join("\n");

  if (input.originalPages.length !== input.translatedPages.length) {
    issues.push(
      issue(
        "layout",
        null,
        pageCountLabel(input.originalPages.length),
        pageCountLabel(input.translatedPages.length),
        "The translation page count does not match the original.",
      ),
    );
  }

  const translatedByNumber = new Map(input.translatedPages.map((page) => [page.number, page.text]));
  for (const page of input.originalPages) {
    const source = page.text.trim();
    const translated = (translatedByNumber.get(page.number) ?? "").trim();
    if (source.length > 0 && translated.length === 0) {
      issues.push(
        issue(
          "missing_text",
          page.number,
          source.slice(0, 240),
          "",
          "The original page has text and the translation is empty.",
        ),
      );
    }
    for (const number of new Set(digitRuns(digitsOutsideSignature(source)))) {
      if (!translation.includes(number)) {
        issues.push(
          issue(
            "number",
            page.number,
            number,
            translated.slice(0, 240),
            `The number ${number} is missing from the translation.`,
          ),
        );
      }
    }
  }

  const format = dateFormatOf(input.confirmations);
  for (const field of input.confirmations) {
    const value = collapse(field.confirmedValue ?? "");
    if (!value) continue;
    if (field.fieldKey === "date_of_birth") {
      const found = dateFound(translation, value, format);
      if (found === true) continue;
      if (found === null) {
        issues.push(
          issue(
            "date",
            null,
            value,
            "",
            "Confirmed date_of_birth could not be read as a date.",
            "low",
          ),
        );
        continue;
      }
      issues.push(
        issue("date", null, value, "", "Confirmed date_of_birth is missing from the translation."),
      );
    }
    if ((NAME_FIELDS as readonly string[]).includes(field.fieldKey)) {
      const parts = value.split(";").map((part) => collapse(part));
      for (const part of parts) {
        if (!part || nameFound(translation, part)) continue;
        const severity = isLatinScriptName(part) ? "high" : "medium";
        issues.push(
          issue(
            "name",
            null,
            part,
            "",
            `Confirmed ${field.fieldKey} is missing from the translation.`,
            severity,
          ),
        );
      }
    }
  }

  issues.push(...missingNamesPerDocument(input, issues));

  const score = scoreIssues(issues);
  return { pass: !issues.some((item) => item.severity === "high") && score >= 80, score, issues };
}

export type QaRunRecord = {
  id: string;
  orderId: string;
  attempt: number;
  status: QaStatus;
  score: number;
  issues: QaIssue[];
  createdAt: string;
};

/** First clean pass is `pass`. A later pass, or a failure that will be retried, is `retranslated`. */
export function qaStatusForRun(input: { pass: boolean; attempt: number }): QaStatus {
  if (input.attempt >= MAX_QA_ATTEMPTS && !input.pass) return "fail";
  if (input.pass && input.attempt <= 1) return "pass";
  return "retranslated";
}

export function qaWillRetry(input: { pass: boolean; attempt: number }): boolean {
  return !input.pass && input.attempt < MAX_QA_ATTEMPTS;
}
