import { describe, expect, it } from "vitest";
import { assembleCourse } from "./evaluation";
import {
  courseExtractFromTranscript,
  recoverCourseExtract,
  textForPaidEvaluation,
} from "./evaluation-transcript";

/** OCR from order 5274b9e5, document Aristide.pdf. The relevé prints coefficient and note × coefficient. */
const TRANSCRIPT = `OFFICE DU BACCALAUREAT DU CAMEROUN
Tél. : (237) 30 55 66 / 30 55 67
B.P. 13904 Yaoundé

REPUBLIQUE DU CAMEROUN
Paix - Travail - Patrie

RELEVE DE NOTES*
J 180 / 008 / BAG2     35
BACCALAUREAT DE L'ENSEIGNEMENT SECONDAIRE TECHNIQUE

M KOUAMOU NANA MYRTHE ARISTIDE
08 / 008 / 4055
Né(e) le 09/09/1979 à MBO BANDJOUN

A subi avec succès les épreuves de l’examen du
BACCALAUREAT DE L'ENSEIGNEMENT SECONDAIRE TECHNIQUE COMMERCIAL
Série : G2 : : TECHNIQUES QUANTITATIVES DE GESTION
Session de 2001     Sous-centre BAFOUSSAM
Jury N° 180     Matricule N° 002213     et a été admis(e) avec la mention Passable

En foi de quoi le présent document est établi pour servir et valoir ce que de droit.

MATIERES | COEF. | Note x Coef
1. Epreuves Obligatoires Ecrites
1.1. Epreuves du Premier Groupe
Sciences Economiques et Juridiques | 4.0 | 38
Mathématiques Appliquées | 2.0 | 25
Techniques Quantitatives de Gestion | 5.0 | 42
Pratique Professionnelle (Pratique Ecrite) | 5.0 | 63
TOTAL I | 16.0 | 168
Moyenne du 1er groupe : 10.50 / 20

1.2. Epreuves du Deuxième Groupe
Français | 3.0 | 34
Philosophie | 2.0 | 20
Anglais | 2.0 | 15
Education Civique | 2.0 | 24
Mathématiques | 2.0 | 17
Histoire ou Géographie | 1.0 | 6
TOTAL II | 12.0 | 116
Moyenne du 2ème groupe : 9.67 / 20

2. Epreuves Obligatoires Pratiques
Pratique Professionnelle (sur matériel) | 2.0 | 13
TOTAL III | 2.0 | 13
Moyenne du 3ème groupe : 6.50 / 20

Education Physique et Sportive (en +) | 3
Epreuves Facultatives (en +)
TOTAL GENERAL | 30.0 | 300
Moyenne / 20 | 10.00
DECISION | ADMIS

Yaoundé le Mercredi 22 Août 2001
Le Directeur, p.i.

* N.B. Le présent relevé de notes, délivré en un seul exemplaire tient lieu d'Attestation de Réussite.`;

const DIPLOMA = `Baccalauréat de l'Enseignement Secondaire
Le diplôme du Baccalauréat de l'Enseignement Secondaire Technique et Professionnel
est conféré à M. KOUAMOU NANA MYRTHE ARISTIDE`;

function headedReleve(rows: string, columns = ""): string {
  return `RELEVE DE NOTES
OFFICE DU BACCALAUREAT DU CAMEROUN
M KOUAMOU NANA MYRTHE ARISTIDE
BACCALAUREAT DE L'ENSEIGNEMENT SECONDAIRE
Session de 2001
${columns}
${rows}`;
}

