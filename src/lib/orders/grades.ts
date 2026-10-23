export const GRADE_SCALE_10 =
  "Grades are on a 10-point scale. 9.0–10 is A (4.0), 8.0–8.9 is B (3.0), 7.0–7.9 is C (2.0), 6.0–6.9 is D (1.0), and below 6 is F (0).";

export const GRADE_SCALE_20 =
  "Grades are on a 20-point scale with 10 as the pass mark. 16–20 is A (4.0), 14–15.99 is B (3.0), 10–13.99 is C (2.0). Below 10 is D (1.0) when the credential was passed, and F (0) when the credential was failed.";

/** Default pass mark for a 20-point system (France, Cameroon and other French-model systems). */
export const DEFAULT_PASS_MARK_20 = 10;

export const GRADE_SCALE_LETTER =
  "Letter grades keep their printed mark. Points are A 4.0, A- 3.7, B+ 3.3, B 3.0, B- 2.7, C+ 2.3, C 2.0, C- 1.7, D+ 1.3, D 1.0, D- 0.7, and F 0.";

const LETTER_POINTS: Record<string, number> = {
  A: 4,
  "A-": 3.7,
  "B+": 3.3,
  B: 3,
  "B-": 2.7,
  "C+": 2.3,
  C: 2,
  "C-": 1.7,
  "D+": 1.3,
  D: 1,
  "D-": 0.7,
  F: 0,
};

export type GradeScale = "10" | "20" | "letter";

export type MappedGrade = {
  usGrade: string;
  points: number;
};

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function gradeScaleText(scale: GradeScale): string {
  if (scale === "10") return GRADE_SCALE_10;
  if (scale === "20") return GRADE_SCALE_20;
  return GRADE_SCALE_LETTER;
}

export function usEquivalency(credential: string): string | null {
  const value = credential.toLowerCase();
  if (/doctor|doctorado|doctorat|doctoral|\bph\.?\s*d\b/.test(value)) return "Doctoral degree";
  if (/master|maestr|maîtrise|maitrise|\bm\.?\s*sc\b/.test(value)) return "Master's degree";
  if (/bachelor|licenciatura|licence|license|bacharel/.test(value)) return "Bachelor's degree";
  if (/associate/.test(value)) return "Associate degree";
  if (/high school|bachillerato|baccalaur/.test(value)) return "High school diploma";
  return null;
}

function band(grade: number, rows: Array<[number, string, number]>): MappedGrade | null {
  for (const [minimum, usGrade, points] of rows) {
    if (grade >= minimum) return { usGrade, points };
  }
  return null;
}

export type GradeMapOptions = {
  /** Pass mark on a 20-point scale. Defaults to 10. */
  passMark?: number;
  /**
   * True when the credential overall was awarded (Admis, Passed).
   * False when the credential itself was failed. Omit when the document does not say.
   */
  credentialPassed?: boolean;
};

/**
 * Reads the printed overall decision. Negatives are tested first, so a phrase such as
 * "non diplômé" or "not graduated" is failed even though it contains a passing word.
 * Matching ignores accents and case.
 */
const FAILED_DECISION =
  /\b(non[\s-]?diplomee?|non[\s-]?validee?|non[\s-]?admis|no[\s-]?aprobad[oa]|nao[\s-]?aprovad[oa]|not[\s-]?graduated|not[\s-]?graduate|not admitted|reprovad[oa]|reprobad[oa]|suspens[oa]|ajourn\w*|refus\w*|recal\w*|fail\w*|unsuccessful)\b/;

const PASSED_DECISION =
  /\b(graduated|graduate|diplomee|diplome|validee|valide|aprobada|aprobado|aprovada|aprovado|admis|admitted|passed|pass|reussi|passable|successful)\b/;

export function credentialWasPassed(result: string | null | undefined): boolean | undefined {
  const value = foldDecision(result);
  if (!value) return undefined;
  if (FAILED_DECISION.test(value)) return false;
  if (PASSED_DECISION.test(value)) return true;
  return undefined;
}

