export const GRADE_SCALE_10 =
  "Grades are on a 10-point scale. 9.0–10 is A (4.0), 8.0–8.9 is B (3.0), 7.0–7.9 is C (2.0), 6.0–6.9 is D (1.0), and below 6 is F (0).";

export const GRADE_SCALE_20 =
  "Grades are on a 20-point scale with 10 as the pass mark. 16–20 is A (4.0), 14–15.99 is B+ (3.3), 12–13.99 is B (3.0), 10–11.99 is C (2.0), 8–9.99 is D (1.0) when the credential was passed, and below 8 is F (0).";

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

export const GRADE_SCALE_100 =
  "Marks are percentages or out of 100 with 40 as the pass mark. 70–100 is A (4.0), 60–69 is B (3.0), 50–59 is C (2.0), 40–49 is D (1.0), and below 40 is F (0).";

export const GRADE_SCALE_4 =
  "Grades are grade points on a 4.0 scale and keep their printed value. The letter is the nearest U.S. letter.";

export const GRADE_SCALE_ROMAN =
  "Grades are Roman-numeral examination grades (CXC). I is A (4.0), II is B (3.0), III is C (2.0), IV is D (1.0), and V or VI is F (0).";

/** Courses marked Pass, Satisfactory, or Credit count toward hours but not toward the GPA. */
export const UNGRADED_PASS = "P";

/** Printed grade that could not be read on any scale. */
export const UNMAPPED_GRADE = "NR";

export type GradeScale = "10" | "20" | "100" | "4" | "roman" | "letter";

/** At most this share of courses may have an unreadable grade; they are left out of hours and GPA. */
export const MAX_UNMAPPED_SHARE = 0.1;

export type MappedGrade = {
  usGrade: string;
  points: number;
  /** Pass/credit with no grade: counts toward hours, not toward the GPA. */
  ungraded?: boolean;
  /** Withdrawn, transferred, or exempt: no hours and no points. */
  noCredit?: boolean;
};

const PASS_WORDS =
  /^(?:p|pass|passed|s|sat|satisfactory|approved|ap|apto|apta|aprobado|aprovado|cumprido|cumpri do|concluido|admis|valide|ok|completed|complete)$/i;

/** Withdrawn, transferred, exempt, audit, or incomplete: shown, but no hours and no points. */
const NO_CREDIT_WORDS = /^(?:w|wd|withdraw|withdrawn|t|tr|transfer|transferred|ex|exempt|exempted|au|audit|i|inc|incomplete|dispensa|dispensado|dispensada)$/i;

/** Australian and New Zealand bands: High Distinction, Distinction, Credit, Pass. */
const BAND_WORDS: Record<string, MappedGrade> = {
  HD: { usGrade: "A", points: 4 },
  DI: { usGrade: "A", points: 4 },
  DN: { usGrade: "A", points: 4 },
  CR: { usGrade: "B", points: 3 },
  PS: { usGrade: "C", points: 2 },
};

export const NO_CREDIT_GRADE = "W";

function nearestLetter(points: number): MappedGrade {
  let usGrade = "F";
  let gap = Infinity;
  for (const [token, value] of Object.entries(LETTER_POINTS)) {
    const next = Math.abs(value - points);
    if (next < gap) {
      gap = next;
      usGrade = token;
    }
  }
  return { usGrade, points: round2(points) };
}

function percentGrade(grade: number): MappedGrade | null {
  if (grade < 0 || grade > 100) return null;
  return band(grade, [
    [70, "A", 4],
    [60, "B", 3],
    [50, "C", 2],
    [40, "D", 1],
    [0, "F", 0],
  ]);
}

const NUMBER_WORDS: Record<string, string> = { ONE: "I", TWO: "II", THREE: "III", FOUR: "IV", FIVE: "V", SIX: "VI" };
const ARABIC = ["", "I", "II", "III", "IV", "V", "VI"];

/** CXC certificates print grades as I–VI, ONE–SIX, or 1–6. Digits count only on a known Roman scale. */
function romanKey(printed: string, romanScale: boolean): string {
  const token = printed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (NUMBER_WORDS[token]) return NUMBER_WORDS[token]!;
  if (romanScale && /^[1-6]$/.test(token)) return ARABIC[Number(token)]!;
  return token;
}

