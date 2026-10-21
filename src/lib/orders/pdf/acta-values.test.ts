import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { assessTranslation } from "../qa";
import { paintedPlanText, planDocument, type PlanStyle } from "./document-layout";
import { fontFace, serifFace, stableFontkit } from "./font";
import type { RenderBlock } from "./layout";
import { renderOrderPdfs } from "./render";

/**
 * Saved reading of order 4c68f5f6-55e3-4c05-8e99-b465b608f26a.
 * The model returned labeled fields. The certificate painter kept the headings
 * and the certification sentence and never drew the values.
 */
const SAVED_ACTA: RenderBlock[] = [
  { type: "seal", text: "Generic Coat of Arms (Sample)" },
  { type: "heading", text: "United Mexican States", align: "center" },
  { type: "heading", text: "Birth certificate", align: "center" },
  { type: "heading", text: "Civil Registry of the State of Jalisco · Certified Copy", align: "center" },
  { type: "kv", label: "Electronic Identifier", value: "00000SAMPLE01482" },
  { type: "heading", text: "Registration data" },
  { type: "kv", label: "Registration Entity", value: "JALISCO" },
  { type: "kv", label: "Registration Municipality", value: "SAN ISIDRO DEL VALLE (FICTICIO)" },
  { type: "kv", label: "Office", value: "0007" },
  { type: "kv", label: "Registration Date", value: "09/19/1996" },
  { type: "kv", label: "Book", value: "0003" },
  { type: "kv", label: "Certificate Number", value: "01482" },
  { type: "heading", text: "DATA OF THE REGISTERED PERSON" },
  { type: "kv", label: "Given Name(s)", value: "VALERIA XIMENA" },
  { type: "kv", label: "First Surname", value: "OLVERA" },
  { type: "kv", label: "Second Surname", value: "TOSTADO" },
  { type: "kv", label: "Sex", value: "FEMALE" },
  { type: "kv", label: "Date of Birth", value: "09/07/1996" },
  { type: "kv", label: "Place of Birth", value: "SAN ISIDRO DEL VALLE, JALISCO, MÉXICO" },
  { type: "kv", label: "Unique Population Registry Code (CURP)", value: "SAMP960907MJCLTL09" },
  { type: "heading", text: "PARENTAGE DATA OF THE REGISTERED PERSON" },
  { type: "kv", label: "Parent", value: "FATHER" },
  { type: "kv", label: "Name", value: "RUBÉN ALONSO OLVERA PADILLA" },
  { type: "kv", label: "Age", value: "31" },
  { type: "kv", label: "Nationality", value: "MEXICAN" },
  { type: "kv", label: "CURP", value: "SAMP650212HJCLDB04" },
  { type: "kv", label: "Parent", value: "MOTHER" },
  { type: "kv", label: "Name", value: "MARÍA DE LOURDES TOSTADO ÍÑIGUEZ" },
  { type: "kv", label: "Age", value: "28" },
  { type: "kv", label: "Nationality", value: "MEXICAN" },
  { type: "kv", label: "CURP", value: "SAMP680530MJCSXR02" },
  { type: "heading", text: "Marginal notes" },
  { type: "paragraph", text: "NO MARGINAL NOTES." },
  {
    type: "paragraph",
    text: "The undersigned, Civil Registry Officer, CERTIFIES that this is a true copy of the record on file in the archives of this Office, which is issued at the request of the interested party for appropriate legal purposes.",
  },
  { type: "paragraph", text: "LIC. ARMANDO TREVIÑO CÁRDENAS (FICTICIO)" },
  { type: "paragraph", text: "Civil Registry Officer · Guadalajara, Jal., on 03/14/2024" },
  { type: "heading", text: "Electronic signature" },
  { type: "signature", electronic: true },
  {
    type: "kv",
    label: "ORIGINAL STRING",
    value: "||01482|SAMP960907MJCLTL09|JALISCO|0007|0003|09/19/1996|SAMPLE-NO-VALIDO||",
  },
  { type: "paragraph", text: "Verify at: sample.invalid" },
  { type: "seal", text: "Civil Registry" },
];

const SOURCE = `ESTADOS UNIDOS MEXICANOS
ACTA DE NACIMIENTO
Identificador electrónico
00000SAMPLE01482
OFICIALÍA
0007
FECHA DE REGISTRO
19/09/1996
LIBRO
0003
NÚMERO DE ACTA
01482
NOMBRE(S)
VALERIA XIMENA
PRIMER APELLIDO
OLVERA
SEGUNDO APELLIDO
TOSTADO
FECHA DE NACIMIENTO
07/09/1996
LUGAR DE NACIMIENTO
SAN ISIDRO DEL VALLE, JALISCO, MÉXICO
RUBÉN ALONSO OLVERA PADILLA
EDAD
31
MARÍA DE LOURDES TOSTADO ÍÑIGUEZ
EDAD
28
CURP
SAMP960907MJCLTL09
SAMP650212HJCLDB04
SAMP680530MJCSXR02
Oficial del Registro Civil · Guadalajara, Jal., a 14 de marzo de 2024`;

