import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { paintedPlanText, planDocument, type PlanStyle, type PlanText } from "./document-layout";
import { fontFace, serifFace, stableFontkit } from "./font";
import type { RenderBlock } from "./layout";
import { renderOrderPdfs } from "./render";

const ORDER = "13fc44cc-b92a-43ff-be4a-09136b3b9fe4";
const REPORT = "453f72b1-d6da-4661-8841-5cac45150e46";

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

function code(index: number): string {
  return `S${String(index).padStart(2, "0")}`;
}

function stageRows(title: string, from: number, count: number): string[][] {
  const rows: string[][] = [[title, "", "", ""]];
  for (let offset = 0; offset < count; offset += 1) {
    const index = from + offset;
    const term = index % 2 === 0 ? "1/1999" : "2/2000";
    rows.push([code(index), `Civil Law ${index}`, index % 5 === 0 ? "10.0" : "9.5", term]);
  }
  return rows;
}

function transcriptBlocks(): RenderBlock[] {
  const left = [
    ...stageRows("1st Stage", 1, 10),
    ...stageRows("2nd Stage", 11, 10),
    ...stageRows("3rd Stage", 21, 10),
    ...stageRows("4th Stage", 31, 6),
  ];
  const right = [
    ...stageRows("5th Stage", 37, 12),
    ...stageRows("6th Stage", 49, 12),
    ...stageRows("7th Stage", 61, 11),
  ];
  const header = ["Code", "Subject", "Grade", "Term"];
  const fields = [
    ["Student", "Ana Maria de Almeida Cadaval"],
    ["Registration", "2702358"],
    ["ID document", "12.345.678-9"],
    ["Birth date", "03/15/1978"],
    ["Place of birth", "São Paulo"],
    ["Nationality", "Brazilian"],
    ["Program", "Law"],
    ["Institution", "Mackenzie Presbyterian University"],
    ["Campus", "Higienópolis"],
    ["Enrollment", "1999"],
    ["Status", "Graduate"],
    ["Record No.", "2902352"],
    ["Issue date", "12/20/2002"],
  ];
  return [
    { type: "heading", text: "MACKENZIE PRESBYTERIAN UNIVERSITY", align: "center", bold: true },
    { type: "heading", text: "SCHOOL TRANSCRIPT", align: "center" },
    { type: "fields", rows: fields.map(([label, value]) => ({ label, value })) },
    { type: "table", header: true, rows: [header, ...left] },
    { type: "table", header: true, rows: [header, ...right] },
    { type: "paragraph", text: "Decree No. 80.123 of the Ministry of Education." },
    { type: "paragraph", text: "Address: Rua da Consolação 930, São Paulo, SP." },
  ];
}

function comment(subject: string): string {
  return `${subject} — Participates regularly and produces careful written work across every assignment. Steady progress this term. Further practice on structured argument, oral presentation, and source citation will help the student consolidate the grade before the council meets.`;
}

function reportBlocks(): RenderBlock[] {
  const subjects = [
    "French",
    "Mathematics",
    "History",
    "Geography",
    "English",
    "Physics",
    "Natural Sciences",
    "Physical Education",
    "Plastic Arts",
  ];
  return [
    { type: "heading", text: "SCHOOL REPORT CARD", align: "center", bold: true },
    { type: "paragraph", text: "Student: Servan Sasa. Class: Troisième. Year: 1998-1999." },
    {
      type: "table",
      header: true,
      rows: [
        ["Subject", "Teacher's assessment", "Grade"],
        ...subjects.map((subject, index) => [subject, comment(subject), (12 + (index % 4) * 0.5).toFixed(1)]),
      ],
    },
    {
      type: "table",
      header: true,
      rows: [
        ["Period", "Class average"],
        ["First trimester", "13.20"],
        ["Second trimester", "13.80"],
        ["Third trimester", "14.10"],
      ],
    },
    {
      type: "table",
      header: true,
      rows: [
        ["Absences", "Justified", "Unjustified"],
        ["First trimester", "2", "0"],
        ["Second trimester", "1", "1"],
        ["Year total", "4", "1"],
      ],
    },
    {
      type: "table",
      header: true,
      rows: [
        ["Council decision", "Result"],
        ["Class council", "Promoted"],
        ["Next grade", "Seconde"],
      ],
    },
    { type: "paragraph", text: "ENDORSEMENT OF THE CHAIR OF THE CLASS COUNCIL", align: "center", bold: true },
    { type: "signature", electronic: false, lines: ["Mme. TRIAIRE", "Chair of the Class Council"] },
  ];
}

