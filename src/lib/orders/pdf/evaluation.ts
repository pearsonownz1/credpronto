import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { LETTER_HEIGHT_PT, LETTER_WIDTH_PT, PREVIEW_WATERMARK, PREVIEW_WATERMARK_OPACITY, previewWatermarkRgb } from "../constants";
import type { DiplomaCredential, EvaluationResult } from "../types";

const BLUE = rgb(0x1f / 255, 0x5e / 255, 1);
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.35, 0.38, 0.44);
const WHITE = rgb(1, 1, 1);
const LINE = rgb(0.82, 0.84, 0.88);
const MARGIN = 48;

export type EvaluationPdfs = {
  clean: Uint8Array;
  preview: Uint8Array;
  pageCount: number;
};

function drawWatermark(page: PDFPage, font: PDFFont): void {
  const color = previewWatermarkRgb();
  for (let y = -LETTER_HEIGHT_PT; y < LETTER_HEIGHT_PT * 2; y += 78) {
    for (let x = -LETTER_WIDTH_PT; x < LETTER_WIDTH_PT * 2; x += 390) {
      page.drawText(PREVIEW_WATERMARK, {
        x,
        y,
        size: 18,
        font,
        color: rgb(color.r, color.g, color.b),
        opacity: PREVIEW_WATERMARK_OPACITY,
        rotate: degrees(45),
      });
    }
  }
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

async function finish(doc: PDFDocument, watermark: boolean): Promise<Uint8Array> {
  if (watermark) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const page of doc.getPages()) drawWatermark(page, font);
  }
  return doc.save();
}

function diplomaPage(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  credential: DiplomaCredential,
): void {
  const width = LETTER_WIDTH_PT - MARGIN * 2;
  const boxHeight = 78;
  const boxY = LETTER_HEIGHT_PT - MARGIN - boxHeight;
  page.drawRectangle({ x: MARGIN, y: boxY, width, height: boxHeight, color: BLUE });
  page.drawText("U.S. EQUIVALENCY", {
    x: MARGIN + 16,
    y: boxY + 46,
    size: 9,
    font,
    color: WHITE,
  });
  page.drawText(credential.usEquivalency, {
    x: MARGIN + 16,
    y: boxY + 22,
    size: 18,
    font: bold,
    color: WHITE,
  });

  const rows: Array<[string, string]> = [
    ["Applicant", credential.applicant],
    ["Institution", credential.institution],
    ["Country", credential.country],
    ["Credential", credential.credential],
    ["Field", credential.field],
    ["Dates", credential.dates],
  ];
  let y = boxY - 28;
  for (const [label, value] of rows) {
    page.drawText(label, { x: MARGIN, y, size: 9, font, color: MUTED });
    page.drawText(value, { x: MARGIN + 110, y, size: 11, font: bold, color: INK });
    y -= 22;
  }
  y -= 8;
  page.drawText("Documents reviewed", { x: MARGIN, y, size: 11, font: bold, color: INK });
  y -= 18;
  for (const name of credential.documentsReviewed) {
    page.drawText(name, { x: MARGIN, y, size: 10, font, color: INK });
    y -= 16;
  }
}

async function renderDiploma(result: Extract<EvaluationResult, { kind: "diploma" }>, watermark: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const credentials = result.credentials.length > 0 ? result.credentials : [];
  for (const credential of credentials) {
    const page = doc.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT]);
    diplomaPage(page, font, bold, credential);
  }
  if (doc.getPageCount() === 0) doc.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT]);
  return finish(doc, watermark);
}

const COLUMNS = [
  { key: "original", label: "Original", width: 120 },
  { key: "english", label: "English", width: 110 },
  { key: "localCredits", label: "Credits", width: 48 },
  { key: "localGrade", label: "Grade", width: 44 },
  { key: "hours", label: "US hours", width: 52 },
  { key: "usGrade", label: "US grade", width: 52 },
  { key: "points", label: "Points", width: 48 },
] as const;

function drawTableHeader(page: PDFPage, font: PDFFont, y: number): number {
  let x = MARGIN;
  for (const column of COLUMNS) {
    page.drawText(column.label, { x, y, size: 8, font, color: MUTED });
    x += column.width;
  }
  page.drawLine({
    start: { x: MARGIN, y: y - 4 },
    end: { x: LETTER_WIDTH_PT - MARGIN, y: y - 4 },
    thickness: 0.6,
    color: LINE,
  });
  return y - 16;
}

async function renderCourses(
  result: Extract<EvaluationResult, { kind: "course_by_course" }>,
  watermark: boolean,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT]);
  let y = LETTER_HEIGHT_PT - MARGIN;
  const summary = `Total hours ${result.totalHours}    GPA ${result.gpa.toFixed(2)}`;
  page.drawText(summary, { x: MARGIN, y, size: 14, font: bold, color: INK });
  y -= 18;
  page.drawText(`${result.applicant} · ${result.institution} · ${result.country}`, {
    x: MARGIN,
    y,
    size: 10,
    font,
    color: MUTED,
  });
  y -= 14;
  page.drawText(result.credential, { x: MARGIN, y, size: 10, font, color: INK });
  y -= 22;
  y = drawTableHeader(page, bold, y);

  const paintRow = (cells: string[], strong: boolean) => {
    if (y < MARGIN + 40) {
      page = doc.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT]);
      y = LETTER_HEIGHT_PT - MARGIN;
      y = drawTableHeader(page, bold, y);
    }
    let x = MARGIN;
    cells.forEach((cell, index) => {
      page.drawText(cell, {
        x,
        y,
        size: 8,
        font: strong ? bold : font,
        color: INK,
      });
      x += COLUMNS[index]?.width ?? 40;
    });
    y -= 14;
  };

  for (const group of result.years) {
    if (y < MARGIN + 56) {
      page = doc.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT]);
      y = LETTER_HEIGHT_PT - MARGIN;
    }
    page.drawText(group.year, { x: MARGIN, y, size: 11, font: bold, color: BLUE });
    y -= 16;
    for (const course of group.courses) {
      paintRow(
        [
          course.originalName,
          course.englishName,
          String(course.localCredits),
          course.localGrade,
          String(course.usSemesterHours),
          course.usGrade,
          course.gradePoints.toFixed(2),
        ],
        false,
      );
    }
  }

  paintRow(["Totals", "", "", "", String(result.totalHours), "", result.gpa.toFixed(2)], true);
  y -= 10;
  page.drawText("Grade scale", { x: MARGIN, y, size: 11, font: bold, color: INK });
  y -= 16;
  for (const line of wrap(result.gradeScale, font, 9, LETTER_WIDTH_PT - MARGIN * 2)) {
    page.drawText(line, { x: MARGIN, y, size: 9, font, color: INK });
    y -= 12;
  }
  return finish(doc, watermark);
}

export async function renderEvaluationPdfs(result: EvaluationResult): Promise<EvaluationPdfs> {
  const clean = result.kind === "diploma" ? await renderDiploma(result, false) : await renderCourses(result, false);
  const preview = result.kind === "diploma" ? await renderDiploma(result, true) : await renderCourses(result, true);
  const loaded = await PDFDocument.load(clean);
  return { clean, preview, pageCount: loaded.getPageCount() };
}
