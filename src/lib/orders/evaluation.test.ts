import { describe, expect, it } from "vitest";
import { assembleCourse, assembleDiploma } from "./evaluation";
import { GRADE_SCALE_20 } from "./grades";

describe("assemble evaluation", () => {
  it("maps a licence to a bachelor's degree and keeps the reviewed files", () => {
    const result = assembleDiploma({
      degreeCount: 1,
      documentsReviewed: ["fr_diplome-licence.pdf"],
      extracted: {
        credentials: [
          {
            applicant: "Ada Lovelace",
            institution: "Université de Paris",
            country: "France",
            credential: "Licence",
            field: "Mathematics",
            dates: "2016–2019",
          },
        ],
      },
    });
    expect(result).toEqual({
      kind: "diploma",
      credentials: [
        {
          applicant: "Ada Lovelace",
          institution: "Université de Paris",
          country: "France",
          credential: "Licence",
          field: "Mathematics",
          dates: "2016–2019",
          usEquivalency: "Bachelor's degree",
          documentsReviewed: ["fr_diplome-licence.pdf"],
        },
      ],
    });
  });

  it("holds a diploma when the degree count or the credential does not map", () => {
    const extracted = {
      credentials: [
        {
          applicant: "Ada Lovelace",
          institution: "Université de Paris",
          country: "France",
          credential: "Certificado",
          field: "Mathematics",
          dates: "2016–2019",
        },
      ],
    };
    expect(assembleDiploma({ degreeCount: 1, documentsReviewed: ["a.pdf"], extracted })).toBeNull();
    expect(
      assembleDiploma({
        degreeCount: 2,
        documentsReviewed: ["a.pdf"],
        extracted: {
          credentials: [
            {
              applicant: "Ada Lovelace",
              institution: "Université de Paris",
              country: "France",
              credential: "Licence",
              field: "Mathematics",
              dates: "2016–2019",
            },
          ],
        },
      }),
    ).toBeNull();
  });

  it("scores a 20-point transcript and explains the scale", () => {
    const result = assembleCourse({
      applicant: "Ada Lovelace",
      institution: "Université de Paris",
      country: "France",
      credential: "Licence",
      scale: "20",
      years: [
        {
          year: "2018–2019",
          courses: [
            { originalName: "Algèbre", englishName: "Algebra", localCredits: 6, localGrade: "14" },
          ],
        },
      ],
    });
    expect(result).toMatchObject({
      kind: "course_by_course",
      totalHours: 6,
      gpa: 3.7,
      gradeScale: GRADE_SCALE_20,
      years: [
        {
          year: "2018–2019",
          courses: [expect.objectContaining({ usGrade: "A-", gradePoints: 22.2, usSemesterHours: 6 })],
        },
      ],
    });
  });

  it("holds a transcript when a grade is off the scale", () => {
    expect(
      assembleCourse({
        applicant: "Ada Lovelace",
        institution: "Université de Paris",
        country: "France",
        credential: "Licence",
        scale: "20",
        years: [
          {
            year: "2018–2019",
            courses: [{ originalName: "Algèbre", englishName: "Algebra", localCredits: 6, localGrade: "21" }],
          },
        ],
      }),
    ).toBeNull();
  });
});
