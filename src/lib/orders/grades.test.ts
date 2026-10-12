import { describe, expect, it } from "vitest";
import { mapEdgeGrade, mapLocalGrade, scoreCourses, usEquivalency } from "./grades";

describe("grade scales", () => {
  it("maps a 20-point grade and a 10-point grade", () => {
    expect(mapLocalGrade("14", "20")).toEqual({ usGrade: "A-", points: 3.7 });
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
    expect(scored?.courses[0]).toMatchObject({ usSemesterHours: 6, usGrade: "A-", gradePoints: 22.2 });
    expect(scored?.courses[1]).toMatchObject({ usGrade: "C", gradePoints: 8 });
    expect(scored?.totalHours).toBe(10);
    expect(scored?.gpa).toBe(3.02);
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
});
