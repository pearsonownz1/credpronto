import { extractText, extractTextItems, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { planDocument, type PlanStyle } from "./document-layout";
import { PDFDocument } from "pdf-lib";
import { fontFace, serifFace, stableFontkit } from "./font";
import type { RenderBlock } from "./layout";
import { renderOrderPdfs } from "./render";
import { blocksFromModel } from "./structure";

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

/** Content must sit above the footer rule, including on a continuation page. */
async function expectAboveFooter(bytes: Uint8Array, needles: string[]) {
  const extracted = await extractTextItems(new Uint8Array(bytes));
  const pages = extracted.items.slice(1);
  for (const needle of needles) {
    const hits = pages.flatMap((page) => {
      const footer = page.find((item) => /Page \d+ of|Order /.test(item.str));
      const fromBottom = !footer || footer.y < 200;
      return page.filter((item) => item.str.includes(needle)).map((item) => (fromBottom ? item.y : 792 - item.y));
    });
    expect(hits.length, needle).toBeGreaterThan(0);
    for (const y of hits) expect(y, `${needle} at ${y}`).toBeGreaterThan(48);
  }
}

const ORDER = "13fc44cc-b92a-43ff-be4a-09136b3b9fe4";

function courseRow(code: string, title: string): string[] {
  return [code, title, "45", "3", "9,00", "1/2000"];
}

function transcriptTable(start: number, count: number): string[][] {
  const header = ["Code", "Subject", "Hours", "Cr.", "Grade", "Term"];
  const rows = Array.from({ length: count }, (_, index) => {
    const n = start + index;
    return courseRow(`ROW-${String(n).padStart(2, "0")}`, `CONSTITUTIONAL LAW ${n}`);
  });
  const last = rows[rows.length - 1];
  if (last) {
    last[0] = `FINAL-${String(start + count - 1).padStart(2, "0")}`;
    last[1] = "TRAB GRAD INTER";
  }
  return [header, ...rows];
}

const transcriptBlocks: RenderBlock[] = [
  { type: "logo", text: "Mackenzie Presbyterian University" },
  { type: "heading", text: "Certificate of Completion", level: 1, align: "center" },
  { type: "paragraph", text: "ANA MARIA DE ALMEIDA CADAVAL completed the law program." },
  { type: "table", header: true, rows: transcriptTable(1, 34) },
  { type: "table", header: true, rows: transcriptTable(35, 35) },
  { type: "paragraph", text: "University recognized by Decree No. 30511 of 02/07/1962." },
  { type: "address", lines: ["Rua da Consolacao, 896", "CONSOLACAO - CEP 01302-907"] },
  { type: "signature", electronic: false, lines: ["Dean of the Faculty", "Mackenzie Presbyterian University"] },
];

function bulletinBlocks(): RenderBlock[] {
  const subjects = [
    ["History Geography", "9,6", "9,9", "11,8", "15,5", "12,5", "9", "Sasa improved her average but must stay committed."],
    ["English Literature", "14", "9,5", "14", "16,5", "15,3", "14", "Overall, entirely satisfactory."],
    ["Philosophy", "8,1", "11", "6,5", "14,8", "9,8", "6,5", "A disappointing overall performance for Sasa."],
    ["History-Geography", "8,9", "8", "13,5", "17,8", "12,6", "7,3", "Results have improved considerably this year."],
    ["English LVA", "19,3", "19,5", "18,8", "18,8", "12,2", "4,5", "Excellent results. Sasa can still improve."],
    ["Spanish LVB", "11,3", "12,7", "11,6", "14,2", "11,9", "8,8", "A little more engaged this trimester."],
    ["Science", "16,1", "15,5", "14,6", "19", "15,9", "10,8", "A conscientious student whose commitment is adequate."],
    ["Moral and Civic", "16,7", "13,8", "15", "19", "15,8", "12,5", "A good trimester; her oral participation is better."],
    ["Physical Education", "15", "15", "13", "18", "15,3", "13", "Efforts have been made throughout the course."],
  ];
  return [
    { type: "logo", text: "Lycee St Joseph Pierre Rouge" },
    { type: "address", lines: ["600 av. du Campus Agropolis", "34980 MONTFERRIER/LEZ"] },
    { type: "photo", caption: "Holder's photo" },
    { type: "heading", text: "REPORT CARD", level: 1 },
    { type: "heading", text: "3rd Trimester", level: 2 },
    { type: "kv", label: "Student", value: "SERVAN Sasa" },
    { type: "kv", label: "Date of birth", value: "11/21/2008" },
    { type: "kv", label: "Class", value: "Final Year, General Track 01" },
    {
      type: "table",
      header: true,
      rows: [["Subjects", "T2", "T1", "Student", "Max", "Class", "Min", "Assessments"], ...subjects],
    },
    { type: "paragraph", text: "ENDORSEMENT OF THE CHAIR OF THE CLASS COUNCIL" },
    {
      type: "table",
      header: true,
      rows: [
        ["KEY", "SCHOOL LIFE"],
        ["Congratulations: An overall average of 15.", "Half-days absent: 2"],
        ["Compliments: Same standard, lower level.", "Unexcused absences: 0"],
        ["Encouragement: Recognizes efforts made by the student.", "Excused absences: 3"],
        ["Visa of the chair.", "Number of late arrivals: 0"],
      ],
    },
    { type: "signature", electronic: false, lines: ["Mme. TRIAIRE", "Deputy Head of the High School"] },
  ];
}

async function render(blocks: RenderBlock[], kind: "certificate" | "form") {
  return renderOrderPdfs({
    orderId: ORDER,
    sourceLanguage: "pt",
    date: "2026-10-28",
    pages: [{ combinedPageNumber: 1, widthPt: 612, heightPt: 792, paragraphs: [], blocks, kind }],
  });
}

describe("dense pages keep every row and block", () => {
  it("keeps a 71-row two-table transcript, including the footer", async () => {
    const rendered = await render(transcriptBlocks, "certificate");
    const painted = rendered.pageTexts.map((page) => page.text).join("\n");
    const pdf = (await pdfText(rendered.cleanTranslation)).replace(/\s+/g, " ");
    for (const needle of ["ROW-01", "ROW-24", "FINAL-69", "TRAB", "30511", "Consolacao", "01302-907", "Dean", "Mackenzie"]) {
      expect(painted, needle).toContain(needle);
      expect(pdf, needle).toContain(needle);
    }
    expect(rendered.pageTexts).toHaveLength(1);
    await expectAboveFooter(rendered.cleanTranslation, ["FINAL-69", "30511", "Consolacao", "Dean"]);
  });

  it.each(["form", "certificate"] as const)("keeps the bulletin footer on a %s page", async (kind) => {
    const rendered = await render(bulletinBlocks(), kind);
    const painted = rendered.pageTexts.map((page) => page.text).join("\n");
    const pdf = (await pdfText(rendered.cleanTranslation)).replace(/\s+/g, " ");
    for (const needle of [
      "600",
      "34980",
      "MONTFERRIER",
      "SERVAN",
      "ENDORSEMENT",
      "Encouragement",
      "Half-days",
      "Unexcused",
      "Excused",
      "late arrivals",
      "TRIAIRE",
      "Physical",
    ]) {
      expect(painted, `${kind} ${needle}`).toContain(needle);
      expect(pdf, `${kind} ${needle}`).toContain(needle);
    }
    await expectAboveFooter(rendered.cleanTranslation, ["34980", "Encouragement", "TRIAIRE", "ENDORSEMENT"]);
  });

  it("prints every logo and every signer on a certificate", async () => {
    const rendered = await renderOrderPdfs({
      orderId: ORDER,
      sourceLanguage: "pt",
      date: "2026-10-28",
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          kind: "certificate",
          paragraphs: [],
          blocks: [
            { type: "logo", text: "Deloitte." },
            { type: "heading", text: "CERTIFICATE", align: "center" },
            { type: "heading", text: "The New Law 11.638 of 12/28/2007", align: "center" },
            { type: "paragraph", text: "We award the certificate to ANA MARIA DE ALMEIDA CADAVAL." },
            { type: "paragraph", text: "Held on 02/22/2008, with a duration of 4 hours." },
            { type: "signature", electronic: false, lines: ["Marcelo Natale", "Instructor"] },
            { type: "signature", electronic: false, lines: ["Wanderley Olivetti", "Instructor"] },
          ],
        },
        {
          combinedPageNumber: 2,
          widthPt: 612,
          heightPt: 792,
          kind: "certificate",
          paragraphs: [],
          blocks: [
            { type: "logo", text: "Mackenzie Presbyterian University" },
            { type: "heading", text: "FACULTY OF LAW", align: "center" },
            { type: "paragraph", text: "ANA MARIA DE ALMEIDA CADAVAL participated in the bioethics lecture series." },
            { type: "signature", electronic: false, lines: ["Prof. Joao Manuel Reigota", "Coordinator"] },
            { type: "signature", electronic: false, lines: ["Prof. Jane Granzoto Torres da Silva", "Coordinator"] },
            { type: "signature", electronic: false, lines: ["Prof. Ma Scherer Saad", "Coordinator"] },
          ],
        },
      ],
    });
    const first = rendered.pageTexts[0]?.text ?? "";
    const second = rendered.pageTexts[1]?.text ?? "";
    expect(first).toContain("Deloitte");
    expect(first).toContain("Marcelo");
    expect(first).toContain("Natale");
    expect(first).toContain("Wanderley");
    expect(first).toContain("Olivetti");
    expect(second).toContain("Mackenzie");
    expect(second).toContain("Reigota");
    expect(second).toContain("Torres");
    expect(second).toContain("Scherer");
    const pdf = await pdfText(rendered.cleanTranslation);
    expect(pdf).toContain("Deloitte");
    expect(pdf).toContain("Scherer");
    await expectAboveFooter(rendered.cleanTranslation, ["Deloitte", "Natale", "Olivetti", "Reigota", "Torres", "Scherer"]);
  });

  it("keeps a signer name when the model sends signature text and no column", () => {
    const blocks = blocksFromModel({
      blocks: [
        { type: "signature", text: "Marcelo Natale\nInstrutor" },
        { type: "signature", text: "Electronic signature" },
      ],
    });
    expect(blocks[0]).toMatchObject({
      type: "signature",
      electronic: false,
      lines: ["Marcelo Natale", "Instrutor"],
    });
    expect(blocks[1]).toMatchObject({ type: "signature", electronic: true });
  });

  it("places two top seals on one row", async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(stableFontkit());
    const regular = await doc.embedFont(fontFace("regular").bytes);
    const serif = await doc.embedFont(serifFace(false).bytes);
    const bold = await doc.embedFont(serifFace(true).bytes);
    const measure = (text: string, size: number, style: PlanStyle) => {
      const face = style.serif ? (style.bold ? bold : serif) : regular;
      return face.widthOfTextAtSize(text, size);
    };
    const plan = planDocument({
      kind: "certificate",
      blocks: [
        { type: "seal", text: "Faculty of Law", column: "left" },
        { type: "seal", text: "University seal", column: "right" },
        { type: "kv", label: "Name", value: "ANA MARIA DE ALMEIDA CADAVAL" },
        { type: "paragraph", text: "Certificate of participation." },
        { type: "signature", electronic: false, lines: ["Registrar", "Office of the Dean"] },
      ],
      width: 612,
      height: 792,
      footer: 48,
      size: 12,
      measure,
      hasPhoto: false,
    });
    expect(plan.seals).toHaveLength(2);
    const [first, second] = plan.seals ?? [];
    expect(first && second && Math.abs(first.cy - second.cy)).toBeLessThan(8);
    expect(plan.texts.some((item) => item.text === "Registrar")).toBe(true);
    expect(plan.rest ?? []).toEqual([]);
  });
});
