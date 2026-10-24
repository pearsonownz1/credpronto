import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ai from "./ai";
import * as db from "./db";
import { assembleDiploma, evaluateServiceFromText, isEnglishCourseTitle, normalizeEvaluationCountry, normalizeEvaluationDate, normalizeEvaluationField, withEnglishCourseNames } from "./evaluation";
import type { OrderRecord } from "./types";

const TRANSCRIPT = `OFFICE DU BACCALAUREAT DU CAMEROUN
RELEVE DE NOTES
BACCALAUREAT DE L'ENSEIGNEMENT SECONDAIRE TECHNIQUE
M KOUAMOU NANA MYRTHE ARISTIDE
Session de 2001
MATIERES | COEF. | Note x Coef
Sciences Economiques et Juridiques | 4.0 | 38
Mathématiques Appliquées | 2.0 | 25
Pédagogie Comparée | 2.0 | 30
DECISION | ADMIS
`;

function courseOrder(): OrderRecord {
  return {
    id: "order-1",
    service: "course_by_course",
    services: ["course_by_course"],
    orderType: "evaluation",
    serviceType: "evaluation",
    degreeCount: 1,
    includeTranslation: false,
    edgeCredentialId: null,
  } as OrderRecord;
}

describe("English credential fields", () => {
  it("turns French country names and dates into English", () => {
    expect(normalizeEvaluationCountry("Cameroun")).toBe("Cameroon");
    expect(normalizeEvaluationCountry("République du Cameroun")).toBe("Cameroon");
    expect(normalizeEvaluationCountry("Cameroon")).toBe("Cameroon");
    expect(normalizeEvaluationCountry("Mexique")).toBe("Mexico");
    expect(normalizeEvaluationCountry("France")).toBe("France");
    expect(normalizeEvaluationDate("26 Mars 2003")).toBe("March 26, 2003");
    expect(normalizeEvaluationDate("le 22 Août 2001")).toBe("August 22, 2001");
    expect(normalizeEvaluationDate("Mercredi 22 Août 2001")).toBe("August 22, 2001");
    expect(normalizeEvaluationDate("March 26, 2003")).toBe("March 26, 2003");
    expect(normalizeEvaluationDate("18 de junio de 2019")).toBe("18 de junio de 2019");
    expect(normalizeEvaluationDate("2016–2019")).toBe("2016–2019");
    for (const [french, english] of [
      ["1 Janvier 2001", "January 1, 2001"],
      ["2 Février 2001", "February 2, 2001"],
      ["3 Mars 2001", "March 3, 2001"],
      ["4 Avril 2001", "April 4, 2001"],
      ["5 Mai 2001", "May 5, 2001"],
      ["6 Juin 2001", "June 6, 2001"],
      ["7 Juillet 2001", "July 7, 2001"],
      ["8 Août 2001", "August 8, 2001"],
      ["9 Septembre 2001", "September 9, 2001"],
      ["10 Octobre 2001", "October 10, 2001"],
      ["11 Novembre 2001", "November 11, 2001"],
      ["12 Décembre 2001", "December 12, 2001"],
    ] as const) {
      expect(normalizeEvaluationDate(french)).toBe(english);
    }
  });

  it("prints diploma country, field, and dates in English and keeps the source credential title", () => {
    expect(normalizeEvaluationField("TECHNIQUES QUANTITATIVES DE GESTION")).toBe("Quantitative Management Techniques");
    expect(normalizeEvaluationField("Mathematics")).toBe("Mathematics");
    const result = assembleDiploma({
      degreeCount: 1,
      documentsReviewed: ["bac.pdf"],
      extracted: {
        credentials: [
          {
            applicant: "Kouamou Nana Myrthe Aristide",
            institution: "Office du Baccalauréat du Cameroun",
            country: "Cameroun",
            credential: "BACCALAUREAT DE L'ENSEIGNEMENT SECONDAIRE TECHNIQUE",
            englishCredential: "Technical Secondary School Baccalaureate",
            field: "TECHNIQUES QUANTITATIVES DE GESTION",
            dates: "26 Mars 2003",
          },
        ],
      },
    });
    expect(result?.kind).toBe("diploma");
    if (result?.kind !== "diploma") return;
    expect(result.credentials[0]).toMatchObject({
      country: "Cameroon",
      credential: "BACCALAUREAT DE L'ENSEIGNEMENT SECONDAIRE TECHNIQUE",
      field: "Quantitative Management Techniques",
      dates: "March 26, 2003",
    });
  });
});

describe("English course names", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps an English title and does not ask the model", async () => {
    const model = vi.spyOn(ai, "generateObject");
    const named = await withEnglishCourseNames({
      country: "Cameroon",
      years: [
        {
          year: "2001",
          courses: [{ originalName: "Mathematics", englishName: "Mathematics", localCredits: 2, localGrade: "14" }],
        },
      ],
    });
    expect(named.years[0]?.courses[0]?.englishName).toBe("Mathematics");
    expect(isEnglishCourseTitle("Mathematics")).toBe(true);
    expect(model).not.toHaveBeenCalled();
  });

  it("translates transcript course titles and keeps Note × Coefficient marks", async () => {
    vi.spyOn(db, "resolveEdgeCountrySlug").mockResolvedValue(null);
    const model = vi.spyOn(ai, "generateObject").mockResolvedValue({
      names: [{ originalName: "Pédagogie Comparée", englishName: "comparative education" }],
    });

    const produced = await evaluateServiceFromText({} as db.Db, courseOrder(), "course_by_course", TRANSCRIPT, [
      "releve.pdf",
    ]);

    expect(produced.result?.kind).toBe("course_by_course");
    if (produced.result?.kind !== "course_by_course") return;
    expect(produced.result.country).toBe("Cameroon");
    expect(produced.result.credential).toMatch(/BACCALAUREAT/i);
    expect(produced.result.years[0]?.courses.map((course) => [course.originalName, course.englishName, course.localGrade])).toEqual([
      ["Sciences Economiques et Juridiques", "Economic and Legal Sciences", "9.5"],
      ["Mathématiques Appliquées", "Applied Mathematics", "12.5"],
      ["Pédagogie Comparée", "Comparative Education", "15"],
    ]);
    expect(model).toHaveBeenCalledTimes(1);
    const prompt = JSON.stringify(model.mock.calls[0]?.[1]);
    expect(prompt).toContain("Pédagogie Comparée");
    expect(prompt).not.toContain("Mathématiques Appliquées");
  });
});