function foldDecision(result: string | null | undefined): string {
  return (result ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Maps a printed mark to a U.S. letter. For 20-point systems the pass line comes from the
 * system's scale (passMark, default 10): any mark at or above it is a passing letter.
 * A mark under that line is D (1.0) when the credential overall was passed, and F (0)
 * when the credential was failed or the document does not state a result.
 */
export function mapLocalGrade(
  localGrade: string,
  scale: GradeScale,
  options?: GradeMapOptions,
): MappedGrade | null {
  if (scale === "letter") {
    const token = localGrade.trim().toUpperCase().replace(/\s+/g, "");
    const points = LETTER_POINTS[token];
    if (points == null) return null;
    return { usGrade: token, points };
  }
  const match = localGrade.trim().replace(",", ".").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const grade = Number(match[0]);
  if (!Number.isFinite(grade)) return null;
  if (scale === "10") {
    if (grade > 10) return null;
    return band(grade, [
      [9, "A", 4],
      [8, "B", 3],
      [7, "C", 2],
      [6, "D", 1],
      [0, "F", 0],
    ]);
  }
  if (grade > 20) return null;
  const pass = validPassMark(options?.passMark);
  const below = options?.credentialPassed === true ? (["D", 1] as const) : (["F", 0] as const);
  return band(grade, [
    [Math.max(16, pass), "A", 4],
    [Math.max(14, pass), "B", 3],
    [pass, "C", 2],
    [0, below[0], below[1]],
  ]);
}

function validPassMark(value: number | undefined): number {
  if (value == null || !Number.isFinite(value) || value <= 0 || value > 20) return DEFAULT_PASS_MARK_20;
  return Math.min(value, 14);
}

export type RawCourse = {
  originalName: string;
  englishName: string;
  localCredits: number;
  localGrade: string;
};

export type ScoredCourse = RawCourse & {
  usSemesterHours: number;
  usGrade: string;
  gradePoints: number;
};

export const EDGE_GRADE_SCALE_TEXT =
  "Local grades that match the national grading scale use that scale's U.S. equivalent. Other grades use the printed scale.";

export type EdgeGradePoints = {
  indigenousGrade: string;
  usEquivalent: string;
};

export function mapEdgeGrade(localGrade: string, rows: readonly EdgeGradePoints[]): MappedGrade | null {
  const key = gradeKey(localGrade);
  if (!key) return null;
  const row = rows.find((item) => gradeKey(item.indigenousGrade) === key);
  if (!row) return null;
  return pointsFromUsEquivalent(row.usEquivalent);
}

export function scoreCourses(
  courses: RawCourse[],
  scale: GradeScale,
  edgeRows?: readonly EdgeGradePoints[],
  options?: GradeMapOptions,
): { courses: ScoredCourse[]; totalHours: number; gpa: number; usedEdge: boolean } | null {
  const scored: ScoredCourse[] = [];
  let usedEdge = false;
  for (const course of courses) {
    if (!Number.isFinite(course.localCredits) || course.localCredits < 0) return null;
    const fromEdge = edgeRows && edgeRows.length > 0 ? mapEdgeGrade(course.localGrade, edgeRows) : null;
    if (fromEdge) usedEdge = true;
    const mapped = fromEdge ?? mapLocalGrade(course.localGrade, scale, options);
    if (!mapped) return null;
    const usSemesterHours = course.localCredits;
    scored.push({
      ...course,
      usSemesterHours,
      usGrade: mapped.usGrade,
      gradePoints: round2(usSemesterHours * mapped.points),
    });
  }
  const totalHours = round2(scored.reduce((sum, course) => sum + course.usSemesterHours, 0));
  if (totalHours <= 0) return null;
  const points = scored.reduce((sum, course) => sum + course.gradePoints, 0);
  return { courses: scored, totalHours, gpa: round2(points / totalHours), usedEdge };
}

function gradeKey(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, " ").replace(/,/g, ".");
  if (!trimmed) return "";
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? String(parsed) : trimmed;
  }
  return trimmed;
}

function pointsFromUsEquivalent(value: string): MappedGrade | null {
  const letter = value.trim().toUpperCase().match(/\b(A|B|C|D|F)([+-])?\b/);
  if (letter) {
    const token = `${letter[1]}${letter[2] ?? ""}`;
    const points = LETTER_POINTS[token];
    if (points != null) return { usGrade: token, points };
  }
  const numeric = value.replace(/,/g, ".").match(/\b(\d+(?:\.\d+)?)\b/);
  if (!numeric) return null;
  const points = Number(numeric[1]);
  if (!Number.isFinite(points) || points < 0 || points > 4) return null;
  let usGrade = "F";
  let gap = Infinity;
  for (const [token, valuePoints] of Object.entries(LETTER_POINTS)) {
    const next = Math.abs(valuePoints - points);
    if (next < gap) {
      gap = next;
      usGrade = token;
    }
  }
  return { usGrade, points };
}
