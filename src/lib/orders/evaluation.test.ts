import { describe, expect, it } from "vitest";
import { applyDiplomaEquivalency, assembleCourse, assembleDiploma, normalizeDiplomaExtract } from "./evaluation";
import {
  EQUIVALENCY_QA_RESEARCH,
  EQUIVALENCY_QA_REVIEW,
  EQUIVALENCY_UNMAPPED,
  PENDING_EQUIVALENCY,
  approvalBlockReason,
  checkoutBlockReason,
  diplomaEquivalencyPending,
  onStaffReviewQueue,
} from "./equivalency";
import { GRADE_SCALE_20 } from "./grades";

describe("assemble evaluation", () => {
  it("leaves a licence pending without an EDGE suggestion and keeps the reviewed files", () => {
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
          usEquivalency: PENDING_EQUIVALENCY,
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
    expect(onStaffReviewQueue({ status: "preview_ready", reviewReason: EQUIVALENCY_QA_REVIEW })).toBe(true);
    expect(onStaffReviewQueue({ status: "preview_ready", reviewReason: EQUIVALENCY_QA_RESEARCH })).toBe(true);
    expect(approvalBlockReason({ reviewReason: EQUIVALENCY_QA_REVIEW })).toBe(
      "The U.S. equivalency is still pending staff review",
    );
    const filled = applyDiplomaEquivalency(result, ["Bachelor's degree"]);
    expect(filled?.credentials[0]?.usEquivalency).toBe("Bachelor's degree");
    expect(applyDiplomaEquivalency(result, [PENDING_EQUIVALENCY])).toBeNull();
    expect(applyDiplomaEquivalency(result, [])).toBeNull();
  });

  it("keeps a licenciatura preview when the country or title was not mapped", () => {
    const licenciatura = assembleDiploma({
      degreeCount: 1,
      documentsReviewed: ["es-mx_titulo-licenciatura.pdf"],
      extracted: {
        credentials: [
          {
            applicant: "Valeria Ximena Olvera Tostado",
            institution: "Universidad Autónoma de San Isidro del Valle",
            country: "",
            credential: "Licenciatura",
            field: "Administración de Empresas",
            dates: "18 de junio de 2019",
          },
        ],
      },
    });
    expect(licenciatura?.kind).toBe("diploma");
    if (licenciatura?.kind !== "diploma") return;
    expect(licenciatura.credentials[0]).toMatchObject({
      credential: "Licenciatura",
      country: PENDING_EQUIVALENCY,
      usEquivalency: PENDING_EQUIVALENCY,
    });
    expect(diplomaEquivalencyPending(licenciatura.credentials)).toBe(true);

    const printed = assembleDiploma({
      degreeCount: 1,
      documentsReviewed: ["es-mx_titulo-licenciatura.pdf"],
      extracted: {
        credentials: [
          {
            applicant: "Valeria Ximena Olvera Tostado",
            institution: "Universidad Autónoma de San Isidro del Valle",
            country: "",
            credential: "LICENCIADA EN ADMINISTRACIÓN DE EMPRESAS",
            field: "",
            dates: "18 de junio de 2019",
          },
        ],
      },
    });
    expect(printed?.kind).toBe("diploma");
    if (printed?.kind !== "diploma") return;
    expect(printed.credentials[0]).toMatchObject({
      field: "ADMINISTRACIÓN DE EMPRESAS",
      country: PENDING_EQUIVALENCY,
      dates: "18 de junio de 2019",
      usEquivalency: PENDING_EQUIVALENCY,
    });
    const order = {
      status: "preview_ready" as const,
      languageConfirmed: true,
      service: "diploma",
      degreeCount: 1,
      evaluationCents: 1995,
      translationCents: 995,
      billablePages: 1,
      unitPriceCents: 995,
      reviewReason: EQUIVALENCY_UNMAPPED,
    };
    expect(checkoutBlockReason(order)).toBeNull();
    expect(approvalBlockReason(order)).toBe("The U.S. equivalency is still pending staff review");
    expect(applyDiplomaEquivalency(printed, ["Bachelor's degree"])).toBeNull();
    expect(
      applyDiplomaEquivalency(printed, ["Bachelor's degree"], { countries: ["Mexico"] })?.credentials[0],
    ).toMatchObject({
      usEquivalency: "Bachelor's degree",
      country: "Mexico",
      field: "ADMINISTRACIÓN DE EMPRESAS",
    });
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
      gpa: 3.3,
      gradeScale: GRADE_SCALE_20,
      years: [
        {
          year: "2018–2019",
          courses: [expect.objectContaining({ usGrade: "B+", gradePoints: 19.8, usSemesterHours: 6 })],
        },
      ],
    });
  });

  it("lets a diploma pay at the flat fee before a preview exists", () => {
    expect(
      checkoutBlockReason({
        status: "draft",
        languageConfirmed: false,
        service: "diploma",
        degreeCount: 1,
        evaluationCents: 1995,
        translationCents: null,
        billablePages: null,
        unitPriceCents: 995,
      }),
    ).toBeNull();
    expect(
      checkoutBlockReason({
        status: "draft",
        languageConfirmed: false,
        service: "course_by_course",
        degreeCount: 1,
        evaluationCents: 3995,
        translationCents: null,
        billablePages: null,
        unitPriceCents: 995,
      }),
    ).toBeNull();
    expect(
      checkoutBlockReason({
        status: "draft",
        languageConfirmed: false,
        service: null,
        evaluationCents: null,
        translationCents: null,
        billablePages: null,
        unitPriceCents: 995,
      }),
    ).toBe("Preview is not ready");
    expect(
      checkoutBlockReason({
        status: "draft",
        languageConfirmed: false,
        service: "diploma",
        degreeCount: 1,
        evaluationCents: 1995,
        translationCents: 995,
        includeTranslation: true,
        billablePages: 1,
        unitPriceCents: 995,
      }),
    ).toBe("Preview is not ready");
    expect(
      checkoutBlockReason({
        status: "preview_ready",
        languageConfirmed: true,
        service: "diploma",
        degreeCount: 1,
        evaluationCents: 1995,
        translationCents: 995,
        includeTranslation: true,
        billablePages: 1,
        unitPriceCents: 995,
      }),
    ).toBeNull();
  });

  it("gives a passed Bac D for a subject under 10 and still reports the GPA", () => {
    const result = assembleCourse({
      applicant: "Awa Ngo",
      institution: "Lycée de Yaoundé",
      country: "Cameroon",
      credential: "Baccalauréat",
      scale: "20",
      result: "Admis",
      years: [
        {
          year: "2024",
          courses: [
            { originalName: "Mathématiques", englishName: "Mathematics", localCredits: 2, localGrade: "8" },
            { originalName: "Français", englishName: "French", localCredits: 2, localGrade: "12" },
          ],
        },
      ],
    });
    expect(result).toMatchObject({ kind: "course_by_course", gpa: 2, gradeScale: GRADE_SCALE_20 });
    if (result?.kind !== "course_by_course") return;
    expect(result.years[0]?.courses.map((course) => course.usGrade)).toEqual(["D", "B"]);
    expect(result.years[0]?.courses.some((course) => course.usGrade === "F")).toBe(false);
  });

  it("gives F for a subject under 10 when the credential was failed", () => {
    const result = assembleCourse({
      applicant: "Awa Ngo",
      institution: "Lycée de Yaoundé",
      country: "Cameroon",
      credential: "Baccalauréat",
      scale: "20",
      result: "Ajourné",
      years: [
        {
          year: "2024",
          courses: [
            { originalName: "Mathématiques", englishName: "Mathematics", localCredits: 2, localGrade: "8" },
            { originalName: "Français", englishName: "French", localCredits: 2, localGrade: "12" },
          ],
        },
      ],
    });
    expect(result).toMatchObject({ kind: "course_by_course", gpa: 1.5 });
    if (result?.kind !== "course_by_course") return;
    expect(result.years[0]?.courses.map((course) => course.usGrade)).toEqual(["F", "B"]);
  });

  it("strips a trailing registration number from the applicant", () => {
    const name = "KOUAMOU NANA MYRTHE ARISTIDE                         08 / 008 / 4055";
    expect(normalizeDiplomaExtract({
      credentials: [
        {
          applicant: name,
          institution: "Office du Baccalauréat du Cameroun",
          country: "Cameroon",
          credential: "Baccalauréat",
          field: "Quantitative Management Techniques",
          dates: "August 22, 2001",
        },
      ],
    }).credentials[0]?.applicant).toBe("KOUAMOU NANA MYRTHE ARISTIDE");
    const diploma = assembleDiploma({
      degreeCount: 1,
      documentsReviewed: ["releve.pdf"],
      extracted: {
        credentials: [
          {
            applicant: name,
            institution: "Office du Baccalauréat du Cameroun",
            country: "Cameroon",
            credential: "Baccalauréat",
            field: "Quantitative Management Techniques",
            dates: "August 22, 2001",
          },
        ],
      },
    });
    expect(diploma?.kind === "diploma" ? diploma.credentials[0]?.applicant : null).toBe(
      "KOUAMOU NANA MYRTHE ARISTIDE",
    );
    const course = assembleCourse({
      applicant: `M ${name}`,
      institution: "Office du Baccalauréat du Cameroun",
      country: "Cameroon",
      credential: "Baccalauréat",
      scale: "20",
      years: [
        {
          year: "2001",
          courses: [
            { originalName: "Français", englishName: "French", localCredits: 2, localGrade: "12" },
            { originalName: "Philosophie", englishName: "Philosophy", localCredits: 2, localGrade: "10" },
            { originalName: "Anglais", englishName: "English", localCredits: 2, localGrade: "11" },
          ],
        },
      ],
    });
    expect(course?.kind === "course_by_course" ? course.applicant : null).toBe("M KOUAMOU NANA MYRTHE ARISTIDE");
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
