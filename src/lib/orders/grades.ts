export const GRADE_SCALE_10 =
  "Grades are on a 10-point scale. 9.0–10 is A (4.0), 8.0–8.9 is B (3.0), 7.0–7.9 is C (2.0), 6.0–6.9 is D (1.0), and below 6 is F (0).";

export const GRADE_SCALE_20 =
  "Grades are on a 20-point scale. 16–20 is A (4.0), 14–15.99 is A- (3.7), 12–13.99 is B (3.0), 10–11.99 is C (2.0), and below 10 is F (0).";

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

export function mapLocalGrade(localGrade: string, scale: GradeScale): MappedGrade | null {
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
  return band(grade, [
    [16, "A", 4],
    [14, "A-", 3.7],
    [12, "B", 3],
    [10, "C", 2],
    [0, "F", 0],
  ]);
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

export function scoreCourses(
  courses: RawCourse[],
  scale: GradeScale,
): { courses: ScoredCourse[]; totalHours: number; gpa: number } | null {
  const scored: ScoredCourse[] = [];
  for (const course of courses) {
    if (!Number.isFinite(course.localCredits) || course.localCredits < 0) return null;
    const mapped = mapLocalGrade(course.localGrade, scale);
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
  return { courses: scored, totalHours, gpa: round2(points / totalHours) };
}
