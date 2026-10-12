import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { BRAND_FOOTER, BRAND_SIGNER } from "../brand";
import { LETTER_HEIGHT_PT, LETTER_WIDTH_PT, PREVIEW_WATERMARK, PREVIEW_WATERMARK_OPACITY, previewWatermarkRgb } from "../constants";
import { customerEvaluationResult } from "../equivalency";
import { usEquivalency } from "../grades";
import type { DiplomaCredential, EvaluationResult } from "../types";
import { loadAtaLogo, loadBrandLogo } from "./cover";
import { faceForCodePoint, fontFace, stableFontkit, type FontFaceId } from "./font";
import { wrapLines } from "./layout";
import { applyCredProntoPdfMetadata } from "./metadata";

const BLUE = rgb(31 / 255, 94 / 255, 255 / 255);
const BLUE_LIGHT = rgb(234 / 255, 240 / 255, 255 / 255);
const BLUE_LINE = rgb(201 / 255, 214 / 255, 255 / 255);
const INK = rgb(11 / 255, 18 / 255, 32 / 255);
const MUTED = rgb(91 / 255, 100 / 255, 116 / 255);
const LINE = rgb(228 / 255, 231 / 255, 236 / 255);
const SOFT = rgb(246 / 255, 247 / 255, 249 / 255);
const WHITE = rgb(1, 1, 1);
const MARGIN = 48;
const CONTENT_W = LETTER_WIDTH_PT - MARGIN * 2;
const FOOTER_CLEARANCE = 86;

export const EVALUATION_ADVISORY =
  "This evaluation is advisory and based on the documents submitted. Acceptance is at the discretion of the receiving institution or agency.";

export type EvaluationReportMeta = {
  reportId: string;
  issued: string;
};

const DEFAULT_META: EvaluationReportMeta = {
  reportId: "CP-E-SAMPLE",
  issued: "Oct 11, 2026",
};

export type EvaluationPdfs = {
  clean: Uint8Array;
  preview: Uint8Array;
  pageCount: number;
};

