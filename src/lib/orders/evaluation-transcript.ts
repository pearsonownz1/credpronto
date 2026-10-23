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

/** The third column is Note × Coefficient, so the mark is that product divided by the coefficient. */
function mark(weighted: number, coefficient: number): string | null {
  if (!(coefficient > 0) || !(weighted > 0)) return null;
  const grade = Math.round((weighted / coefficient) * 100) / 100;
  if (!(grade > 0) || grade > 20) return null;
  return String(grade);
}

/**
 * Reads a coefficient relevé into a course-by-course extract.
 * Returns null when the page is not that kind of transcript.
 */
export function courseExtractFromTranscript(text: string): TranscriptCourseExtract | null {
  if (!isCoefficientTranscript(text)) return null;
  const lines = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const courses = [];
  for (const line of lines) {
    const match = line.match(COURSE_ROW);
    if (!match?.[1] || !match[2] || !match[3]) continue;
    const originalName = match[1].trim();
    if (skippedCourseName(originalName)) continue;
    const localCredits = amount(match[2]);
    const localGrade = mark(amount(match[3]), localCredits);
    if (!localGrade || !Number.isFinite(localCredits) || localCredits <= 0) continue;
    courses.push({ originalName, englishName: originalName, localCredits, localGrade });
  }
  const applicant = applicantOf(lines);
  const institution = institutionOf(lines);
  const country = countryOf(text);
  const credential = credentialOf(lines);
  const year = sessionYear(text);
  if (!applicant || !institution || !country || !credential || !year || courses.length < 3) return null;
  const result = decisionOf(lines);
  return {
    applicant,
    institution,
    country,
    credential,
    scale: "20",
    ...(result ? { result } : {}),
    years: [{ year, courses }],
  };
}

/**
 * Turns a model extract that copied Note × Coefficient into the mark out of 20.
 * Total and average rows are dropped. A page that is already on the scale is left as it is.
 */
export function recoverCourseExtract<T extends TranscriptCourseExtract>(extracted: T): T {
  const max = extracted.scale === "10" ? 10 : extracted.scale === "20" ? 20 : null;
  if (max == null) return extracted;
  let scale = extracted.scale;
  const years = [];
  for (const year of extracted.years) {
    const courses = [];
    for (const course of year.courses) {
      if (skippedCourseName(course.originalName) || skippedCourseName(course.englishName)) continue;
      const weighted = amount(course.localGrade);
      const credits = course.localCredits;
      if (Number.isFinite(weighted) && weighted > max && credits > 0) {
        const grade = Math.round((weighted / credits) * 100) / 100;
        if (grade > 0 && grade <= 20) {
          if (grade > 10) scale = "20";
          courses.push({ ...course, localGrade: String(grade) });
          continue;
        }
      }
      courses.push(course);
    }
    if (courses.length > 0 && year.year.trim()) years.push({ ...year, courses });
  }
  if (years.length === 0) return extracted;
  return { ...extracted, scale, years };
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
