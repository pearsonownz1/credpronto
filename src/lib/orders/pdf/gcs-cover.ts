import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import {
  GCS_CERTIFICATION_STATEMENTS,
  GCS_CONTACT,
  GCS_FOOTER,
  GCS_LOCALITY,
  GCS_ORG,
  GCS_SIGNER,
  GCS_STREET,
  GCS_SUITE,
  gcsSummaryLine,
} from "../gcs";
import { languageLabel } from "../languages";
import { formatCoverDate } from "./cover";
import { faceForCodePoint, fontFace, stableFontkit, type FontFace, type FontFaceId } from "./font";
import { wrapLines, type RenderInput } from "./layout";

const LOGO_PATH = path.join(process.cwd(), "src/lib/orders/pdf/gcs-logo.png");
const ATA_PATH = path.join(process.cwd(), "src/lib/orders/pdf/gcs-ata-logo.png");
const SIGNATURE_PATH = path.join(process.cwd(), "src/lib/orders/pdf/gcs-signature.png");

const INK = rgb(11 / 255, 18 / 255, 32 / 255);
const MUTED = rgb(91 / 255, 100 / 255, 116 / 255);
const BLUE = rgb(31 / 255, 94 / 255, 255 / 255);
const BLUE_LIGHT = rgb(234 / 255, 240 / 255, 255 / 255);
const BLUE_LINE = rgb(201 / 255, 214 / 255, 255 / 255);
const LINE = rgb(228 / 255, 231 / 255, 236 / 255);
const SOFT = rgb(246 / 255, 247 / 255, 249 / 255);
const WHITE = rgb(1, 1, 1);
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 48;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

/** Extra space under the letterhead so translated text does not sit on the rule. */
export function gcsBodyTopInset(kind: "letter" | "certificate" | null): number {
  return kind ? 72 : 34;
}

type ReadyFace = { pdf: PDFFont; has: (codePoint: number) => boolean; italic: boolean };
type Faces = { regular: PDFFont; upright: ReadyFace[] };

export type GcsLetterhead = { logo: PDFImage; ata: PDFImage };

export function loadGcsLogo(): Uint8Array {
  return new Uint8Array(readFileSync(LOGO_PATH));
}

export function loadGcsAtaLogo(): Uint8Array {
  return new Uint8Array(readFileSync(ATA_PATH));
}

export function loadGcsSignature(): Uint8Array {
  return new Uint8Array(readFileSync(SIGNATURE_PATH));
}

async function embedImage(doc: PDFDocument, bytes: Uint8Array): Promise<PDFImage> {
  try {
    return await doc.embedPng(bytes);
  } catch {
    return doc.embedJpg(bytes);
  }
}

export async function embedGcsLetterhead(doc: PDFDocument): Promise<GcsLetterhead> {
  const [logo, ata] = await Promise.all([embedImage(doc, loadGcsLogo()), embedImage(doc, loadGcsAtaLogo())]);
  return { logo, ata };
}

function fontFor(char: string, faces: Faces): PDFFont | null {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint < 32) return null;
  for (const face of faces.upright) {
    if (face.has(codePoint)) return face.pdf;
  }
  return null;
}

function textWidth(text: string, size: number, faces: Faces): number {
  let total = 0;
  let buffer = "";
  let font: PDFFont | null = null;
  const flush = () => {
    if (buffer && font) total += font.widthOfTextAtSize(buffer, size);
    buffer = "";
  };
  for (const char of Array.from(text)) {
    const next = fontFor(char, faces);
    if (!next) continue;
    if (next !== font) {
      flush();
      font = next;
    }
    buffer += char;
  }
  flush();
  return total;
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  color: ReturnType<typeof rgb>,
  faces: Faces,
): void {
  let cursor = x;
  let buffer = "";
  let font: PDFFont | null = null;
  const flush = () => {
    if (!buffer || !font) {
      buffer = "";
      return;
    }
    page.drawText(buffer, { x: cursor, y, size, font, color });
    cursor += font.widthOfTextAtSize(buffer, size);
    buffer = "";
  };
  for (const char of Array.from(text)) {
    const next = fontFor(char, faces);
    if (!next) continue;
    if (next !== font) {
      flush();
      font = next;
    }
    buffer += char;
  }
  flush();
}

