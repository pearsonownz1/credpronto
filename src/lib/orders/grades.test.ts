import { describe, expect, it } from "vitest";
import { matchEdgeGradingScale, type EdgeGradingScaleRecord } from "./edge";
import { GRADE_SCALE_20, credentialWasPassed, mapEdgeGrade, mapLocalGrade, scoreCourses, usEquivalency } from "./grades";

const CAMEROON_20: EdgeGradingScaleRecord["rows"] = [
  { indigenousGrade: "16 — 20", usEquivalent: "A" },
  { indigenousGrade: "14 — 15", usEquivalent: "B+" },
  { indigenousGrade: "12 — 13", usEquivalent: "B" },
  { indigenousGrade: "10 — 11", usEquivalent: "C" },
  { indigenousGrade: "0 — 9", usEquivalent: "F" },
];

/** Order 5274b9e5 relevé: 11 courses, printed total 300/30 = 10.00/20, ADMIS. */
const CAMEROON_BAC = [
  ["Sciences Economiques et Juridiques", 4, "9.5"],
  ["Mathématiques Appliquées", 2, "12.5"],
  ["Techniques Quantitatives de Gestion", 5, "8.4"],
  ["Pratique Professionnelle (Pratique Ecrite)", 5, "12.6"],
  ["Français", 3, "11.33"],
  ["Philosophie", 2, "10"],
  ["Anglais", 2, "7.5"],
  ["Education Civique", 2, "12"],
  ["Mathématiques", 2, "8.5"],
  ["Histoire ou Géographie", 1, "6"],
  ["Pratique Professionnelle (sur matériel)", 2, "6.5"],
] as const;

