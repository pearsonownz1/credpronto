import type { EvaluationService } from "./types";

export type TranscriptCourseExtract = {
  applicant: string;
  institution: string;
  country: string;
  credential: string;
  scale: "10" | "20" | "letter";
  result?: string;
  years: Array<{
    year: string;
    courses: Array<{ originalName: string; englishName: string; localCredits: number; localGrade: string }>;
  }>;
};

export type EvaluationSourcePage = {
  documentId: string;
  pageNumber: number;
  ocrText: string | null;
};

const COURSE_ROW = /^(.+?)\s*\|\s*(\d+(?:[.,]\d+)?)\s*\|\s*(\d+(?:[.,]\d+)?)\s*$/;

function fold(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function amount(value: string): number {
  return Number(value.replace(",", "."));
}

/** Totals, averages, and bonus lines are not courses. */
function skippedCourseName(name: string): boolean {
  const folded = fold(name);
  return (
    /^(total|moyenne|average|grand total|decision|matieres|subjects)\b/.test(folded) ||
    /\(en \+\)/.test(folded) ||
    /^epreuves facultatives/.test(folded) ||
    /^optional examinations/.test(folded)
  );
}

/**
 * A Cameroon-style relevé prints Subject | Coefficient | Note × Coefficient.
 * The third column is the mark times the coefficient, not the mark out of 20.
 */
export function isCoefficientTranscript(text: string): boolean {
  return /relev[eé]\s+de\s+notes|note\s*x\s*coef/i.test(text);
}

export function isTranscriptPage(text: string): boolean {
  if (isCoefficientTranscript(text)) return true;
  let rows = 0;
  for (const line of text.split(/\n/)) {
    if (COURSE_ROW.test(line.trim())) rows += 1;
  }
  return rows >= 3;
}

function countryOf(text: string): string {
  const folded = fold(text);
  if (folded.includes("cameroun") || folded.includes("cameroon")) return "Cameroon";
  if (folded.includes("france")) return "France";
  if (folded.includes("mexico") || folded.includes("mexique")) return "Mexico";
  return "";
}

function applicantOf(lines: readonly string[]): string {
  for (const line of lines) {
    const match = line.trim().match(/^(?:Mlle|Mme|Mr|Mrs|M)\.?\s+(.+)$/);
    if (match?.[1] && !/^\d/.test(match[1])) return match[1].trim();
  }
  return "";
}

function institutionOf(lines: readonly string[]): string {
  return (
    lines.find((line) => /office du baccalaur[eé]at|baccalaur[eé]at du cameroun/i.test(line))?.trim() ??
    lines.find((line) => line.trim().length > 0)?.trim() ??
    ""
  );
}

function credentialOf(lines: readonly string[]): string {
  const titles = lines.filter((line) => /baccalaur/i.test(line) && !/office du baccalaur/i.test(line));
  return titles.sort((a, b) => b.trim().length - a.trim().length)[0]?.trim() ?? "";
}

function sessionYear(text: string): string {
  const match = text.match(/session(?:\s+de)?(?:\s+[a-zàâéèêëîïôùûüç]+)?\s+(\d{4})/i);
  return match?.[1] ?? "";
}

function decisionOf(lines: readonly string[]): string {
  for (const line of lines) {
    const cell = line.trim().match(/^d[eé]cision\s*\|\s*(.+)$/i);
    if (cell?.[1]) return cell[1].trim();
  }
  if (/admis/i.test(lines.join("\n"))) return "Admis";
  return "";
}

export type TranscriptRowFailure = {
  row: string;
  reason: string;
};

export type TranscriptCourseRead = {
  extract: TranscriptCourseExtract | null;
  failures: TranscriptRowFailure[];
};

const NUMBER = /^\d+(?:[.,]\d+)?$/;
const THREE_CELLS = /^(.+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*$/;
const TWO_CELLS = /^(.+?)\s*\|\s*([^|]+?)\s*$/;

/** The header or column label says the third value is Note × Coefficient. */
function showsWeightedColumn(text: string): boolean {
  return /note\s*[x×]\s*coef|grade\s*[x×]\s*coef/i.test(text);
}

function quotient(raw: number, coefficient: number): number {
  return Math.round((raw / coefficient) * 100) / 100;
}

/**
 * A Note × Coef column is always divided. Any other value is divided only when it
 * is over 20 and the coefficient brings it back onto the scale. A mark already
 * out of 20 stays as printed.
 */
function resolveMark(
  raw: number,
  coefficient: number,
  weightedColumn: boolean,
): { grade: string } | { reason: string } {
  if (!Number.isFinite(coefficient)) return { reason: "No coefficient" };
  if (coefficient === 0) return { reason: "Coefficient is 0" };
  if (coefficient < 0) return { reason: "No coefficient" };
  if (!Number.isFinite(raw) || raw <= 0) return { reason: "Result is over 20" };
  const divided = quotient(raw, coefficient);
  const dividedFits = divided > 0 && divided <= 20;
  if (raw > 20) return dividedFits ? { grade: String(divided) } : { reason: "Result is over 20" };
  if (!weightedColumn) return { grade: String(raw) };
  return dividedFits ? { grade: String(divided) } : { reason: "Result is over 20" };
}

function rowLabel(name: string, credits: number, grade: string): string {
  return `${name} | ${credits} | ${grade}`;
}

/**
 * Reads a relevé into a course-by-course extract.
 * Dropped course rows are listed in `failures` instead of being skipped quietly.
 * `extract` is null when the page is not a relevé or it does not have enough courses.
 */
export function courseExtractFromTranscript(text: string): TranscriptCourseRead {
  if (!isCoefficientTranscript(text)) return { extract: null, failures: [] };
  const lines = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const weightedColumn = showsWeightedColumn(text);
  const failures: TranscriptRowFailure[] = [];
  const courses = [];
  for (const line of lines) {
    const three = line.match(THREE_CELLS);
    if (three?.[1]) {
      const originalName = three[1].trim();
      if (skippedCourseName(originalName)) continue;
      const coefCell = three[2]?.trim() ?? "";
      const gradeCell = three[3]?.trim() ?? "";
      if (!NUMBER.test(coefCell)) {
        if (coefCell.length === 0 && NUMBER.test(gradeCell)) failures.push({ row: line, reason: "No coefficient" });
        continue;
      }
      if (!NUMBER.test(gradeCell)) continue;
      const localCredits = amount(coefCell);
      const resolved = resolveMark(amount(gradeCell), localCredits, weightedColumn);
      if ("reason" in resolved) {
        failures.push({ row: line, reason: resolved.reason });
        continue;
      }
      courses.push({ originalName, englishName: originalName, localCredits, localGrade: resolved.grade });
      continue;
    }
    const two = line.match(TWO_CELLS);
    if (!two?.[1] || !two[2]) continue;
    const originalName = two[1].trim();
    if (skippedCourseName(originalName) || !NUMBER.test(two[2].trim())) continue;
    failures.push({ row: line, reason: "No coefficient" });
  }
  const applicant = applicantOf(lines);
  const institution = institutionOf(lines);
  const country = countryOf(text);
  const credential = credentialOf(lines);
  const year = sessionYear(text);
  if (!applicant || !institution || !country || !credential || !year || courses.length < 3) {
    return { extract: null, failures };
  }
  const result = decisionOf(lines);
  return {
    extract: {
      applicant,
      institution,
      country,
      credential,
      scale: "20",
      ...(result ? { result } : {}),
      years: [{ year, courses }],
    },
    failures,
  };
}

/**
 * Turns a model extract that copied a weighted product over 20 into the mark.
 * Total and average rows are left out. A mark already out of 20 is kept.
 * Rows that cannot be used are listed in `failures`.
 */
export function recoverCourseExtract<T extends TranscriptCourseExtract>(
  extracted: T,
): { extract: T; failures: TranscriptRowFailure[] } {
  if (extracted.scale === "letter") return { extract: extracted, failures: [] };
  let scale = extracted.scale;
  const failures: TranscriptRowFailure[] = [];
  const years = [];
  for (const year of extracted.years) {
    const courses = [];
    for (const course of year.courses) {
      if (skippedCourseName(course.originalName) || skippedCourseName(course.englishName)) continue;
      const row = rowLabel(course.originalName, course.localCredits, course.localGrade);
      const raw = amount(course.localGrade);
      const credits = course.localCredits;
      if (!Number.isFinite(credits)) {
        failures.push({ row, reason: "No coefficient" });
        continue;
      }
      const resolved = resolveMark(raw, credits, false);
      if ("reason" in resolved) {
        failures.push({ row, reason: resolved.reason });
        continue;
      }
      if (Number(resolved.grade) > 10) scale = "20";
      courses.push({ ...course, localGrade: resolved.grade });
    }
    if (courses.length > 0 && year.year.trim()) years.push({ ...year, courses });
  }
  if (years.length === 0 && failures.length === 0) return { extract: extracted, failures };
  return { extract: { ...extracted, scale, years }, failures };
}

/** Course-by-course reads the transcript pages. A diploma reads the other pages. */
export function textForPaidEvaluation(
  documents: readonly { id: string; position: number }[],
  pages: readonly EvaluationSourcePage[],
  service: EvaluationService,
): string {
  const position = new Map(documents.map((document) => [document.id, document.position]));
  const ordered = [...pages]
    .filter((page) => (page.ocrText ?? "").trim().length > 0)
    .sort((a, b) => {
      const byDocument = (position.get(a.documentId) ?? 0) - (position.get(b.documentId) ?? 0);
      if (byDocument !== 0) return byDocument;
      return a.pageNumber - b.pageNumber;
    });
  const transcript = new Set(ordered.filter((page) => isTranscriptPage(page.ocrText ?? "")));
  const chosen =
    service === "course_by_course"
      ? transcript.size > 0
        ? ordered.filter((page) => transcript.has(page))
        : ordered
      : transcript.size > 0 && transcript.size < ordered.length
        ? ordered.filter((page) => !transcript.has(page))
        : ordered;
  return chosen
    .map((page) => page.ocrText?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}