function drawWrapped(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  color: ReturnType<typeof rgb>,
  width: number,
  faces: Faces,
  lineHeight = size * 1.35,
): number {
  const lines = wrapLines(text, (line) => textWidth(line, size, faces), width);
  for (const line of lines) {
    drawText(page, line, x, y, size, color, faces);
    y -= lineHeight;
  }
  return y;
}

async function embedFaces(doc: PDFDocument, sample: string): Promise<Faces> {
  doc.registerFontkit(stableFontkit());
  const ids = new Set<FontFaceId>(["regular"]);
  for (const char of Array.from(sample)) {
    const upright = faceForCodePoint(char.codePointAt(0) ?? 0, false);
    if (upright) ids.add(upright.id);
  }
  const ready = new Map<FontFaceId, ReadyFace>();
  for (const id of ids) {
    const face: FontFace = fontFace(id);
    const pdf = await doc.embedFont(face.bytes, { subset: true });
    ready.set(id, { pdf, has: (codePoint) => face.hasGlyph(codePoint), italic: false });
  }
  const regular = ready.get("regular")?.pdf;
  if (!regular) throw new Error("GCS cover font did not embed");
  const uprightOrder: FontFaceId[] = ["regular", "symbols", "cjk-sc", "cjk-jp", "cjk-kr"];
  return {
    regular,
    upright: uprightOrder.flatMap((id) => {
      const face = ready.get(id);
      return face ? [face] : [];
    }),
  };
}

function drawRight(page: PDFPage, text: string, right: number, y: number, size: number, color: ReturnType<typeof rgb>, faces: Faces): void {
  drawText(page, text, right - textWidth(text, size, faces), y, size, color, faces);
}

/** Letterhead shared by translated pages: logo, corporate member line, contact, rule. */
export function drawGcsLetterhead(page: PDFPage, font: PDFFont, images: GcsLetterhead): void {
  const { width, height } = page.getSize();
  const margin = Math.min(MARGIN_X, width * 0.08);
  const top = height - 36;
  const logoHeight = 28;
  const logoWidth = logoHeight * (images.logo.width / images.logo.height);
  page.drawImage(images.logo, { x: margin, y: top - logoHeight, width: logoWidth, height: logoHeight });

  const ataHeight = 20;
  const ataWidth = ataHeight * (images.ata.width / images.ata.height);
  const right = width - margin;
  page.drawImage(images.ata, { x: right - ataWidth, y: top - ataHeight, width: ataWidth, height: ataHeight });
  const member = "CORPORATE MEMBER OF";
  const memberSize = 7;
  const memberWidth = font.widthOfTextAtSize(member, memberSize);
  const dividerX = right - ataWidth - 8;
  page.drawLine({
    start: { x: dividerX, y: top - ataHeight },
    end: { x: dividerX, y: top },
    thickness: 0.6,
    color: LINE,
  });
  page.drawText(member, {
    x: dividerX - 8 - memberWidth,
    y: top - ataHeight + 6,
    size: memberSize,
    font,
    color: MUTED,
  });

  const contact = GCS_CONTACT;
  const contactSize = 8.5;
  const contactWidth = font.widthOfTextAtSize(contact, contactSize);
  const contactY = top - Math.max(logoHeight, ataHeight) - 16;
  page.drawText(contact, {
    x: Math.max(margin, (width - contactWidth) / 2),
    y: contactY,
    size: contactSize,
    font,
    color: MUTED,
  });
  const ruleY = contactY - 8;
  page.drawLine({
    start: { x: margin, y: ruleY },
    end: { x: right, y: ruleY },
    thickness: 1.5,
    color: INK,
  });
}

export function drawGcsPageFooter(
  page: PDFPage,
  font: PDFFont,
  input: { orderId: string; pageNumber: number; pageCount: number },
): void {
  const { width } = page.getSize();
  const margin = Math.min(MARGIN_X, width * 0.08);
  const y = 28;
  page.drawLine({
    start: { x: margin, y: y + 12 },
    end: { x: width - margin, y: y + 12 },
    thickness: 0.6,
    color: LINE,
  });
  const label = `Order ${input.orderId} · Page ${input.pageNumber} of ${input.pageCount}`;
  const gap = 16;
  let size = 6.25;
  let brandWidth = font.widthOfTextAtSize(GCS_FOOTER, size);
  let labelWidth = font.widthOfTextAtSize(label, size);
  while (brandWidth + gap + labelWidth > width - margin * 2 && size > 5) {
    size -= 0.25;
    brandWidth = font.widthOfTextAtSize(GCS_FOOTER, size);
    labelWidth = font.widthOfTextAtSize(label, size);
  }
  page.drawText(GCS_FOOTER, { x: margin, y, size, font, color: MUTED });
  page.drawText(label, { x: width - margin - labelWidth, y, size, font, color: MUTED });
}