describe("course extract from the coefficient transcript", () => {
  it("turns note × coefficient into the mark out of 20 and skips totals", () => {
    const parsed = courseExtractFromTranscript(TRANSCRIPT);
    const extracted = parsed.extract;
    expect(parsed.failures).toEqual([]);
    expect(extracted).toMatchObject({
      applicant: "KOUAMOU NANA MYRTHE ARISTIDE",
      country: "Cameroon",
      scale: "20",
      result: "ADMIS",
      years: [{ year: "2001" }],
    });
    const courses = extracted?.years[0]?.courses ?? [];
    expect(courses.map((course) => [course.originalName, course.localCredits, course.localGrade])).toEqual([
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
    ]);
    expect(courses.some((course) => /total|moyenne|decision/i.test(course.originalName))).toBe(false);

    const result = extracted ? assembleCourse(extracted) : null;
    expect(result?.kind).toBe("course_by_course");
    if (result?.kind !== "course_by_course") return;
    expect(result.totalHours).toBe(30);
    expect(result.years[0]?.courses.map((course) => course.usGrade)).toEqual([
      "D",
      "C",
      "D",
      "C",
      "C",
      "C",
      "D",
      "C",
      "D",
      "D",
      "D",
    ]);
  });

  it("keeps a mark already out of 20 and divides only a value over 20", () => {
    const parsed = courseExtractFromTranscript(
      headedReleve(`Histoire | 2 | 12
Mathématiques | 3 | 14
Français | 2 | 11
Sciences | 2 | 25`),
    );
    expect(parsed.extract?.years[0]?.courses.map((course) => [course.originalName, course.localGrade])).toEqual([
      ["Histoire", "12"],
      ["Mathématiques", "14"],
      ["Français", "11"],
      ["Sciences", "12.5"],
    ]);
    expect(parsed.failures).toEqual([]);
  });

  it("divides a mark of 12 when the column is Note × Coef", () => {
    const parsed = courseExtractFromTranscript(
      headedReleve(
        `Histoire | 2 | 12
Anglais | 2 | 15
Mathématiques | 2 | 17`,
        "MATIERES | COEF. | Note x Coef",
      ),
    );
    expect(parsed.extract?.years[0]?.courses.map((course) => [course.originalName, course.localGrade])).toEqual([
      ["Histoire", "6"],
      ["Anglais", "7.5"],
      ["Mathématiques", "8.5"],
    ]);
  });

  it("records a coefficient of 0, a result over 20, and a missing coefficient", () => {
    const parsed = courseExtractFromTranscript(
      headedReleve(`Histoire | 2 | 12
Mathématiques | 3 | 14
Français | 2 | 11
Sport | 0 | 15
Chimie | 2 | 50
Physique | 18
Biologie | | 16`),
    );
    expect(parsed.extract?.years[0]?.courses.map((course) => course.originalName)).toEqual([
      "Histoire",
      "Mathématiques",
      "Français",
    ]);
    expect(parsed.failures).toEqual([
      { row: "Sport | 0 | 15", reason: "Coefficient is 0" },
      { row: "Chimie | 2 | 50", reason: "Result is over 20" },
      { row: "Physique | 18", reason: "No coefficient" },
      { row: "Biologie | | 16", reason: "No coefficient" },
    ]);
  });

  it("recovers a model extract that copied the weighted column and dropped the total row", () => {
    const recovered = recoverCourseExtract({
      applicant: "KOUAMOU NANA MYRTHE ARISTIDE",
      institution: "Office du Baccalauréat du Cameroun",
      country: "Cameroon",
      credential: "Baccalauréat",
      scale: "20",
      result: "Admis",
      years: [
        {
          year: "2001",
          courses: [
            { originalName: "Mathématiques", englishName: "Mathematics", localCredits: 2, localGrade: "25" },
            { originalName: "TOTAL I", englishName: "TOTAL I", localCredits: 16, localGrade: "168" },
          ],
        },
      ],
    });
    expect(recovered.extract.years[0]?.courses).toEqual([
      { originalName: "Mathématiques", englishName: "Mathematics", localCredits: 2, localGrade: "12.5" },
    ]);
    expect(recovered.failures).toEqual([]);
    expect(assembleCourse(recovered.extract)?.kind).toBe("course_by_course");
  });

  it("records model rows with no coefficient, a zero coefficient, or a result over 20", () => {
    const recovered = recoverCourseExtract({
      applicant: "KOUAMOU NANA MYRTHE ARISTIDE",
      institution: "Office du Baccalauréat du Cameroun",
      country: "Cameroon",
      credential: "Baccalauréat",
      scale: "20",
      years: [
        {
          year: "2001",
          courses: [
            { originalName: "Histoire", englishName: "History", localCredits: 2, localGrade: "12" },
            { originalName: "Sport", englishName: "Sport", localCredits: 0, localGrade: "15" },
            { originalName: "Chimie", englishName: "Chemistry", localCredits: 2, localGrade: "50" },
            { originalName: "Physique", englishName: "Physics", localCredits: Number.NaN, localGrade: "16" },
          ],
        },
      ],
    });
    expect(recovered.extract.years[0]?.courses).toEqual([
      { originalName: "Histoire", englishName: "History", localCredits: 2, localGrade: "12" },
    ]);
    expect(recovered.failures).toEqual([
      { row: "Sport | 0 | 15", reason: "Coefficient is 0" },
      { row: "Chimie | 2 | 50", reason: "Result is over 20" },
      { row: "Physique | NaN | 16", reason: "No coefficient" },
    ]);
  });

  it("gives course-by-course the transcript page and the diploma the other page", () => {
    const documents = [
      { id: "doc-diploma", position: 1 },
      { id: "doc-transcript", position: 2 },
    ];
    const pages = [
      { documentId: "doc-diploma", pageNumber: 1, ocrText: DIPLOMA },
      { documentId: "doc-transcript", pageNumber: 1, ocrText: TRANSCRIPT },
    ];
    const course = textForPaidEvaluation(documents, pages, "course_by_course");
    const diploma = textForPaidEvaluation(documents, pages, "diploma");
    expect(course).toContain("RELEVE DE NOTES");
    expect(course).not.toContain("est conféré");
    expect(diploma).toContain("est conféré");
    expect(diploma).not.toContain("RELEVE DE NOTES");
  });
});