describe("grade scales", () => {
  it("maps a 20-point grade and a 10-point grade", () => {
    expect(mapLocalGrade("14", "20")).toEqual({ usGrade: "B+", points: 3.3 });
    expect(mapLocalGrade("8.5", "10")).toEqual({ usGrade: "B", points: 3 });
    expect(mapLocalGrade("B+", "letter")).toEqual({ usGrade: "B+", points: 3.3 });
    expect(mapLocalGrade("21", "20")).toBeNull();
    expect(mapLocalGrade("pass", "10")).toEqual({ usGrade: "P", points: 0, ungraded: true });
    expect(mapLocalGrade("seven", "10")).toBeNull();
  });

  it("names the U.S. equivalency from the printed credential", () => {
    expect(usEquivalency("Licence")).toBe("Bachelor's degree");
    expect(usEquivalency("Maîtrise")).toBe("Master's degree");
    expect(usEquivalency("Bachillerato")).toBe("High school diploma");
    expect(usEquivalency("Certificado")).toBeNull();
  });

  it("computes semester hours, grade points, and GPA", () => {
    const scored = scoreCourses(
      [
        { originalName: "Algèbre", englishName: "Algebra", localCredits: 6, localGrade: "14" },
        { originalName: "Physique", englishName: "Physics", localCredits: 4, localGrade: "10" },
      ],
      "20",
    );
    expect(scored?.courses[0]).toMatchObject({ usSemesterHours: 6, usGrade: "B+", gradePoints: 19.8 });
    expect(scored?.courses[1]).toMatchObject({ usGrade: "C", gradePoints: 8 });
    expect(scored?.totalHours).toBe(10);
    expect(scored?.gpa).toBe(2.78);
    expect(scored?.usedEdge).toBe(false);
  });

  it("uses a matching EDGE grade row and leaves credit hours on the printed value", () => {
    expect(mapEdgeGrade("10,0", [{ indigenousGrade: "10", usEquivalent: "A" }])).toEqual({
      usGrade: "A",
      points: 4,
    });
    expect(mapEdgeGrade("MB", [{ indigenousGrade: "MB", usEquivalent: "3.3" }])).toEqual({
      usGrade: "B+",
      points: 3.3,
    });
    const scored = scoreCourses(
      [
        { originalName: "Algèbre", englishName: "Algebra", localCredits: 6, localGrade: "14" },
        { originalName: "Physique", englishName: "Physics", localCredits: 4, localGrade: "10" },
      ],
      "20",
      [{ indigenousGrade: "14", usEquivalent: "A" }],
    );
    expect(scored?.courses[0]).toMatchObject({ usSemesterHours: 6, usGrade: "A", gradePoints: 24 });
    expect(scored?.courses[1]).toMatchObject({ usSemesterHours: 4, usGrade: "C" });
    expect(scored?.usedEdge).toBe(true);
  });

  it("uses the PM 20-point bands with 10 as the pass line", () => {
    expect(mapLocalGrade("20", "20")?.usGrade).toBe("A");
    expect(mapLocalGrade("16", "20")?.usGrade).toBe("A");
    expect(mapLocalGrade("15.99", "20")).toEqual({ usGrade: "B+", points: 3.3 });
    expect(mapLocalGrade("14", "20")).toEqual({ usGrade: "B+", points: 3.3 });
    expect(mapLocalGrade("13,99", "20")).toEqual({ usGrade: "B", points: 3 });
    expect(mapLocalGrade("12", "20")).toEqual({ usGrade: "B", points: 3 });
    expect(mapLocalGrade("11.99", "20")).toEqual({ usGrade: "C", points: 2 });
    expect(mapLocalGrade("10", "20")).toEqual({ usGrade: "C", points: 2 });
    expect(mapLocalGrade("9.99", "20")).toEqual({ usGrade: "F", points: 0 });
    expect(GRADE_SCALE_20).toContain("14–15.99 is B+ (3.3)");
    expect(GRADE_SCALE_20).toContain("12–13.99 is B (3.0)");
    expect(GRADE_SCALE_20).toContain("10–11.99 is C (2.0)");
  });

  it("takes the pass line from the system scale, not the country", () => {
    expect(mapLocalGrade("11", "20", { passMark: 12 })?.usGrade).toBe("F");
    expect(mapLocalGrade("12", "20", { passMark: 12 })).toEqual({ usGrade: "B", points: 3 });
    expect(mapLocalGrade("13", "20", { passMark: 13 })).toEqual({ usGrade: "C", points: 2 });
    expect(mapLocalGrade("12", "20", { passMark: 13 })?.usGrade).toBe("F");
    expect(mapLocalGrade("14", "20", { passMark: 13 })).toEqual({ usGrade: "B+", points: 3.3 });
    expect(mapLocalGrade("10", "20", { passMark: Number.NaN })?.usGrade).toBe("C");
  });

  it.each([
    "graduated",
    "graduate",
    "diplômé",
    "diplome",
    "diplômée",
    "validé",
    "valide",
    "validée",
    "aprobado",
    "aprobada",
    "aprovado",
    "aprovada",
  ])("counts %s as passed", (decision) => {
    expect(credentialWasPassed(decision)).toBe(true);
  });

  it.each([
    "non diplômé",
    "non validé",
    "no aprobado",
    "não aprovado",
    "nao aprovado",
    "reprovado",
    "reprobado",
    "suspenso",
    "not graduated",
  ])("counts %s as failed", (decision) => {
    expect(credentialWasPassed(decision)).toBe(false);
  });

  it("a passed Bac with sub-10 subjects gives D's and no F's, and keeps the GPA", () => {
    expect(credentialWasPassed("Admis")).toBe(true);
    expect(credentialWasPassed("Passed")).toBe(true);
    expect(GRADE_SCALE_20).toContain("Below 10 is D (1.0) when the credential was passed");
    const scored = scoreCourses(
      [
        { originalName: "Mathématiques", englishName: "Mathematics", localCredits: 2, localGrade: "8" },
        { originalName: "Philosophie", englishName: "Philosophy", localCredits: 2, localGrade: "9,5" },
        { originalName: "Français", englishName: "French", localCredits: 2, localGrade: "12" },
      ],
      "20",
      undefined,
      { credentialPassed: credentialWasPassed("Admis") },
    );
    expect(scored).not.toBeNull();
    expect(scored!.courses.map((course) => course.usGrade)).toEqual(["D", "D", "B"]);
    expect(scored!.courses.some((course) => course.usGrade === "F")).toBe(false);
    expect(scored!.courses[0]).toMatchObject({ usGrade: "D", gradePoints: 2 });
    expect(scored!.courses[1]).toMatchObject({ usGrade: "D", gradePoints: 2 });
    expect(scored!.gpa).toBe(1.67);
  });

  it("a failed credential still gives F", () => {
    expect(credentialWasPassed("Ajourné")).toBe(false);
    expect(credentialWasPassed("Failed")).toBe(false);
    expect(mapLocalGrade("8", "20", { credentialPassed: false })).toEqual({ usGrade: "F", points: 0 });
    const scored = scoreCourses(
      [
        { originalName: "Mathématiques", englishName: "Mathematics", localCredits: 2, localGrade: "8" },
        { originalName: "Français", englishName: "French", localCredits: 2, localGrade: "12" },
      ],
      "20",
      undefined,
      { credentialPassed: credentialWasPassed("Ajourné") },
    );
    expect(scored).not.toBeNull();
    expect(scored!.courses.map((course) => course.usGrade)).toEqual(["F", "B"]);
    expect(scored!.courses[0]).toMatchObject({ usGrade: "F", gradePoints: 0 });
    expect(scored!.gpa).toBe(1.5);
  });

  it("9b80cd30 Cameroon Bac at 10.00/20 (Admis): no passed subject is an F, GPA in C range", () => {
    const marks = ["10", "10.5", "11", "10", "12", "10", "10.25", "10", "13.5", "10", "10"];
    const scored = scoreCourses(
      marks.map((localGrade, index) => ({
        originalName: `Matière ${index + 1}`,
        englishName: `Subject ${index + 1}`,
        localCredits: 1,
        localGrade,
      })),
      "20",
    );
    expect(scored).not.toBeNull();
    expect(scored!.courses.some((course) => course.usGrade === "F")).toBe(false);
    expect(scored!.courses.map((course) => course.usGrade)).toEqual([
      "C",
      "C",
      "C",
      "C",
      "B",
      "C",
      "C",
      "C",
      "B",
      "C",
      "C",
    ]);
    expect(scored!.gpa).toBe(2.18);
  });

  it("matches Cameroon Francophone ranges, including decimals that fall between integer endpoints", () => {
    expect(mapEdgeGrade("12.5", CAMEROON_20)).toEqual({ usGrade: "B", points: 3 });
    expect(mapEdgeGrade("12,6", CAMEROON_20)).toEqual({ usGrade: "B", points: 3 });
    expect(mapEdgeGrade("12", CAMEROON_20)).toEqual({ usGrade: "B", points: 3 });
    expect(mapEdgeGrade("11.33", CAMEROON_20)).toEqual({ usGrade: "C", points: 2 });
    expect(mapEdgeGrade("16", CAMEROON_20)).toEqual({ usGrade: "A", points: 4 });
    expect(mapEdgeGrade("14.2", CAMEROON_20)).toEqual({ usGrade: "B+", points: 3.3 });
    expect(mapEdgeGrade("9.5", CAMEROON_20)).toEqual({ usGrade: "F", points: 0 });
    expect(mapEdgeGrade("9.5", CAMEROON_20, { credentialPassed: true })).toEqual({ usGrade: "D", points: 1 });
    expect(mapEdgeGrade("12.5%", CAMEROON_20)).toBeNull();
    expect(mapEdgeGrade("B", CAMEROON_20)).toBeNull();
    expect(mapEdgeGrade("21", CAMEROON_20)).toBeNull();
    expect(mapEdgeGrade("12.5", [{ indigenousGrade: "10 — 11", usEquivalent: "C" }])).toBeNull();

    const francophone: EdgeGradingScaleRecord = {
      id: "cm-francophone",
      countrySlug: "cameroon",
      title: "Cameroon Francophone General Grading Scale",
      raw: null,
      rows: CAMEROON_20,
    };
    const letters: EdgeGradingScaleRecord = {
      id: "cm-letters",
      countrySlug: "cameroon",
      title: "Letter scale",
      raw: null,
      rows: [{ indigenousGrade: "A", usEquivalent: "A" }],
    };
    expect(
      matchEdgeGradingScale([letters, francophone], {
        country: "Cameroon",
        title: "Baccalauréat",
        grades: ["12.5", "12.6", "11.33", "9.5"],
      })?.id,
    ).toBe("cm-francophone");
  });

  it("floors a passed 10.00/20 Cameroon Bac at a 2.00 GPA and scores 12.5, 12.6, and 12 as B", () => {
    const courses = CAMEROON_BAC.map(([originalName, localCredits, localGrade]) => ({
      originalName,
      englishName: originalName,
      localCredits,
      localGrade,
    }));
    const scored = scoreCourses(courses, "20", CAMEROON_20, { credentialPassed: true });
    expect(scored).not.toBeNull();
    const byGrade = new Map(scored!.courses.map((course) => [course.localGrade, course.usGrade]));
    expect(byGrade.get("12.5")).toBe("B");
    expect(byGrade.get("12.6")).toBe("B");
    expect(byGrade.get("12")).toBe("B");
    expect(byGrade.get("11.33")).toBe("C");
    expect(byGrade.get("9.5")).toBe("D");
    expect(scored!.courses.some((course) => course.usGrade === "F")).toBe(false);
    expect(scored!.totalHours).toBe(30);
    expect(scored!.gpa).toBe(2);
    expect(scored!.usedEdge).toBe(true);
  });
});