function coverModel(input: RenderInput) {
  const documents = input.documents?.length
    ? input.documents
    : [{ name: "Document", sourcePages: input.pages.length, translatedPages: input.pages.length }];
  const sourceTotal = documents.reduce((sum, document) => sum + document.sourcePages, 0);
  const pages = input.pricedPages ?? sourceTotal;
  const sourceLabel = languageLabel(input.sourceLanguage);
  const targetLabel = languageLabel(input.targetLanguage ?? "en");
  return {
    pages,
    sourceLabel,
    targetLabel,
    issued: formatCoverDate(input.date),
    clientName: input.clientName?.trim() || "Client",
    summary: gcsSummaryLine({
      sourceLabel,
      targetLabel,
      documents: documents.length,
      pages,
    }),
    pageCount: input.pages.length + 1,
  };
}

/** Certificate of Translation Accuracy. Page 1 of a GCS certified translation. */
export async function drawGcsCertificationPage(doc: PDFDocument, input: RenderInput): Promise<void> {
  const cover = coverModel(input);
  const sample = [cover.clientName, cover.summary, ...GCS_CERTIFICATION_STATEMENTS, GCS_FOOTER, GCS_SIGNER].join(
    "\n",
  );
  const faces = await embedFaces(doc, sample);
  const images = await embedGcsLetterhead(doc);
  const signature = await embedImage(doc, loadGcsSignature());
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const contentTop = PAGE_H - 40;
  const logoHeight = 34;
  const logoWidth = logoHeight * (images.logo.width / images.logo.height);
  page.drawImage(images.logo, {
    x: MARGIN_X,
    y: contentTop - logoHeight,
    width: logoWidth,
    height: logoHeight,
  });

  const ataHeight = 24;
  const ataWidth = ataHeight * (images.ata.width / images.ata.height);
  const right = PAGE_W - MARGIN_X;
  const member = "CORPORATE MEMBER OF";
  const memberSize = 7;
  const memberWidth = textWidth(member, memberSize, faces);
  const dividerX = right - ataWidth - 7;
  page.drawImage(images.ata, { x: right - ataWidth, y: contentTop - ataHeight, width: ataWidth, height: ataHeight });
  page.drawLine({
    start: { x: dividerX, y: contentTop - ataHeight },
    end: { x: dividerX, y: contentTop },
    thickness: 0.6,
    color: LINE,
  });
  drawText(page, member, dividerX - 7 - memberWidth, contentTop - 16, memberSize, MUTED, faces);

  const meta = [`Order ${input.orderId}`, "Certified translation", `Issued ${cover.issued}`];
  let metaY = contentTop - ataHeight - 16;
  for (const line of meta) {
    drawRight(page, line, right, metaY, 8, MUTED, faces);
    metaY -= 11;
  }

  const contactWidth = textWidth(GCS_CONTACT, 8.5, faces);
  const contactY = Math.min(contentTop - logoHeight - 18, metaY - 4);
  drawText(page, GCS_CONTACT, (PAGE_W - contactWidth) / 2, contactY, 8.5, MUTED, faces);
  const ruleY = contactY - 8;
  page.drawLine({
    start: { x: MARGIN_X, y: ruleY },
    end: { x: right, y: ruleY },
    thickness: 1.5,
    color: INK,
  });

  let y = ruleY - 22;
  drawText(page, "Certificate of Translation Accuracy", MARGIN_X, y, 16, INK, faces);
  y -= 18;
  y = drawWrapped(page, `Prepared for ${cover.clientName}`, MARGIN_X, y, 10, MUTED, CONTENT_W, faces);
  y -= 8;

  const summaryHeight = 46;
  const summaryBottom = y - summaryHeight;
  page.drawRectangle({
    x: MARGIN_X,
    y: summaryBottom,
    width: CONTENT_W,
    height: summaryHeight,
    color: BLUE_LIGHT,
    borderColor: BLUE_LINE,
    borderWidth: 1,
  });
  drawText(page, "CERTIFIED TRANSLATION", MARGIN_X + 12, summaryBottom + 26, 8, BLUE, faces);
  drawText(page, cover.summary, MARGIN_X + 12, summaryBottom + 10, 12, INK, faces);
  y = summaryBottom - 12;

  const orderRows: Array<[string, string]> = [
    ["Order number", input.orderId],
    ["Date", cover.issued],
    ["Client", cover.clientName],
    ["Language pair", `${cover.sourceLabel} to ${cover.targetLabel}`],
    ["Pages", String(cover.pages)],
  ];
  y = drawLabeledBox(page, faces, "ORDER", orderRows, y);
  const certifiedBottom = drawCertification(page, faces, y);
  drawSignature(page, faces, signature, cover.issued, certifiedBottom);
  drawGcsPageFooter(page, faces.regular, {
    orderId: input.orderId,
    pageNumber: 1,
    pageCount: cover.pageCount,
  });
}