const CONFIRMATIONS = [
  { fieldKey: "full_name", confirmedValue: "VALERIA XIMENA OLVERA TOSTADO" },
  { fieldKey: "date_of_birth", confirmedValue: "07/09/1996" },
  { fieldKey: "place_of_birth", confirmedValue: "SAN ISIDRO DEL VALLE, JALISCO, MÉXICO" },
  { fieldKey: "parent_names", confirmedValue: "RUBÉN ALONSO OLVERA PADILLA; MARÍA DE LOURDES TOSTADO ÍÑIGUEZ" },
  { fieldKey: "date_format", confirmedValue: "DD/MM/YYYY" },
];

const VALUES = [
  "VALERIA XIMENA",
  "OLVERA",
  "TOSTADO",
  "RUBÉN ALONSO OLVERA PADILLA",
  "MARÍA DE LOURDES TOSTADO ÍÑIGUEZ",
  "01482",
  "09/07/1996",
  "09/19/1996",
  "0007",
  "SAN ISIDRO DEL VALLE, JALISCO, MÉXICO",
];

function headingsOnly(blocks: RenderBlock[]): string {
  return blocks
    .flatMap((block) => (block.type === "heading" || block.type === "paragraph" ? [block.text] : []))
    .join("\n");
}

async function measure() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(stableFontkit());
  const regular = await doc.embedFont(fontFace("regular").bytes);
  const serif = await doc.embedFont(serifFace(false).bytes);
  const bold = await doc.embedFont(serifFace(true).bytes);
  return (text: string, size: number, style: PlanStyle) => {
    const font = style.serif ? (style.bold ? bold : serif) : regular;
    return font.widthOfTextAtSize(text, size);
  };
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const proxy = await getDocumentProxy(Uint8Array.from(bytes));
  const extracted = await extractText(proxy, { mergePages: true });
  return Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
}

describe("saved Jalisco acta reading", () => {
  it("paints the field values and fails QA when the page has only headings", async () => {
    const width = 612;
    const height = 792;
    const footer = 48;
    const measureText = await measure();
    let size = 12;
    let plan = planDocument({
      kind: "certificate",
      blocks: SAVED_ACTA,
      width,
      height,
      footer,
      size,
      measure: measureText,
      hasPhoto: false,
    });
    while (plan.overflow && size > 8) {
      size -= 0.5;
      plan = planDocument({
        kind: "certificate",
        blocks: SAVED_ACTA,
        width,
        height,
        footer,
        size,
        measure: measureText,
        hasPhoto: false,
      });
    }
    const painted = paintedPlanText(plan);
    for (const value of VALUES) expect(painted).toContain(value);
    expect(plan.overflow).toBe(false);

    const passed = assessTranslation({
      originalPages: [{ number: 1, text: SOURCE }],
      translatedPages: [{ number: 1, text: painted }],
      confirmations: CONFIRMATIONS,
    });
    expect(passed.issues).toEqual([]);
    expect(passed.pass).toBe(true);

    const empty = assessTranslation({
      originalPages: [{ number: 1, text: SOURCE }],
      translatedPages: [{ number: 1, text: headingsOnly(SAVED_ACTA) }],
      confirmations: CONFIRMATIONS,
    });
    expect(empty.pass).toBe(false);
    expect(empty.issues.some((issue) => issue.type === "name" && issue.original.includes("VALERIA"))).toBe(true);
    expect(empty.issues.some((issue) => issue.type === "date" && issue.original === "07/09/1996")).toBe(true);
    expect(empty.issues.some((issue) => issue.type === "number" && issue.original === "01482")).toBe(true);
    expect(empty.issues.some((issue) => issue.type === "name" && issue.original.includes("RUBÉN"))).toBe(true);

    const blankValues = SAVED_ACTA.map((block) => (block.type === "kv" ? { ...block, value: "" } : block));
    const blankPlan = planDocument({
      kind: "certificate",
      blocks: blankValues,
      width,
      height,
      footer,
      size: 11,
      measure: measureText,
      hasPhoto: false,
    });
    const blank = assessTranslation({
      originalPages: [{ number: 1, text: SOURCE }],
      translatedPages: [{ number: 1, text: paintedPlanText(blankPlan) }],
      confirmations: CONFIRMATIONS,
    });
    expect(blank.pass).toBe(false);
    expect(paintedPlanText(blankPlan)).not.toContain("VALERIA");
    expect(paintedPlanText(blankPlan)).not.toContain("01482");

    const rendered = await renderOrderPdfs({
      orderId: "4c68f5f6-55e3-4c05-8e99-b465b608f26a",
      sourceLanguage: "es",
      targetLanguage: "en",
      date: "2026-10-21",
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: width,
          heightPt: height,
          paragraphs: [],
          blocks: SAVED_ACTA,
          kind: "certificate",
        },
      ],
    });
    expect(rendered.pageTexts[0]?.text).toContain("VALERIA XIMENA");
    expect(rendered.pageTexts[0]?.text).toContain("01482");
    const preview = await pdfText(rendered.watermarkedPreview);
    const clean = await pdfText(rendered.cleanTranslation);
    for (const value of ["VALERIA XIMENA", "OLVERA", "TOSTADO", "01482", "RUBÉN ALONSO OLVERA PADILLA", "09/07/1996", "09/19/1996"]) {
      expect(preview).toContain(value);
      expect(clean).toContain(value);
    }
  });
});
