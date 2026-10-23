import { describe, expect, it } from "vitest";
import { segmentMismatchWarning, translationLines } from "@/components/admin/translation-lines";
import { alignTranslation } from "./segment-source";

/** Source OCR and stored segments from the transcript page on order 5274b9e5. */
const SOURCE = `OFFICE DU BACCALAUREAT DU CAMEROUN
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

const SEGMENTS = [
  "CAMEROON BACCALAUREATE OFFICE",
  "Tel.: (237) 30 55 66 / 30 55 67",
  "P.O. Box 13904 Yaoundé",
  "REPUBLIC OF CAMEROON",
  "Peace - Work - Fatherland",
  "TRANSCRIPT OF GRADES*",
  "Reference: J 180 / 008 / BAG2     35",
  "TECHNICAL SECONDARY EDUCATION BACCALAUREATE",
  "Mr. KOUAMOU NANA MYRTHE ARISTIDE",
  "Number: 08 / 008 / 4055",
  "Born on: 09/09/1979 in MBO BANDJOUN",
  "Successfully passed the examinations for the",
  "COMMERCIAL TECHNICAL SECONDARY EDUCATION BACCALAUREATE",
  "Series: G2 : : QUANTITATIVE MANAGEMENT TECHNIQUES",
  "Session: 2001",
  "Sub-center: BAFOUSSAM",
  "Jury No.: 180",
  "Registration No.: 002213",
  "and was admitted with a Pass grade.",
  "In witness whereof, this document has been issued to serve for all legal purposes.",
  "SUBJECTS COEF. Grade x Coef.",
  "1. Compulsory Written Examinations",
  "1.1. First Group Examinations",
  "Economic and Legal Sciences 4.0 38",
  "Applied Mathematics 2.0 25",
  "Quantitative Management Techniques 5.0 42",
  "Professional Practice (Written Practical Test) 5.0 63",
  "TOTAL I 16.0 168",
  "First group average: 10.50 / 20",
  "1.2. Second Group Examinations",
  "French 3.0 34",
  "Philosophy 2.0 20",
  "English 2.0 15",
  "Civic Education 2.0 24",
  "Mathematics 2.0 17",
  "History or Geography 1.0 6",
  "TOTAL II 12.0 116",
  "Second group average: 9.67 / 20",
  "2. Compulsory Practical Examinations",
  "Professional Practice (on equipment) 2.0 13",
  "TOTAL III 2.0 13",
  "Third group average: 6.50 / 20",
  "Physical Education and Sports (bonus)  3",
  "Optional Examinations (bonus)",
  "GRAND TOTAL 30.0 300",
  "Average / 20  10.00",
  "DECISION ADMITTED",
  "Yaoundé, Wednesday, 08/22/2001",
  "The Acting Director",
  "* Note: This transcript of grades, issued as a single copy, serves as a Certificate of Success.",
];

describe("transcript segment source indexes", () => {
  it("keeps the three split lines on their source row instead of trailing extras", () => {
    const aligned = alignTranslation(SOURCE, SEGMENTS);
    expect(aligned.map((segment) => segment.text)).toEqual(SEGMENTS);
    const indexes = aligned.map((segment) => segment.source_index);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));

    const alignment = translationLines(
      SOURCE,
      aligned.map((segment) => segment.text),
      indexes,
    );
    expect(segmentMismatchWarning(alignment)).toBeNull();
    expect(alignment.extra).toBe(0);
    expect(alignment.missing).toBe(0);

    const session = SOURCE.split("\n").findIndex((line) => line.includes("Sous-centre BAFOUSSAM"));
    const sessionRows = alignment.rows.filter((row) => row.segmentIndex != null && indexes[row.segmentIndex] === session);
    expect(sessionRows.map((row) => row.translation)).toEqual(["Session: 2001", "Sub-center: BAFOUSSAM"]);

    const jury = SOURCE.split("\n").findIndex((line) => line.includes("Matricule"));
    const juryRows = alignment.rows.filter((row) => row.segmentIndex != null && indexes[row.segmentIndex] === jury);
    expect(juryRows.map((row) => row.translation)).toEqual([
      "Jury No.: 180",
      "Registration No.: 002213",
      "and was admitted with a Pass grade.",
    ]);

    const french = alignment.rows.find((row) => row.source.includes("Français"));
    expect(french?.translation).toBe("French 3.0 34");
  });

  it("matches Philosophy to its subject line when that segment is stored first", () => {
    const philosophy = "Philosophy 2.0 20";
    const stored = [philosophy, ...SEGMENTS.filter((segment) => segment !== philosophy)];
    const aligned = alignTranslation(SOURCE, stored);
    const session = SOURCE.split("\n").findIndex((line) => line.includes("Sous-centre BAFOUSSAM"));
    const subject = SOURCE.split("\n").findIndex((line) => line.startsWith("Philosophie"));
    const match = aligned.find((segment) => segment.text === philosophy);
    expect(subject).toBeGreaterThan(session);
    expect(match?.source_index).toBe(subject);
  });

  it("matches Mathematics by its French stem when that segment is stored first", () => {
    const mathematics = "Mathematics";
    const aligned = alignTranslation(SOURCE, [mathematics, ...SEGMENTS]);
    const subject = SOURCE.split("\n").findIndex((line) => line.startsWith("Mathématiques |"));
    const philosophy = SOURCE.split("\n").findIndex((line) => line.startsWith("Philosophie"));
    const match = aligned.find((segment) => segment.text === mathematics);
    expect(subject).toBeGreaterThanOrEqual(0);
    expect(match?.source_index).toBe(subject);
    expect(match?.source_index).not.toBe(philosophy);
  });

  it("keeps a stored source_index and does not invent a new one", () => {
    expect(
      alignTranslation("A\nB", [
        { text: "b", source_index: 1 },
        { text: "a", source_index: 0 },
      ]),
    ).toEqual([
      { text: "a", source_index: 0 },
      { text: "b", source_index: 1 },
    ]);
  });
});
