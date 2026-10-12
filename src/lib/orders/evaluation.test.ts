import { describe, expect, it } from "vitest";
import { applyDiplomaEquivalency, assembleCourse, assembleDiploma } from "./evaluation";
import {
  EQUIVALENCY_UNMAPPED,
  PENDING_EQUIVALENCY,
  approvalBlockReason,
  checkoutBlockReason,
  onStaffReviewQueue,
} from "./equivalency";
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

  it("prints a pending equivalency and keeps checkout open when the credential does not map", () => {
    const result = assembleDiploma({
      degreeCount: 1,
      documentsReviewed: ["a.pdf"],
      extracted: {
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
      },
    });
    expect(result?.kind).toBe("diploma");
    if (result?.kind !== "diploma") return;
    expect(result.credentials[0]?.usEquivalency).toBe(PENDING_EQUIVALENCY);
    const order = {
      status: "preview_ready" as const,
      languageConfirmed: true,
      service: "diploma",
      degreeCount: 1,
      evaluationCents: 1995,
      translationCents: 0,
      billablePages: 1,
      unitPriceCents: 995,
      reviewReason: EQUIVALENCY_UNMAPPED,
    };
    expect(checkoutBlockReason(order)).toBeNull();
    expect(approvalBlockReason(order)).toBe("The U.S. equivalency is still pending staff review");
    expect(onStaffReviewQueue(order)).toBe(true);
    expect(onStaffReviewQueue({ status: "paid", reviewReason: EQUIVALENCY_UNMAPPED })).toBe(true);
    const filled = applyDiplomaEquivalency(result, ["Bachelor's degree"]);
    expect(filled?.credentials[0]?.usEquivalency).toBe("Bachelor's degree");
    expect(applyDiplomaEquivalency(result, [PENDING_EQUIVALENCY])).toBeNull();
    expect(applyDiplomaEquivalency(result, [])).toBeNull();
  });

  it("holds a diploma when the degree count does not match", () => {
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
