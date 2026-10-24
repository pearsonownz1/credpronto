import { describe, expect, it } from "vitest";
import { mergeCourseExtracts, splitTranscript } from "./evaluation";

describe("course transcript chunks", () => {
  it("splits on line breaks under the size and keeps every line", () => {
    const text = Array.from({ length: 50 }, (_, i) => `Course ${i} .......... 15`).join("\n");
    const chunks = splitTranscript(text, 200);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 200)).toBe(true);
    expect(chunks.join("\n")).toBe(text);
  });

  it("merges years by label, drops repeated courses, and keeps the first header", () => {
    const base = { applicant: "", institution: "", country: "", credential: "", scale: "100" as const, result: "" };
    const merged = mergeCourseExtracts([
      { ...base, applicant: "A. Student", country: "India", credential: "B.Sc.", years: [{ year: "Year 1", courses: [{ originalName: "Maths", englishName: "Maths", localCredits: 4, localGrade: "71" }] }] },
      { ...base, years: [
        { year: "Year 1", courses: [{ originalName: "Maths", englishName: "Maths", localCredits: 4, localGrade: "71" }, { originalName: "Physics", englishName: "Physics", localCredits: 4, localGrade: "64" }] },
        { year: "Year 2", courses: [{ originalName: "Chemistry", englishName: "Chemistry", localCredits: 4, localGrade: "58" }] },
      ] },
    ]);
    expect(merged.applicant).toBe("A. Student");
    expect(merged.country).toBe("India");
    expect(merged.years.map((year) => [year.year, year.courses.length])).toEqual([["Year 1", 2], ["Year 2", 1]]);
  });
});

describe("assembleCourse with loose year groups", () => {
  it("keeps courses printed without a year and drops empty groups", async () => {
    const { assembleCourse, UNLABELED_YEAR } = await import("./evaluation");
    const result = assembleCourse({
      applicant: "A. Student", institution: "Example University", country: "", credential: "Bachelor of Science", scale: "letter", result: "",
      years: [
        { year: "", courses: [{ originalName: "Maths", englishName: "", localCredits: 3, localGrade: "B" }] },
        { year: "2005", courses: [] },
      ],
    });
    expect(result?.kind).toBe("course_by_course");
    if (result?.kind !== "course_by_course") return;
    expect(result.years).toEqual([expect.objectContaining({ year: UNLABELED_YEAR })]);
    expect(result.country).toBe("Pending staff review");
  });
});