function drawLabeledBox(
  page: PDFPage,
  faces: Faces,
  title: string,
  rows: Array<[string, string]>,
  y: number,
): number {
  const header = 18;
  const rowHeight = 15;
  const height = header + 8 + rows.length * rowHeight;
  const bottom = y - height;
  page.drawRectangle({
    x: MARGIN_X,
    y: bottom,
    width: CONTENT_W,
    height,
    borderColor: LINE,
    borderWidth: 1,
    color: WHITE,
  });
  page.drawRectangle({ x: MARGIN_X, y: y - header, width: CONTENT_W, height: header, color: SOFT });
  page.drawLine({
    start: { x: MARGIN_X, y: y - header },
    end: { x: MARGIN_X + CONTENT_W, y: y - header },
    thickness: 0.6,
    color: LINE,
  });
  drawText(page, title, MARGIN_X + 10, y - 13, 8, INK, faces);
  let rowY = y - header - 16;
  for (const [label, value] of rows) {
    drawText(page, label, MARGIN_X + 10, rowY, 9, MUTED, faces);
    drawText(page, value, MARGIN_X + 120, rowY, 9, INK, faces);
    rowY -= rowHeight;
  }
  return bottom - 12;
}

function drawCertification(page: PDFPage, faces: Faces, y: number): number {
  const size = 8.5;
  const innerWidth = CONTENT_W - 20;
  const lineHeight = 13.2;
  const paragraphs = GCS_CERTIFICATION_STATEMENTS.map((statement) =>
    wrapLines(statement, (line) => textWidth(line, size, faces), innerWidth),
  );
  const textHeight = paragraphs.reduce((sum, lines) => sum + lines.length * lineHeight, 0) + 6;
  const header = 16;
  const height = header + 8 + textHeight;
  const bottom = y - height;
  page.drawRectangle({
    x: MARGIN_X,
    y: bottom,
    width: CONTENT_W,
    height,
    borderColor: LINE,
    borderWidth: 1,
    color: WHITE,
  });
  page.drawRectangle({ x: MARGIN_X, y: y - header, width: CONTENT_W, height: header, color: SOFT });
  page.drawLine({
    start: { x: MARGIN_X, y: y - header },
    end: { x: MARGIN_X + CONTENT_W, y: y - header },
    thickness: 0.6,
    color: LINE,
  });
  drawText(page, "CERTIFICATION", MARGIN_X + 10, y - 12, 8, INK, faces);
  let cursor = y - header - 14;
  paragraphs.forEach((lines, index) => {
    if (index > 0) cursor -= 6;
    for (const line of lines) {
      drawText(page, line, MARGIN_X + 10, cursor, size, INK, faces);
      cursor -= lineHeight;
    }
  });
  return bottom;
}

function drawSignature(page: PDFPage, faces: Faces, signature: PDFImage, issued: string, boxBottom: number): void {
  const height = 46;
  const width = height * (signature.width / signature.height);
  const imageBottom = Math.max(78, boxBottom - 16 - height);
  page.drawImage(signature, { x: MARGIN_X, y: imageBottom, width, height });
  const lines = [GCS_SIGNER, `Order Date: ${issued}`, "", GCS_ORG, GCS_STREET, GCS_SUITE, GCS_LOCALITY];
  let cursor = imageBottom - 16;
  for (const line of lines) {
    if (line) drawText(page, line, MARGIN_X, cursor, 10, INK, faces);
    cursor -= 13;
  }
}
