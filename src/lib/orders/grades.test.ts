import { describe, expect, it } from "vitest";
import { GRADE_SCALE_20, credentialWasPassed, mapEdgeGrade, mapLocalGrade, scoreCourses, usEquivalency } from "./grades";

describe("grade scales", () => {
  it("maps a 20-point grade and a 10-point grade", () => {
    expect(mapLocalGrade("14", "20")).toEqual({ usGrade: "B", points: 3 });
    expect(mapLocalGrade("8.5", "10")).toEqual({ usGrade: "B", points: 3 });
    expect(mapLocalGrade("B+", "letter")).toEqual({ usGrade: "B+", points: 3.3 });
    expect(mapLocalGrade("21", "20")).toBeNull();
    expect(mapLocalGrade("pass", "10")).toBeNull();
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
    expect(scored?.courses[0]).toMatchObject({ usSemesterHours: 6, usGrade: "B", gradePoints: 18 });
    expect(scored?.courses[1]).toMatchObject({ usGrade: "C", gradePoints: 8 });
    expect(scored?.totalHours).toBe(10);
    expect(scored?.gpa).toBe(2.6);
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
    expect(mapLocalGrade("15.99", "20")?.usGrade).toBe("B");
    expect(mapLocalGrade("13,99", "20")?.usGrade).toBe("C");
    expect(mapLocalGrade("10", "20")).toEqual({ usGrade: "C", points: 2 });
    expect(mapLocalGrade("9.99", "20")).toEqual({ usGrade: "F", points: 0 });
  });

  it("takes the pass line from the system scale, not the country", () => {
    expect(mapLocalGrade("11", "20", { passMark: 12 })?.usGrade).toBe("F");
    expect(mapLocalGrade("12", "20", { passMark: 12 })?.usGrade).toBe("C");
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
    expect(scored!.courses.map((course) => course.usGrade)).toEqual(["D", "D", "C"]);
    expect(scored!.courses.some((course) => course.usGrade === "F")).toBe(false);
    expect(scored!.courses[0]).toMatchObject({ usGrade: "D", gradePoints: 2 });
    expect(scored!.courses[1]).toMatchObject({ usGrade: "D", gradePoints: 2 });
    expect(scored!.gpa).toBe(1.33);
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
    expect(scored!.courses.map((course) => course.usGrade)).toEqual(["F", "C"]);
    expect(scored!.courses[0]).toMatchObject({ usGrade: "F", gradePoints: 0 });
    expect(scored!.gpa).toBe(1);
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
    expect(scored!.gpa).toBeGreaterThanOrEqual(2);
    expect(scored!.gpa).toBe(2);
  });
});