async function fitCertificate(blocks: RenderBlock[], width = 612, height = 792) {
  const measureText = await measure();
  let size = 13.5;
  let plan = planDocument({
    kind: "certificate",
    blocks,
    width,
    height,
    footer: 48,
    size,
    measure: measureText,
    hasPhoto: false,
    topInset: 72,
  });
  while (plan.overflow && size > 5.5) {
    size = Math.round((size - 0.5) * 2) / 2;
    plan = planDocument({
      kind: "certificate",
      blocks,
      width,
      height,
      footer: 48,
      size,
      measure: measureText,
      hasPhoto: false,
      topInset: 72,
    });
  }
  return { size, plan };
}

function at(plan: { texts: PlanText[] }, label: string): PlanText | undefined {
  return plan.texts.find((item) => item.text === label);
}

describe("dense transcript and certificate pages", () => {
  it("fits a 71-course two-column transcript, including the decree and address", async () => {
    const blocks = transcriptBlocks();
    const courses = Array.from({ length: 71 }, (_, index) => code(index + 1));
    expect(courses).toHaveLength(71);
    const { plan } = await fitCertificate(blocks);
    const painted = paintedPlanText(plan);
    expect(plan.overflow).toBe(false);
    for (const course of courses) expect(painted, course).toContain(course);
    expect(painted).toContain("1st Stage");
    expect(painted).toContain("7th Stage");
    expect(painted).toContain("Decree");
    expect(painted).toContain("80.123");
    expect(painted).toContain("Consolação");
    const left = at(plan, "S01");
    const right = at(plan, "S37");
    expect(left && right).toBeTruthy();
    expect(right!.x).toBeGreaterThan(left!.x + 80);
    expect(Math.abs(left!.y - right!.y)).toBeLessThan(40);

    const rendered = await renderOrderPdfs({
      orderId: ORDER,
      sourceLanguage: "pt",
      targetLanguage: "en",
      date: "2026-10-28",
      clientName: "Ana Maria de Almeida Cadaval",
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          kind: "certificate",
          paragraphs: [],
          blocks,
        },
      ],
    });
    expect(rendered.pageTexts).toHaveLength(1);
    const text = rendered.pageTexts[0]?.text ?? "";
    for (const course of courses) expect(text, course).toContain(course);
    expect(text).toContain("1st Stage");
    expect(text).toContain("4th Stage");
    expect(text).toContain("7th Stage");
    expect(text).toContain("Decree");
    expect(text).toContain("80.123");
    expect(text).toContain("Consolação");
    expect(text).toContain("1/1999");
    expect(text).toContain("2/2000");
    expect(text).not.toContain("111999");
    expect(text).not.toContain("1112001");
  });

  it("keeps a dense French report card, its three bottom tables, and the chair's endorsement on one page", async () => {
    const blocks = reportBlocks();
    const { plan } = await fitCertificate(blocks);
    const painted = paintedPlanText(plan);
    expect(plan.overflow).toBe(false);
    for (const subject of ["French", "Mathematics", "Plastic"]) expect(painted).toContain(subject);
    expect(painted).toContain("13.20");
    expect(painted).toContain("13.80");
    expect(painted).toContain("14.10");
    expect(painted).toContain("Absences");
    expect(painted).toContain("Promoted");
    expect(painted).toContain("Seconde");
    expect(painted).toContain("ENDORSEMENT");
    expect(painted).toContain("TRIAIRE");

    const rendered = await renderOrderPdfs({
      orderId: REPORT,
      sourceLanguage: "fr",
      targetLanguage: "en",
      date: "2026-10-28",
      clientName: "Servan Sasa",
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          kind: "certificate",
          paragraphs: [],
          blocks,
        },
      ],
    });
    expect(rendered.pageTexts).toHaveLength(1);
    const text = rendered.pageTexts[0]?.text ?? "";
    expect(text).toContain("French");
    expect(text).toContain("Plastic");
    expect(text).toContain("13.20");
    expect(text).toContain("13.80");
    expect(text).toContain("14.10");
    expect(text).toContain("Absences");
    expect(text).toContain("Justified");
    expect(text).toContain("Promoted");
    expect(text).toContain("Seconde");
    expect(text).toContain("ENDORSEMENT OF THE CHAIR OF THE CLASS COUNCIL");
    expect(text).toContain("Mme.");
    expect(text).toContain("TRIAIRE");
  });

  it("places certificate body text under the seal caption and keeps three signatories side by side", async () => {
    const blocks: RenderBlock[] = [
      { type: "logo", text: "Mackenzie" },
      { type: "heading", text: "FACULTY OF LAW", align: "center", bold: true },
      { type: "heading", text: "Office of Complementary Activities", align: "center" },
      { type: "seal", text: "Mackenzie Presbyterian University" },
      {
        type: "paragraph",
        text: "We certify that Ana Maria de Almeida Cadaval completed the complementary activities with merit.",
      },
      { type: "paragraph", text: "São Paulo, March 12, 2002." },
      { type: "address", lines: ["Rua da Consolação 930", "São Paulo, SP"] },
      { type: "list", ordered: true, label: "Annex", items: ["Attendance record", "Grade sheet"] },
      { type: "stamp", text: "Registrar" },
      { type: "handwritten", text: "Approved" },
      { type: "illegible" },
      { type: "note", text: "Filed in 2002." },
      { type: "signature", electronic: false, lines: ["Marcelo Natale", "Professor"] },
      { type: "signature", electronic: false, lines: ["Wanderley Olivetti", "Coordinator"] },
      { type: "signature", electronic: false, lines: ["Helena Souza", "Director"] },
    ];
    const plan = planDocument({
      kind: "certificate",
      blocks,
      width: 612,
      height: 792,
      footer: 48,
      size: 12,
      measure: await measure(),
      hasPhoto: false,
    });
    expect(plan.overflow).toBe(false);
    expect(plan.seals).toHaveLength(1);
    const caption = plan.texts.find((item) => item.text.startsWith("[Seal:"));
    const certify = plan.texts.find((item) => item.text === "certify");
    const marcelo = at(plan, "Marcelo");
    const wanderley = at(plan, "Wanderley");
    const helena = at(plan, "Helena");
    expect(caption && certify && marcelo && wanderley && helena).toBeTruthy();
    expect(certify!.y + certify!.size).toBeLessThan(caption!.y - caption!.size * 0.2);
    const seal = plan.seals?.[0];
    expect(seal).toBeTruthy();
    expect(certify!.y + certify!.size).toBeLessThan(seal!.cy - seal!.outer);
    expect(marcelo!.x).toBeLessThan(wanderley!.x);
    expect(wanderley!.x).toBeLessThan(helena!.x);
    expect(marcelo!.y).toBeCloseTo(wanderley!.y, 0);
    expect(wanderley!.y).toBeCloseTo(helena!.y, 0);
    expect(helena!.x - marcelo!.x).toBeGreaterThan(120);
    expect(certify!.y).toBeGreaterThan(marcelo!.y + marcelo!.size);

    const painted = paintedPlanText(plan);
    expect(painted).toContain("[Logo:");
    expect(painted).toContain("Mackenzie]");
    expect(painted).toContain("Consolação");
    expect(painted).toContain("Annex");
    expect(painted).toContain("Attendance");
    expect(painted).toContain("[Stamp:");
    expect(painted).toContain("Registrar]");
    expect(painted).toContain("[Handwritten:");
    expect(painted).toContain("Approved]");
    expect(painted).toContain("[Illegible]");
    expect(painted).toContain("Filed");
    expect(painted).toContain("2002.");

    const rendered = await renderOrderPdfs({
      orderId: ORDER,
      sourceLanguage: "pt",
      targetLanguage: "en",
      date: "2026-10-28",
      clientName: "Ana Maria de Almeida Cadaval",
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          kind: "certificate",
          paragraphs: [],
          blocks,
        },
      ],
    });
    const text = rendered.pageTexts[0]?.text ?? "";
    expect(text).toContain("Marcelo");
    expect(text).toContain("Natale");
    expect(text).toContain("Wanderley");
    expect(text).toContain("Olivetti");
    expect(text).toContain("Helena");
    expect(text).toContain("Souza");
    expect(text).toContain("certify");
    expect(text).toContain("[Seal:");
    expect(text).toContain("Mackenzie Presbyterian University");
    expect(text).toContain("[Logo:");
    expect(text).toContain("[Illegible]");
  });
});
