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
): QaIssue {
  return { type, severity: "high", page, original, translated, note };
}

export function scoreIssues(issues: QaIssue[]): number {
  const penalty = issues.reduce((sum, item) => sum + PENALTY[item.severity], 0);
  return Math.max(0, 100 - penalty);
}

export function assessTranslation(input: {
  originalPages: Array<{ number: number; text: string }>;
  translatedPages: Array<{ number: number; text: string }>;
  confirmations: Array<{ fieldKey: string; confirmedValue: string | null }>;
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
        `${input.originalPages.length} pages`,
        `${input.translatedPages.length} pages`,
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
    for (const number of new Set(digitRuns(source))) {
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

  for (const field of input.confirmations) {
    const value = collapse(field.confirmedValue ?? "");
    if (!value) continue;
    if (field.fieldKey === "date_of_birth" && !includesText(translation, value)) {
      issues.push(
        issue("date", null, value, "", "Confirmed date_of_birth is missing from the translation."),
      );
    }
    if ((NAME_FIELDS as readonly string[]).includes(field.fieldKey)) {
      const parts = field.fieldKey === "parent_names" ? value.split(";").map((part) => collapse(part)) : [value];
      for (const part of parts) {
        if (!part || includesText(translation, part)) continue;
        issues.push(
          issue(
            field.fieldKey === "date_of_birth" ? "date" : "name",
            null,
            part,
            "",
            `Confirmed ${field.fieldKey} is missing from the translation.`,
          ),
        );
      }
    }
  }

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