describe("round 2 grade scales", () => {
  it("maps percentages, 4.0 points, and CXC Roman numerals", () => {
    expect(mapLocalGrade("72", "100")).toEqual({ usGrade: "A", points: 4 });
    expect(mapLocalGrade("45%", "100")).toEqual({ usGrade: "D", points: 1 });
    expect(mapLocalGrade("38", "100")).toEqual({ usGrade: "F", points: 0 });
    expect(mapLocalGrade("3.3", "4")).toEqual({ usGrade: "B+", points: 3.3 });
    expect(mapLocalGrade("III", "roman")).toEqual({ usGrade: "C", points: 2 });
    expect(mapLocalGrade("VI", "roman")).toEqual({ usGrade: "F", points: 0 });
    expect(mapLocalGrade("THREE", "roman")).toEqual({ usGrade: "C", points: 2 });
    expect(mapLocalGrade("2", "roman")).toEqual({ usGrade: "B", points: 3 });
    expect(mapLocalGrade("85%", "10")).toEqual({ usGrade: "A", points: 4 });
    expect(mapLocalGrade("85", "10")).toBeNull();
  });

  it("gives one unit per subject when no credits are printed and keeps pass courses out of the GPA", () => {
    const scored = scoreCourses(
      [
        { originalName: "Maths", englishName: "Maths", localCredits: 0, localGrade: "I" },
        { originalName: "English", englishName: "English", localCredits: 0, localGrade: "III" },
        { originalName: "PE", englishName: "PE", localCredits: 0, localGrade: "Pass" },
      ],
      "roman",
    );
    expect(scored?.totalHours).toBe(3);
    expect(scored?.gpa).toBe(3);
  });

  it("tolerates a few unreadable grades but not many", () => {
    const course = (grade: string) => ({ originalName: grade, englishName: grade, localCredits: 3, localGrade: grade });
    const mostlyGood = [...Array.from({ length: 10 }, () => course("80")), course("??")];
    const result = scoreCourses(mostlyGood, "100");
    expect(result?.gpa).toBe(4);
    expect(result?.courses.at(-1)).toMatchObject({ usGrade: "NR", usSemesterHours: 0 });
    expect(scoreCourses([course("80"), course("??")], "100")).toBeNull();
  });
});

describe("grade words", () => {
  it("maps Australian bands and keeps withdrawn or transferred courses out of hours", () => {
    expect(mapLocalGrade("HD", "letter")).toEqual({ usGrade: "A", points: 4 });
    expect(mapLocalGrade("CR", "letter")).toEqual({ usGrade: "B", points: 3 });
    expect(mapLocalGrade("PS", "letter")).toEqual({ usGrade: "C", points: 2 });
    expect(mapLocalGrade("Aprovado", "10")).toMatchObject({ usGrade: "P", ungraded: true });
    const scored = scoreCourses(
      [
        { originalName: "A", englishName: "A", localCredits: 3, localGrade: "A" },
        { originalName: "B", englishName: "B", localCredits: 3, localGrade: "Withdrawn" },
        { originalName: "C", englishName: "C", localCredits: 3, localGrade: "T" },
      ],
      "letter",
    );
    expect(scored?.totalHours).toBe(3);
    expect(scored?.gpa).toBe(4);
  });
});