export function evaluationReportId(orderId: string): string {
  return `CP-E-${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export function evaluationIssuedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

type Weight = "regular" | "bold";
type Ink = ReturnType<typeof rgb>;

type FaceSlot = {
  pdf: PDFFont;
  has: (codePoint: number) => boolean;
};

type Kit = {
  draw(page: PDFPage, text: string, x: number, y: number, size: number, color: Ink, weight: Weight): void;
  width(text: string, size: number, weight: Weight): number;
  wrap(text: string, size: number, weight: Weight, maxWidth: number): string[];
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

async function makeKit(doc: PDFDocument, sample: string): Promise<Kit> {
  doc.registerFontkit(stableFontkit());
  const needed = new Set<FontFaceId>(["regular"]);
  for (const char of Array.from(sample)) {
    const face = faceForCodePoint(char.codePointAt(0) ?? 0, false);
    if (face) needed.add(face.id);
  }
  const embedded = new Map<FontFaceId, FaceSlot>();
  for (const id of needed) {
    const face = fontFace(id);
    const pdf = await doc.embedFont(face.bytes, { subset: true });
    embedded.set(id, { pdf, has: (codePoint) => face.hasGlyph(codePoint) });
  }
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const order: FontFaceId[] = ["regular", "symbols", "cjk-sc", "cjk-jp", "cjk-kr"];
  const upright = order.flatMap((id) => {
    const slot = embedded.get(id);
    return slot ? [slot] : [];
  });

  const fontFor = (char: string, weight: Weight): PDFFont | null => {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint < 32) return null;
    if (weight === "bold" && codePoint <= 126) return bold;
    for (const slot of upright) {
      if (slot.has(codePoint)) return slot.pdf;
    }
    return null;
  };

  const width = (text: string, size: number, weight: Weight): number => {
    let total = 0;
    let buffer = "";
    let font: PDFFont | null = null;
    const flush = () => {
      if (buffer && font) total += font.widthOfTextAtSize(buffer, size);
      buffer = "";
    };
    for (const char of Array.from(text)) {
      const next = fontFor(char, weight);
      if (!next) continue;
      if (next !== font) {
        flush();
        font = next;
      }
      buffer += char;
    }
    flush();
    return total;
  };

  const draw = (page: PDFPage, text: string, x: number, y: number, size: number, color: Ink, weight: Weight) => {
    let cursor = x;
    let buffer = "";
    let font: PDFFont | null = null;
    const flush = () => {
      if (!buffer || !font) {
        buffer = "";
        return;
      }
      const paint = () => page.drawText(buffer, { x: cursor, y, size, font: font ?? undefined, color });
      paint();
      if (weight === "bold" && font !== bold) {
        page.drawText(buffer, { x: cursor + 0.25, y, size, font, color });
      }
      cursor += font.widthOfTextAtSize(buffer, size);
      buffer = "";
    };
    for (const char of Array.from(text)) {
      const next = fontFor(char, weight);
      if (!next) continue;
      if (next !== font) {
        flush();
        font = next;
      }
      buffer += char;
    }
    flush();
  };

  return {
    draw,
    width,
    wrap(text, size, weight, maxWidth) {
      const lines = wrapLines(text, (line) => width(line, size, weight), maxWidth);
      return lines.length > 0 ? lines : [""];
    },
  };
}

function fit(kit: Kit, text: string, size: number, weight: Weight, maxWidth: number): string {
  if (kit.width(text, size, weight) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && kit.width(`${cut}…`, size, weight) > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

type Logos = { brand: PDFImage; ata: PDFImage };

async function loadLogos(doc: PDFDocument): Promise<Logos> {
  const brand = await doc.embedPng(loadBrandLogo());
  const ata = await doc.embedPng(loadAtaLogo());
  return { brand, ata };
}

function drawHeader(page: PDFPage, kit: Kit, meta: EvaluationReportMeta, kind: string, logos: Logos): number {
  const contentTop = LETTER_HEIGHT_PT - 40;
  const brandHeight = 22;
  const brandWidth = brandHeight * (logos.brand.width / logos.brand.height);
  page.drawImage(logos.brand, {
    x: MARGIN,
    y: contentTop - brandHeight,
    width: brandWidth,
    height: brandHeight,
  });

  const ataHeight = 24;
  const ataWidth = ataHeight * (logos.ata.width / logos.ata.height);
  const ataBottom = contentTop - ataHeight;
  page.drawImage(logos.ata, {
    x: LETTER_WIDTH_PT - MARGIN - ataWidth,
    y: ataBottom,
    width: ataWidth,
    height: ataHeight,
  });

  const lines = [`Report ${meta.reportId}`, kind, `Issued ${meta.issued}`];
  let y = ataBottom - 14;
  for (const line of lines) {
    const size = 8;
    kit.draw(page, line, LETTER_WIDTH_PT - MARGIN - kit.width(line, size, "regular"), y, size, MUTED, "regular");
    y -= 11;
  }
  const rule = Math.min(contentTop - brandHeight - 10, y + 4);
  page.drawLine({
    start: { x: MARGIN, y: rule },
    end: { x: LETTER_WIDTH_PT - MARGIN, y: rule },
    thickness: 1.6,
    color: INK,
  });
  return rule - 26;
}

function drawFooter(page: PDFPage, kit: Kit): void {
  const footerY = 28;
  const ruleY = footerY + 16;
  page.drawLine({
    start: { x: MARGIN, y: ruleY },
    end: { x: LETTER_WIDTH_PT - MARGIN, y: ruleY },
    thickness: 0.6,
    color: LINE,
  });
  kit.draw(page, BRAND_SIGNER, MARGIN, ruleY + 8, 8, INK, "bold");
  let size = 8;
  let width = kit.width(BRAND_FOOTER, size, "regular");
  while (width > CONTENT_W && size > 6) {
    size -= 0.25;
    width = kit.width(BRAND_FOOTER, size, "regular");
  }
  const x = MARGIN + Math.max(0, (CONTENT_W - width) / 2);
  kit.draw(page, BRAND_FOOTER, x, footerY, size, MUTED, "regular");
}

function stampFooters(doc: PDFDocument, kit: Kit): void {
  for (const page of doc.getPages()) drawFooter(page, kit);
}

function kitSample(result: unknown, meta: EvaluationReportMeta): string {
  return `${JSON.stringify(result)} ${meta.reportId} ${meta.issued} ${EVALUATION_ADVISORY} ${BRAND_FOOTER} ${BRAND_SIGNER}`;
}

async function finish(doc: PDFDocument, kit: Kit, watermark: boolean): Promise<Uint8Array> {
  stampFooters(doc, kit);
  if (watermark) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const page of doc.getPages()) drawWatermark(page, font);
  }
  applyCredProntoPdfMetadata(doc);
  return doc.save();
}

function drawFacts(
  page: PDFPage,
  kit: Kit,
  title: string,
  rows: Array<[string, string]>,
  top: number,
): number {
  const headerH = 18;
  const rowH = 15;
  const height = headerH + 8 + rows.length * rowH;
  const bottom = top - height;
  page.drawRectangle({
    x: MARGIN,
    y: bottom,
    width: CONTENT_W,
    height,
    color: WHITE,
    borderColor: LINE,
    borderWidth: 0.8,
  });
  page.drawRectangle({
    x: MARGIN + 0.6,
    y: top - headerH,
    width: CONTENT_W - 1.2,
    height: headerH - 0.6,
    color: SOFT,
  });
  kit.draw(page, title.toUpperCase(), MARGIN + 10, top - 13, 8, INK, "bold");
  let baseline = top - headerH - 12;
  for (const [label, value] of rows) {
    const strong = label === "Name" || label === "Credential" || label === "File";
    kit.draw(page, label, MARGIN + 10, baseline, 9, MUTED, "regular");
    kit.draw(page, fit(kit, value, 9, strong ? "bold" : "regular", CONTENT_W - 168), MARGIN + 148, baseline, 9, INK, strong ? "bold" : "regular");
    baseline -= rowH;
  }
  return bottom - 12;
}

function diplomaPage(page: PDFPage, kit: Kit, credential: DiplomaCredential, meta: EvaluationReportMeta, logos: Logos): void {
  let y = drawHeader(page, kit, meta, "Diploma evaluation", logos);
  kit.draw(page, "Educational Credential Evaluation", MARGIN, y, 16, INK, "bold");
  y -= 18;
  kit.draw(page, `Prepared for ${credential.applicant}`, MARGIN, y, 10, MUTED, "regular");
  y -= 16;

  const boxH = 58;
  const boxTop = y;
  const boxBottom = boxTop - boxH;
  page.drawRectangle({
    x: MARGIN,
    y: boxBottom,
    width: CONTENT_W,
    height: boxH,
    color: BLUE_LIGHT,
    borderColor: BLUE_LINE,
    borderWidth: 1,
  });
  kit.draw(page, "U.S. EQUIVALENCY", MARGIN + 14, boxTop - 16, 8, BLUE, "bold");
  let lineY = boxTop - 36;
  for (const line of kit.wrap(credential.usEquivalency, 14, "bold", CONTENT_W - 28).slice(0, 2)) {
    kit.draw(page, line, MARGIN + 14, lineY, 14, INK, "bold");
    lineY -= 16;
  }
  y = boxBottom - 14;

  y = drawFacts(page, kit, "Applicant", [
    ["Name", credential.applicant],
    ["Country of education", credential.country],
  ], y);
  y = drawFacts(page, kit, "Credential", [
    ["Credential", credential.credential],
    ["Institution", credential.institution],
    ["Field", credential.field],
    ["Dates", credential.dates],
  ], y);
  y = drawFacts(
    page,
    kit,
    "Documents reviewed",
    credential.documentsReviewed.map((name) => ["File", name]),
    y,
  );
  for (const line of kit.wrap(EVALUATION_ADVISORY, 8, "regular", CONTENT_W)) {
    kit.draw(page, line, MARGIN, y - 8, 8, MUTED, "regular");
    y -= 11;
  }
}

const COURSE_COLUMNS = [
  { label: "Course", width: 210, align: "left" as const },
  { label: "Credits", width: 52, align: "right" as const },
  { label: "Grade", width: 48, align: "right" as const },
  { label: "U.S. sem. hrs", width: 72, align: "right" as const },
  { label: "U.S. grade", width: 62, align: "right" as const },
  { label: "Points", width: 72, align: "right" as const },
];

function columnStarts(): Array<(typeof COURSE_COLUMNS)[number] & { x: number }> {
  let x = MARGIN;
  return COURSE_COLUMNS.map((column) => {
    const start = x;
    x += column.width;
    return { ...column, x: start };
  });
}

function amount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function drawStat(
  page: PDFPage,
  kit: Kit,
  x: number,
  bottom: number,
  width: number,
  height: number,
  label: string,
  value: string,
  tinted: boolean,
): void {
  page.drawRectangle({
    x,
    y: bottom,
    width,
    height,
    color: tinted ? BLUE_LIGHT : WHITE,
    borderColor: tinted ? BLUE_LINE : LINE,
    borderWidth: 1,
  });
  kit.draw(page, label, x + 10, bottom + height - 16, 7.5, tinted ? BLUE : MUTED, "bold");
  kit.draw(page, fit(kit, value, 11, "bold", width - 20), x + 10, bottom + 12, 11, INK, "bold");
}

type CourseCursor = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  kit: Kit;
  meta: EvaluationReportMeta;
  logos: Logos;
};

function newCoursePage(cursor: CourseCursor, repeatColumns: boolean): void {
  cursor.page = cursor.doc.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT]);
  cursor.y = drawHeader(cursor.page, cursor.kit, cursor.meta, "Course-by-course evaluation", cursor.logos);
  if (repeatColumns) cursor.y = drawCourseColumns(cursor.page, cursor.kit, cursor.y);
}

function drawCourseColumns(page: PDFPage, kit: Kit, top: number): number {
  const height = 16;
  page.drawRectangle({ x: MARGIN, y: top - height, width: CONTENT_W, height, color: SOFT });
  const baseline = top - 11;
  for (const column of columnStarts()) {
    const label = column.label.toUpperCase();
    if (column.align === "right") {
      const right = column.x + column.width - 4;
      kit.draw(page, label, right - kit.width(label, 7, "bold"), baseline, 7, MUTED, "bold");
    } else {
      kit.draw(page, label, column.x + 4, baseline, 7, MUTED, "bold");
    }
  }
  return top - height - 4;
}

function ensureRoom(cursor: CourseCursor, needed: number): void {
  if (cursor.y - needed >= FOOTER_CLEARANCE) return;
  newCoursePage(cursor, true);
}

async function renderDiploma(
  result: Extract<EvaluationResult, { kind: "diploma" }>,
  meta: EvaluationReportMeta,
  watermark: boolean,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const logos = await loadLogos(doc);
  const kit = await makeKit(doc, kitSample(result, meta));
  const credentials = result.credentials.length > 0 ? result.credentials : [];
  for (const credential of credentials) {
    const page = doc.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT]);
    diplomaPage(page, kit, credential, meta, logos);
  }
  if (doc.getPageCount() === 0) doc.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT]);
  return finish(doc, kit, watermark);
}

async function renderCourses(
  result: Extract<EvaluationResult, { kind: "course_by_course" }>,
  meta: EvaluationReportMeta,
  watermark: boolean,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const logos = await loadLogos(doc);
  const kit = await makeKit(doc, kitSample(result, meta));
  const cursor: CourseCursor = {
    doc,
    page: doc.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT]),
    y: 0,
    kit,
    meta,
    logos,
  };
  cursor.y = drawHeader(cursor.page, kit, meta, "Course-by-course evaluation", logos);
  kit.draw(cursor.page, "Course-by-Course Evaluation", MARGIN, cursor.y, 16, INK, "bold");
  cursor.y -= 18;
  const subject = `${result.applicant} · ${result.institution}, ${result.country}`;
  kit.draw(cursor.page, fit(kit, subject, 10, "regular", CONTENT_W), MARGIN, cursor.y, 10, MUTED, "regular");
  cursor.y -= 14;

  const boxH = 48;
  const gap = 8;
  const eqW = CONTENT_W * 0.5 - gap;
  const statW = (CONTENT_W - eqW - gap * 2) / 2;
  const boxBottom = cursor.y - boxH;
  const equivalency = result.usEquivalency ?? usEquivalency(result.credential) ?? result.credential;
  drawStat(cursor.page, kit, MARGIN, boxBottom, eqW, boxH, "U.S. EQUIVALENCY", equivalency, true);
  drawStat(cursor.page, kit, MARGIN + eqW + gap, boxBottom, statW, boxH, "SEMESTER HOURS", amount(result.totalHours), false);
  drawStat(
    cursor.page,
    kit,
    MARGIN + eqW + gap + statW + gap,
    boxBottom,
    statW,
    boxH,
    "U.S. GPA",
    result.gpa.toFixed(2),
    false,
  );
  cursor.y = boxBottom - 16;
  cursor.y = drawCourseColumns(cursor.page, kit, cursor.y);

  const columns = columnStarts();
  const courseCol = columns[0];
  if (!courseCol) return finish(doc, kit, watermark);

  const paintCells = (cells: string[], strong: boolean, rowH: number) => {
    ensureRoom(cursor, rowH + 4);
    const baseline = cursor.y - 11;
    cells.forEach((cell, index) => {
      const column = columns[index];
      if (!column) return;
      const size = 8;
      const weight: Weight = strong ? "bold" : "regular";
      const text = fit(kit, cell, size, weight, column.width - 8);
      if (column.align === "right") {
        const right = column.x + column.width - 4;
        kit.draw(cursor.page, text, right - kit.width(text, size, weight), baseline, size, INK, weight);
      } else {
        kit.draw(cursor.page, text, column.x + 4, baseline, size, INK, weight);
      }
    });
    cursor.y -= rowH;
  };

  for (const group of result.years) {
    ensureRoom(cursor, 36);
    pageYear(cursor, group.year);
    for (const course of group.courses) {
      ensureRoom(cursor, 24);
      const top = cursor.y;
      kit.draw(cursor.page, fit(kit, course.originalName, 8, "regular", courseCol.width - 8), courseCol.x + 4, top - 10, 8, INK, "regular");
      kit.draw(cursor.page, fit(kit, course.englishName, 7.5, "regular", courseCol.width - 8), courseCol.x + 4, top - 20, 7.5, MUTED, "regular");
      const values = [
        amount(course.localCredits),
        course.localGrade,
        amount(course.usSemesterHours),
        course.usGrade,
        course.gradePoints.toFixed(2),
      ];
      values.forEach((cell, index) => {
        const column = columns[index + 1];
        if (!column) return;
        const text = fit(kit, cell, 8, "regular", column.width - 8);
        const right = column.x + column.width - 4;
        kit.draw(cursor.page, text, right - kit.width(text, 8, "regular"), top - 14, 8, INK, "regular");
      });
      cursor.page.drawLine({
        start: { x: MARGIN, y: top - 26 },
        end: { x: LETTER_WIDTH_PT - MARGIN, y: top - 26 },
        thickness: 0.4,
        color: LINE,
      });
      cursor.y = top - 28;
    }
  }

  const totalCredits = result.years.reduce(
    (sum, year) => sum + year.courses.reduce((inner, course) => inner + course.localCredits, 0),
    0,
  );
  ensureRoom(cursor, 28);
  cursor.page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: LETTER_WIDTH_PT - MARGIN, y: cursor.y },
    thickness: 1.2,
    color: INK,
  });
  cursor.y -= 4;
  paintCells(["Total", amount(totalCredits), "", amount(result.totalHours), "GPA", result.gpa.toFixed(2)], true, 16);

  cursor.y -= 8;
  ensureRoom(cursor, 28);
  kit.draw(cursor.page, "Grade scale", MARGIN, cursor.y, 9, INK, "bold");
  cursor.y -= 14;
  for (const line of kit.wrap(result.gradeScale, 8, "regular", CONTENT_W)) {
    ensureRoom(cursor, 12);
    kit.draw(cursor.page, line, MARGIN, cursor.y, 8, MUTED, "regular");
    cursor.y -= 11;
  }

  return finish(doc, kit, watermark);
}

function pageYear(cursor: CourseCursor, label: string): void {
  const height = 16;
  cursor.page.drawRectangle({
    x: MARGIN,
    y: cursor.y - height,
    width: CONTENT_W,
    height,
    color: SOFT,
  });
  cursor.kit.draw(cursor.page, label, MARGIN + 4, cursor.y - 11, 8, INK, "bold");
  cursor.y -= height + 2;
}

export async function renderEvaluationPdfs(
  result: EvaluationResult,
  meta: EvaluationReportMeta = DEFAULT_META,
): Promise<EvaluationPdfs> {
  const shown = customerEvaluationResult(result);
  const clean = shown.kind === "diploma" ? await renderDiploma(shown, meta, false) : await renderCourses(shown, meta, false);
  const preview = shown.kind === "diploma" ? await renderDiploma(shown, meta, true) : await renderCourses(shown, meta, true);
  const loaded = await PDFDocument.load(clean);
  return { clean, preview, pageCount: loaded.getPageCount() };
}