const ROMAN: Record<string, MappedGrade> = {
  I: { usGrade: "A", points: 4 },
  II: { usGrade: "B", points: 3 },
  III: { usGrade: "C", points: 2 },
  IV: { usGrade: "D", points: 1 },
  V: { usGrade: "F", points: 0 },
  VI: { usGrade: "F", points: 0 },
};

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function gradeScaleText(scale: GradeScale): string {
  if (scale === "10") return GRADE_SCALE_10;
  if (scale === "20") return GRADE_SCALE_20;
  if (scale === "100") return GRADE_SCALE_100;
  if (scale === "4") return GRADE_SCALE_4;
  if (scale === "roman") return GRADE_SCALE_ROMAN;
  return GRADE_SCALE_LETTER;
}

export function usEquivalency(credential: string): string | null {
  const value = credential.toLowerCase();
  if (/doctor|doctorado|doctorat|doctoral|\bph\.?\s*d\b/.test(value)) return "Doctoral degree";
  if (/master|maestr[ií]a|magister|maîtrise|maitrise|\bm\.?\s*sc\b/.test(value)) return "Master's degree";
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
 * On a passed credential, 8–9.99 is a condoned D (1.0). A mark under 8 is F (0), and so is
 * 8–9.99 when the credential was failed or the document does not state a result.
 */
export function mapLocalGrade(
  localGrade: string,
  scale: GradeScale,
  options?: GradeMapOptions,
): MappedGrade | null {
  const printed = localGrade.trim();
  const word = printed.normalize("NFD").replace(/\p{M}/gu, "");
  if (PASS_WORDS.test(word)) return { usGrade: UNGRADED_PASS, points: 0, ungraded: true };
  if (NO_CREDIT_WORDS.test(word) && !(scale === "roman" && /^i$/i.test(word))) {
    return { usGrade: NO_CREDIT_GRADE, points: 0, ungraded: true, noCredit: true };
  }
  const bandWord = BAND_WORDS[word.toUpperCase()];
  if (bandWord) return bandWord;
  if (scale === "roman" || /^(?:I|II|III|IV|V|VI)$/.test(printed.toUpperCase())) {
    const roman = ROMAN[romanKey(printed, scale === "roman")];
    if (roman) return roman;
    if (scale === "roman") return null;
  }
  if (scale === "letter") {
    const token = printed.toUpperCase().replace(/\s+/g, "");
    const points = LETTER_POINTS[token];
    if (points != null) return { usGrade: token, points };
    // "A (Excellent)" or "B+ / 3.3": take the leading letter.
    const lead = token.match(/^([A-DF][+-]?)(?![A-Z])/)?.[1];
    if (lead && LETTER_POINTS[lead] != null) return { usGrade: lead, points: LETTER_POINTS[lead]! };
    return null;
  }
  const match = printed.replace(",", ".").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const grade = Number(match[0]);
  if (!Number.isFinite(grade)) return null;
  if (scale === "100") return percentGrade(grade);
  if (scale === "4") {
    if (grade > 4.3) return /%/.test(printed) ? percentGrade(grade) : null;
    return nearestLetter(Math.min(grade, 4));
  }
  if (scale === "10") {
    // A percentage mark on a page the extractor called 10-point.
    if (grade > 10) return /%/.test(printed) ? percentGrade(grade) : null;
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
  if (grade >= pass) {
    // 12–13.99 is B when the pass line is 12 or lower. A higher pass line makes the pass mark itself a C.
    const rows: Array<[number, string, number]> = [
      [Math.max(16, pass), "A", 4],
      [Math.max(14, pass), "B+", 3.3],
    ];
    if (pass <= 12) rows.push([12, "B", 3]);
    rows.push([pass, "C", 2]);
    return band(grade, rows);
  }
  if (grade >= 8 && grade < 10 && options?.credentialPassed === true) return { usGrade: "D", points: 1 };
  return { usGrade: "F", points: 0 };
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

const EDGE_RANGE = /^\s*(\d+(?:[.,]\d+)?)\s*(?:[-–—]|to)\s*(\d+(?:[.,]\d+)?)\s*$/i;

export function mapEdgeGrade(
  localGrade: string,
  rows: readonly EdgeGradePoints[],
  options?: GradeMapOptions,
): MappedGrade | null {
  const key = gradeKey(localGrade);
  if (!key) return null;
  const exact = rows.find((item) => gradeKey(item.indigenousGrade) === key);
  if (exact) return pointsFromUsEquivalent(exact.usEquivalent);

  const grade = plainNumber(localGrade);
  if (grade == null) return null;
  const ranges = rows.flatMap((row) => {
    const bounds = numericRange(row.indigenousGrade);
    if (!bounds) return [];
    return [{ row, low: Math.min(bounds[0], bounds[1]), high: Math.max(bounds[0], bounds[1]) }];
  });
  if (ranges.length === 0) return null;

  const matched = matchNumericRange(grade, ranges);
  if (!matched) return null;
  return condonedRangePass(pointsFromUsEquivalent(matched.row.usEquivalent), grade, options);
}

export function scoreCourses(
  courses: RawCourse[],
  scale: GradeScale,
  edgeRows?: readonly EdgeGradePoints[],
  options?: GradeMapOptions,
): { courses: ScoredCourse[]; totalHours: number; gpa: number; usedEdge: boolean } | null {
  if (courses.length === 0) return null;
  // No credits printed at all (CXC, many secondary transcripts): one unit per subject.
  const noCredits = courses.every((course) => !Number.isFinite(course.localCredits) || course.localCredits <= 0);
  const scored: ScoredCourse[] = [];
  let usedEdge = false;
  let unmapped = 0;
  let gradedHours = 0;
  let points = 0;
  for (const course of courses) {
    const credits = noCredits ? 1 : course.localCredits;
    if (!Number.isFinite(credits) || credits < 0) return null;
    const fromEdge = edgeRows && edgeRows.length > 0 ? mapEdgeGrade(course.localGrade, edgeRows, options) : null;
    if (fromEdge) usedEdge = true;
    const mapped = fromEdge ?? mapLocalGrade(course.localGrade, scale, options);
    if (!mapped) {
      // Kept in place so year grouping still lines up; no hours, no points.
      unmapped += 1;
      scored.push({ ...course, localCredits: credits, usSemesterHours: 0, usGrade: UNMAPPED_GRADE, gradePoints: 0 });
      continue;
    }
    const usSemesterHours = mapped.noCredit ? 0 : credits;
    const gradePoints = mapped.ungraded ? 0 : round2(usSemesterHours * mapped.points);
    if (!mapped.ungraded) {
      gradedHours += usSemesterHours;
      points += gradePoints;
    }
    scored.push({ ...course, localCredits: credits, usSemesterHours, usGrade: mapped.usGrade, gradePoints });
  }
  if (unmapped > Math.floor(courses.length * MAX_UNMAPPED_SHARE)) return null;
  const totalHours = round2(scored.reduce((sum, course) => sum + course.usSemesterHours, 0));
  if (totalHours <= 0 || gradedHours <= 0) return null;
  return { courses: scored, totalHours, gpa: round2(points / gradedHours), usedEdge };
}

function plainNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || /%|[a-z]/i.test(trimmed)) return null;
  if (!/^\d+(?:[.,]\d+)?$/.test(trimmed)) return null;
  const grade = Number(trimmed.replace(",", "."));
  return Number.isFinite(grade) ? grade : null;
}

function numericRange(value: string): [number, number] | null {
  const match = value.trim().match(EDGE_RANGE);
  if (!match?.[1] || !match[2]) return null;
  const low = Number(match[1].replace(",", "."));
  const high = Number(match[2].replace(",", "."));
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return [low, high];
}

function matchNumericRange<T extends { low: number; high: number }>(grade: number, ranges: readonly T[]): T | null {
  if (ranges.length === 1) {
    const only = ranges[0]!;
    return only.low <= grade && grade <= only.high ? only : null;
  }
  const minLow = Math.min(...ranges.map((item) => item.low));
  const maxHigh = Math.max(...ranges.map((item) => item.high));
  if (grade < minLow || grade > maxHigh) return null;
  let matched: T | null = null;
  for (const item of ranges) {
    if (item.low <= grade && (matched == null || item.low > matched.low)) matched = item;
  }
  return matched;
}

/**
 * An F range such as `0 — 9` condones only 8–9.99 on a passed credential.
 * A mark under 8 stays F.
 */
function condonedRangePass(
  mapped: MappedGrade | null,
  grade: number,
  options?: GradeMapOptions,
): MappedGrade | null {
  if (!mapped) return null;
  if (
    mapped.usGrade === "F" &&
    mapped.points === 0 &&
    options?.credentialPassed === true &&
    grade >= 8 &&
    grade < 10
  ) {
    return { usGrade: "D", points: 1 };
  }
  return mapped;
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
  const letter = value.trim().toUpperCase().match(/\b(A|B|C|D|F)([+-])?(?![A-Z])/);
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
