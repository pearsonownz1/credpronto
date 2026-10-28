import { describe, expect, it } from "vitest";
import { layoutNeedsRestore } from "./pdf/source-mirror";
import { blocksToParagraphs, formBlocksWhenCollapsed } from "./pdf/structure";
import { assessTranslation, QA_REVIEW_REASON, qaAttemptForRound, qaStatusForRun, qaWillRetry } from "./qa";
import { isGarbledEmbeddedText } from "./embedded-text";

const originalPages = [
  { number: 1, text: "Acta de Ada Lovelace. Nació el 14/10/1815. Folio 2019." },
];

const confirmations = [
  { fieldKey: "full_name", confirmedValue: "Ada Lovelace" },
  { fieldKey: "date_of_birth", confirmedValue: "14/10/1815" },
  { fieldKey: "place_of_birth", confirmedValue: "London" },
  { fieldKey: "parent_names", confirmedValue: "Anne Isabella Milbanke; Lord Byron" },
  { fieldKey: "date_format", confirmedValue: "DD/MM/YYYY" },
];

describe("translation QA", () => {
  it("passes when confirmed names, the date, and numbers are present", () => {
    const result = assessTranslation({
      originalPages,
      translatedPages: [
        {
          number: 1,
          text: "Birth record of Ada Lovelace, daughter of Anne Isabella Milbanke and Lord Byron, born in London on 14/10/1815. Folio 2019.",
        },
      ],
      confirmations,
    });
    expect(result).toEqual({ pass: true, score: 100, issues: [] });
    expect(qaStatusForRun({ pass: true, attempt: 1 })).toBe("pass");
  });

  it("fails a missing name and a missing number, and retries until the third run", () => {
    const result = assessTranslation({
      originalPages,
      translatedPages: [{ number: 1, text: "Birth record. London. Anne Isabella Milbanke. Lord Byron. 14/10/1815." }],
      confirmations,
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(50);
    expect(result.issues.map((item) => item.type).sort()).toEqual(["name", "number"]);
    expect(result.issues.find((item) => item.type === "name")).toMatchObject({
      severity: "high",
      page: null,
      original: "Ada Lovelace",
      translated: "",
    });
    expect(result.issues.find((item) => item.type === "number")).toMatchObject({
      severity: "high",
      page: 1,
      original: "2019",
    });
    expect(qaWillRetry({ pass: false, attempt: 1 })).toBe(true);
    expect(qaWillRetry({ pass: false, attempt: 2 })).toBe(true);
    expect(qaWillRetry({ pass: false, attempt: 3 })).toBe(false);
    expect(qaStatusForRun({ pass: false, attempt: 2 })).toBe("retranslated");
    expect(qaStatusForRun({ pass: false, attempt: 3 })).toBe("fail");
    expect(qaStatusForRun({ pass: true, attempt: 2 })).toBe("retranslated");
    expect(QA_REVIEW_REASON).toBe("QA found issues that were not fixed after 2 retranslations.");
  });

  it("flags an empty translation and a page-count mismatch", () => {
    const result = assessTranslation({
      originalPages: [{ number: 1, text: "Acta de nacimiento." }],
      translatedPages: [],
      confirmations: [],
    });
    expect(result.issues.map((item) => item.type)).toEqual(["layout", "missing_text"]);
    expect(result.issues[0]).toMatchObject({
      type: "layout",
      page: null,
      original: "1 page",
      translated: "0 pages",
    });
    expect(result.issues[1]).toMatchObject({ type: "missing_text", page: 1, translated: "" });
  });

  it("accepts a Chinese date of birth written in English", () => {
    const result = assessTranslation({
      originalPages: [{ number: 1, text: "出生日期一九九八年五月十日" }],
      translatedPages: [{ number: 1, text: "Date of birth: May 10, 1998." }],
      confirmations: [
        { fieldKey: "date_of_birth", confirmedValue: "一九九八年五月十日" },
        { fieldKey: "date_format", confirmedValue: "MM/DD/YYYY" },
      ],
    });
    expect(result).toEqual({ pass: true, score: 100, issues: [] });
    expect(
      assessTranslation({
        originalPages: [{ number: 1, text: "1998年5月10日" }],
        translatedPages: [{ number: 1, text: "Born 10 May 1998." }],
        confirmations: [{ fieldKey: "date_of_birth", confirmedValue: "1998年5月10日" }],
      }).pass,
    ).toBe(true);
    expect(qaAttemptForRound(0)).toBe(1);
    expect(qaAttemptForRound(2)).toBe(3);
  });

  it("records an unreadable date as low severity and still fails a blank page", () => {
    const unreadable = assessTranslation({
      originalPages: [{ number: 1, text: "born then" }],
      translatedPages: [{ number: 1, text: "Born then." }],
      confirmations: [{ fieldKey: "date_of_birth", confirmedValue: "sometime" }],
    });
    expect(unreadable.pass).toBe(true);
    expect(unreadable.issues).toEqual([
      expect.objectContaining({ type: "date", severity: "low", original: "sometime" }),
    ]);

    const blank = assessTranslation({
      originalPages: [{ number: 1, text: "出生日期一九九八年五月十日" }],
      translatedPages: [{ number: 1, text: "" }],
      confirmations: [{ fieldKey: "date_of_birth", confirmedValue: "一九九八年五月十日" }],
    });
    expect(blank.pass).toBe(false);
    expect(blank.issues.some((item) => item.type === "missing_text" && item.severity === "high")).toBe(true);
  });

  it("matches each semicolon-separated name after folding diacritics and case", () => {
    const fullName = "Çiğdem DAYAN; E. Hakan Eminsoy; Nejat Bilginer";
    const passed = assessTranslation({
      originalPages: [{ number: 1, text: "Taraflar Çiğdem DAYAN, E. Hakan Eminsoy ve Nejat Bilginer." }],
      translatedPages: [
        { number: 1, text: "Parties: Cigdem Dayan, E. Hakan Eminsoy, and Nejat Bilginer." },
      ],
      confirmations: [{ fieldKey: "full_name", confirmedValue: fullName }],
    });
    expect(passed).toEqual({ pass: true, score: 100, issues: [] });

    const empty = assessTranslation({
      originalPages: [{ number: 1, text: "Taraflar." }],
      translatedPages: [{ number: 1, text: "" }],
      confirmations: [{ fieldKey: "full_name", confirmedValue: fullName }],
    });
    expect(empty.issues.filter((item) => item.type === "name").map((item) => item.original)).toEqual([
      "Çiğdem DAYAN",
      "E. Hakan Eminsoy",
      "Nejat Bilginer",
    ]);
    expect(empty.issues.some((item) => item.original === fullName)).toBe(false);
  });

  it("accepts a romanized name and records a missing non-Latin name as medium", () => {
    const passed = assessTranslation({
      originalPages: [{ number: 1, text: "张伟" }],
      translatedPages: [{ number: 1, text: "Name: Zhang Wei" }],
      confirmations: [{ fieldKey: "full_name", confirmedValue: "张伟" }],
    });
    expect(passed).toEqual({ pass: true, score: 100, issues: [] });

    const missing = assessTranslation({
      originalPages: [{ number: 1, text: "张伟" }],
      translatedPages: [{ number: 1, text: "Name withheld." }],
      confirmations: [{ fieldKey: "full_name", confirmedValue: "张伟" }],
    });
    expect(missing.pass).toBe(true);
    expect(missing.score).toBe(90);
    expect(missing.issues).toEqual([
      expect.objectContaining({ type: "name", severity: "medium", original: "张伟" }),
    ]);
  });

  it("scores a labeled birth certificate when the model kept only the certification", () => {
    const source = `ESTADOS UNIDOS MEXICANOS
ACTA DE NACIMIENTO
Registro Civil del Estado de Jalisco · Copia certificada
Identificador electrónico
00000SAMPLE01482
DATOS DEL REGISTRO
ENTIDAD DE REGISTRO
JALISCO
MUNICIPIO DE REGISTRO
SAN ISIDRO DEL VALLE (FICTICIO)
OFICIALÍA
0007
FECHA DE REGISTRO
19/09/1996
LIBRO
0003
NÚMERO DE ACTA
01482
DATOS DE LA PERSONA REGISTRADA
NOMBRE(S)
VALERIA XIMENA
PRIMER APELLIDO
OLVERA
SEGUNDO APELLIDO
TOSTADO
SEXO
MUJER
FECHA DE NACIMIENTO
07/09/1996
LUGAR DE NACIMIENTO
SAN ISIDRO DEL VALLE, JALISCO, MÉXICO
CLAVE ÚNICA DE REGISTRO DE POBLACIÓN (CURP)
SAMP960907MJCLTL09
DATOS DE FILIACIÓN DE LA PERSONA REGISTRADA
PROGENITOR
PADRE
NOMBRE
RUBÉN ALONSO OLVERA PADILLA
EDAD
31
NACIONALIDAD
MEXICANA
CURP
SAMP650212HJCLDB04
PROGENITORA
MADRE
NOMBRE
MARÍA DE LOURDES TOSTADO ÍÑIGUEZ
EDAD
28
NACIONALIDAD
MEXICANA
CURP
SAMP680530MJCSXR02
ANOTACIONES MARGINALES
SIN ANOTACIONES MARGINALES.
El suscrito, Oficial del Registro Civil, CERTIFICA que la presente es copia fiel del acta que obra en el archivo de esta Oficialía.
LIC. ARMANDO TREVIÑO CÁRDENAS (FICTICIO)
FIRMA ELECTRÓNICA AVANZADA
SAMPLExQ2FyZ29zIGZpY3RpY2lvcyBwYXJhIHBydWViYXMgZGUgQ3JlZFByb250bw0KTm8gZXMgdW4gZG9jdW1lbn
RvIHJlYWwgbmkgdmFsaWRvIHBhcmEgdHJhbWl0ZXMgb2ZpY2lhbGVz/AbCdEf0123+SAMPLE==
CADENA ORIGINAL
||01482|SAMP960907MJCLTL09|JALISCO|0007|0003|19/09/1996|SAMPLE-NO-VALIDO||`;
    const collapsed = [
      {
        type: "paragraph" as const,
        text: "The undersigned, Civil Registry Officer, CERTIFIES that this is a true copy of the record on file in the archives of this Office.",
      },
    ];
    const recovered = formBlocksWhenCollapsed(source, collapsed);
    const text = blocksToParagraphs(recovered ?? []).join("\n");
    const result = assessTranslation({
      originalPages: [{ number: 1, text: source }],
      translatedPages: [{ number: 1, text }],
      confirmations: [
        { fieldKey: "full_name", confirmedValue: "VALERIA XIMENA OLVERA TOSTADO" },
        { fieldKey: "date_of_birth", confirmedValue: "07/09/1996" },
        { fieldKey: "place_of_birth", confirmedValue: "SAN ISIDRO DEL VALLE, JALISCO, MÉXICO" },
        { fieldKey: "parent_names", confirmedValue: "RUBÉN ALONSO OLVERA PADILLA; MARÍA DE LOURDES TOSTADO ÍÑIGUEZ" },
        { fieldKey: "date_format", confirmedValue: "DD/MM/YYYY" },
      ],
    });
    expect(isGarbledEmbeddedText(source)).toBe(false);
    expect(recovered).not.toBeNull();
    expect(layoutNeedsRestore(source, recovered ?? [])).toBeNull();
    expect(formBlocksWhenCollapsed(source, recovered ?? [])).toBeNull();
    expect(result.issues).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it("does not force glued OCR digit runs over a clean slash date", () => {
    const garbage = [
      "a sfna Fta de sflfnetda mackenzie direito penal hist",
      "qwrtnpl sflfnetda xyzzqwr plmntr cadaval conclusao curso",
      "direito etapa disciplina nota extra words here now",
      "701211998 1112000 1212000 1111999 folio 2019",
    ].join(" ");
    expect(isGarbledEmbeddedText(garbage)).toBe(true);
    const noisy = assessTranslation({
      originalPages: [{ number: 1, text: garbage }],
      translatedPages: [{ number: 1, text: "Constitutional Law I 5,50 1/2000 and term 2/2000." }],
      confirmations: [],
    });
    const numbers = noisy.issues.filter((item) => item.type === "number").map((item) => item.original);
    expect(numbers).toEqual(["2019"]);
    expect(numbers).not.toContain("1112000");
    expect(numbers).not.toContain("1212000");

    const explained = assessTranslation({
      originalPages: [{ number: 1, text: "Term mark 1112000 sits beside folio 2019." }],
      translatedPages: [{ number: 1, text: "Term 11 1/2000. Folio 2019." }],
      confirmations: [],
    });
    expect(explained.issues.filter((item) => item.type === "number")).toEqual([]);
  });
});
