import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { languageLabel } from "../languages";
import { faceForCodePoint, fontFace, stableFontkit, type FontFace, type FontFaceId } from "./font";
import { wrapLines, type CoverDocument, type RenderInput } from "./layout";

export const COVER_ADDRESS = "2520 Venture Oaks Way, Suite 120, Sacramento, CA 95833";

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

export type { CoverDocument };

export type ResolvedCover = {
  orderId: string;
  issued: string;
  clientName: string;
  sourceLanguage: string;
  targetLanguage: string;
  pair: string;
  summary: string;
  statement: string;
  documents: CoverDocument[];
  sourceTotal: number;
  translatedTotal: number;
  translatorName: string;
  signature: Uint8Array | null;
  pageCount: number;
};

type ReadyFace = {
  pdf: PDFFont;
  has: (codePoint: number) => boolean;
  italic: boolean;
};

type Faces = {
  regular: PDFFont;
  upright: ReadyFace[];
  italic: ReadyFace | null;
};

export function coverTranslatorName(
  approverName: string | null | undefined,
  configuredName = process.env.CREDPRONTO_TRANSLATOR_NAME,
): string {
  const approver = approverName?.trim();
  if (approver) return approver;
  const configured = configuredName?.trim();
  if (configured) return configured;
  return "CredPronto";
}

/** The configured signature belongs to the configured translator, not a different approver. */
export function coverSignature(
  approverName: string | null | undefined,
  signature: Uint8Array | null | undefined,
  configuredName = process.env.CREDPRONTO_TRANSLATOR_NAME,
): Uint8Array | null {
  if (!signature?.byteLength) return null;
  const approver = approverName?.trim();
  const configured = configuredName?.trim();
  if (approver && configured && approver !== configured) return null;
  if (approver && !configured) return null;
  return signature;
}

export function loadTranslatorSignature(value = process.env.CREDPRONTO_TRANSLATOR_SIGNATURE): Uint8Array | null {
  const raw = value?.trim();
  if (!raw) return null;
  const data = raw.match(/^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i);
  if (data?.[1]) return Uint8Array.from(Buffer.from(data[1], "base64"));
  if (/^[A-Za-z0-9+/=\s]+$/.test(raw) && raw.replace(/\s/g, "").length > 80) {
    try {
      return Uint8Array.from(Buffer.from(raw.replace(/\s/g, ""), "base64"));
    } catch {
      return null;
    }
  }
  try {
    const target = path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
    return new Uint8Array(readFileSync(target));
  } catch {
    return null;
  }
}

export function coverClientName(
  confirmations: Array<{ fieldKey: string; confirmedValue: string | null }>,
  email: string | null,
): string {
  const name = confirmations.find((field) => field.fieldKey === "full_name" && field.confirmedValue?.trim());
  if (name?.confirmedValue) return name.confirmedValue.trim();
  if (email?.trim()) return email.trim();
  return "Client";
}

export function coverDocuments(
  documents: Array<{ id: string; filename: string }>,
  sourcePages: Array<{ documentId: string }>,
  translatedCounts?: Map<string, number>,
): CoverDocument[] {
  return documents.map((document) => {
    const source = sourcePages.filter((page) => page.documentId === document.id).length;
    const translated = translatedCounts?.get(document.id) ?? source;
    return { name: document.filename, sourcePages: source, translatedPages: translated };
  });
}

export function formatCoverDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) return iso.trim() || iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function resolveCover(input: RenderInput): ResolvedCover {
  const sourceLanguage = input.sourceLanguage || "the source language";
  const targetLanguage = input.targetLanguage?.trim() || "en";
  const sourceLabel = languageLabel(sourceLanguage);
  const targetLabel = languageLabel(targetLanguage);
  const documents =
    input.documents && input.documents.length > 0
      ? input.documents
      : [{ name: "Document", sourcePages: input.pages.length, translatedPages: input.pages.length }];
  const sourceTotal = documents.reduce((sum, document) => sum + document.sourcePages, 0);
  const translatedTotal = documents.reduce((sum, document) => sum + document.translatedPages, 0);
  const translatorName = coverTranslatorName(input.translatorName);
  const pair = `${sourceLabel} to ${targetLabel}`;
  const documentLabel = documents.length === 1 ? "1 document" : `${documents.length} documents`;
  const pageLabel = sourceTotal === 1 ? "1 page" : `${sourceTotal} pages`;
  return {
    orderId: input.orderId,
    issued: formatCoverDate(input.date),
    clientName: input.clientName?.trim() || "Client",
    sourceLanguage: sourceLabel,
    targetLanguage: targetLabel,
    pair,
    summary: `${pair} · ${documentLabel} · ${pageLabel}`,
    statement: `I, ${translatorName}, certify that I am competent to translate from ${sourceLabel} into ${targetLabel}, and that the attached ${targetLabel} translation of the documents listed above is complete and accurate to the best of my knowledge and ability.`,
    documents,
    sourceTotal,
    translatedTotal,
    translatorName,
    signature: input.signature?.byteLength ? input.signature : null,
    pageCount: input.pages.length + 1,
  };
}

export function drawFinalFooter(
  page: PDFPage,
  font: PDFFont,
  input: { orderId: string; pageNumber: number; pageCount: number; width: number },
): void {
  const margin = Math.min(48, input.width * 0.08);
  const y = 28;
  const size = 7.5;
  page.drawLine({
    start: { x: margin, y: y + 14 },
    end: { x: input.width - margin, y: y + 14 },
    thickness: 0.6,
    color: LINE,
  });
  const left = `CredPronto · ${COVER_ADDRESS}`;
  const right = `Order ${input.orderId} · Page ${input.pageNumber} of ${input.pageCount}`;
  page.drawText(left, { x: margin, y, size, font, color: MUTED });
  const rightWidth = font.widthOfTextAtSize(right, size);
  page.drawText(right, { x: Math.max(margin, input.width - margin - rightWidth), y, size, font, color: MUTED });
}

export async function drawCertificationPage(doc: PDFDocument, input: RenderInput): Promise<void> {
  const cover = resolveCover(input);
  const sample = [
    cover.clientName,
    cover.statement,
    cover.summary,
    cover.translatorName,
    ...cover.documents.map((document) => document.name),
    COVER_ADDRESS,
  ].join("\n");
  const faces = await embedFaces(doc, sample);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const signature = await embedSignature(doc, cover.signature);
  drawHeader(page, faces, cover);
  let y = PAGE_H - 96;
  y = drawTitle(page, faces, cover, y);
  y = drawSummary(page, faces, cover, y);
  y = drawOrderBox(page, faces, cover, y);
  y = drawTable(page, faces, cover, y);
  y = drawStatement(page, faces, cover, y);
  drawSignature(page, faces, cover, signature, y);
  drawFinalFooter(page, faces.regular, {
    orderId: cover.orderId,
    pageNumber: 1,
    pageCount: cover.pageCount,
    width: PAGE_W,
  });
}

async function embedFaces(doc: PDFDocument, sample: string): Promise<Faces> {
  doc.registerFontkit(stableFontkit());
  const ids = new Set<FontFaceId>(["regular", "italic"]);
  for (const char of Array.from(sample)) {
    const codePoint = char.codePointAt(0) ?? 0;
    const upright = faceForCodePoint(codePoint, false);
    if (upright) ids.add(upright.id);
    const oblique = faceForCodePoint(codePoint, true);
    if (oblique?.italic) ids.add(oblique.id);
  }
  const ready = new Map<FontFaceId, ReadyFace>();
  for (const id of ids) {
    const face: FontFace = fontFace(id);
    const pdf = await doc.embedFont(face.bytes, { subset: true });
    ready.set(id, { pdf, has: (codePoint) => face.hasGlyph(codePoint), italic: face.italic });
  }
  const regular = ready.get("regular")?.pdf;
  if (!regular) throw new Error("Cover font did not embed");
  const uprightOrder: FontFaceId[] = ["regular", "symbols", "cjk-sc", "cjk-jp", "cjk-kr"];
  return {
    regular,
    italic: ready.get("italic") ?? null,
    upright: uprightOrder.flatMap((id) => {
      const face = ready.get(id);
      return face ? [face] : [];
    }),
  };
}

async function embedSignature(doc: PDFDocument, bytes: Uint8Array | null): Promise<PDFImage | null> {
  if (!bytes?.byteLength) return null;
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await doc.embedJpg(bytes);
    return await doc.embedPng(bytes);
  } catch {
    try {
      return await doc.embedJpg(bytes);
    } catch {
      return null;
    }
  }
}

function fontFor(char: string, italic: boolean, faces: Faces): PDFFont | null {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint < 32) return null;
  if (italic && faces.italic?.has(codePoint)) return faces.italic.pdf;
  for (const face of faces.upright) {
    if (face.has(codePoint)) return face.pdf;
  }
  return null;
}

function textWidth(text: string, size: number, italic: boolean, faces: Faces): number {
  let total = 0;
  let buffer = "";
  let font: PDFFont | null = null;
  const flush = () => {
    if (buffer && font) total += font.widthOfTextAtSize(buffer, size);
    buffer = "";
  };
  for (const char of Array.from(text)) {
    const next = fontFor(char, italic, faces);
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
  italic: boolean,
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
    const next = fontFor(char, italic, faces);
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
  italic: boolean,
  width: number,
  faces: Faces,
): number {
  const lines = wrapLines(text, (line) => textWidth(line, size, italic, faces), width);
  const lineHeight = size * 1.35;
  for (const line of lines) {
    drawText(page, line, x, y, size, color, italic, faces);
    y -= lineHeight;
  }
  return y;
}

function drawHeader(page: PDFPage, faces: Faces, cover: ResolvedCover): void {
  const top = PAGE_H - 46;
  page.drawRectangle({ x: MARGIN_X, y: top - 2, width: 16, height: 16, color: BLUE });
  page.drawLine({ start: { x: MARGIN_X + 5, y: top + 10 }, end: { x: MARGIN_X + 12, y: top + 10 }, thickness: 1.4, color: WHITE });
  page.drawLine({ start: { x: MARGIN_X + 12, y: top + 10 }, end: { x: MARGIN_X + 12, y: top + 2 }, thickness: 1.4, color: WHITE });
  page.drawLine({ start: { x: MARGIN_X + 5, y: top + 2 }, end: { x: MARGIN_X + 12, y: top + 2 }, thickness: 1.4, color: WHITE });
  drawText(page, "CredPronto", MARGIN_X + 22, top + 2, 13, INK, false, faces);

  const right = PAGE_W - MARGIN_X;
  const lines = [`Order ${cover.orderId}`, "Certified translation", `Issued ${cover.issued}`];
  let y = top + 8;
  for (const line of lines) {
    const size = 8;
    const width = textWidth(line, size, false, faces);
    drawText(page, line, right - width, y, size, MUTED, false, faces);
    y -= 11;
  }
  page.drawLine({
    start: { x: MARGIN_X, y: top - 16 },
    end: { x: right, y: top - 16 },
    thickness: 1.5,
    color: INK,
  });
}

function drawTitle(page: PDFPage, faces: Faces, cover: ResolvedCover, y: number): number {
  drawText(page, "Certificate of Translation Accuracy", MARGIN_X, y, 16, INK, false, faces);
  y -= 18;
  y = drawWrapped(page, `Prepared for ${cover.clientName}`, MARGIN_X, y, 10, MUTED, false, CONTENT_W, faces);
  return y - 8;
}

function drawSummary(page: PDFPage, faces: Faces, cover: ResolvedCover, y: number): number {
  const height = 46;
  const bottom = y - height;
  page.drawRectangle({
    x: MARGIN_X,
    y: bottom,
    width: CONTENT_W,
    height,
    color: BLUE_LIGHT,
    borderColor: BLUE_LINE,
    borderWidth: 1,
  });
  drawText(page, "CERTIFIED TRANSLATION", MARGIN_X + 12, bottom + 28, 8, BLUE, false, faces);
  drawText(page, cover.summary, MARGIN_X + 12, bottom + 12, 12, INK, false, faces);
  return bottom - 12;
}

function drawOrderBox(page: PDFPage, faces: Faces, cover: ResolvedCover, y: number): number {
  const rows = [
    ["Order number", cover.orderId],
    ["Date", cover.issued],
    ["Client", cover.clientName],
    ["Language pair", cover.pair],
  ] as const;
  const header = 18;
  const rowHeight = 15;
  const height = header + 10 + rows.length * rowHeight;
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
  drawText(page, "ORDER", MARGIN_X + 10, y - 13, 8, INK, false, faces);
  let rowY = y - header - 16;
  for (const [label, value] of rows) {
    drawText(page, label, MARGIN_X + 10, rowY, 9, MUTED, false, faces);
    const clipped = clip(value, 300, 9, faces);
    drawText(page, clipped, MARGIN_X + 120, rowY, 9, INK, false, faces);
    rowY -= rowHeight;
  }
  return bottom - 12;
}

function drawTable(page: PDFPage, faces: Faces, cover: ResolvedCover, y: number): number {
  const signatureFloor = 148;
  const header = 16;
  const natural = 14;
  const room = y - signatureFloor - header - natural;
  const rowHeight = Math.max(11, Math.min(natural, room / Math.max(cover.documents.length, 1)));
  const height = header + rowHeight * (cover.documents.length + 1);
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
  const columns = [MARGIN_X + 8, MARGIN_X + 28, MARGIN_X + CONTENT_W - 168, MARGIN_X + CONTENT_W - 78];
  const nameWidth = (columns[2] ?? 0) - (columns[1] ?? 0) - 10;
  drawText(page, "#", columns[0] ?? MARGIN_X, y - 11, 7, MUTED, false, faces);
  drawText(page, "DOCUMENT", columns[1] ?? MARGIN_X, y - 11, 7, MUTED, false, faces);
  drawRight(page, "SOURCE PAGES", (columns[3] ?? PAGE_W) - 16, y - 11, 7, MUTED, faces, columns[2] ?? 0);
  drawRight(page, "TRANSLATED PAGES", PAGE_W - MARGIN_X - 8, y - 11, 7, MUTED, faces, (columns[3] ?? 0) - 4);
  let rowY = y - header - rowHeight + 4;
  cover.documents.forEach((document, index) => {
    drawText(page, String(index + 1), columns[0] ?? MARGIN_X, rowY, 8, INK, false, faces);
    drawText(page, clip(document.name, nameWidth, 8, faces), columns[1] ?? MARGIN_X, rowY, 8, INK, false, faces);
    drawRight(page, String(document.sourcePages), (columns[3] ?? PAGE_W) - 28, rowY, 8, INK, faces, columns[2] ?? 0);
    drawRight(page, String(document.translatedPages), PAGE_W - MARGIN_X - 8, rowY, 8, INK, faces, columns[3] ?? 0);
    page.drawLine({
      start: { x: MARGIN_X, y: rowY - 4 },
      end: { x: MARGIN_X + CONTENT_W, y: rowY - 4 },
      thickness: 0.4,
      color: LINE,
    });
    rowY -= rowHeight;
  });
  page.drawLine({
    start: { x: MARGIN_X, y: rowY + rowHeight - 4 },
    end: { x: MARGIN_X + CONTENT_W, y: rowY + rowHeight - 4 },
    thickness: 1.2,
    color: INK,
  });
  drawText(page, "Total", columns[1] ?? MARGIN_X, rowY, 8, INK, false, faces);
  drawRight(page, String(cover.sourceTotal), (columns[3] ?? PAGE_W) - 28, rowY, 8, INK, faces, columns[2] ?? 0);
  drawRight(page, String(cover.translatedTotal), PAGE_W - MARGIN_X - 8, rowY, 8, INK, faces, columns[3] ?? 0);
  return bottom - 12;
}

function drawStatement(page: PDFPage, faces: Faces, cover: ResolvedCover, y: number): number {
  const inner = 10;
  const textWidthLimit = CONTENT_W - inner * 2;
  const lines = wrapLines(cover.statement, (line) => textWidth(line, 9, false, faces), textWidthLimit);
  const header = 16;
  const height = header + 8 + lines.length * 12 + 6;
  const bottom = Math.max(118, y - height);
  page.drawRectangle({
    x: MARGIN_X,
    y: bottom,
    width: CONTENT_W,
    height: y - bottom,
    borderColor: LINE,
    borderWidth: 1,
    color: WHITE,
  });
  page.drawRectangle({ x: MARGIN_X, y: y - header, width: CONTENT_W, height: header, color: SOFT });
  drawText(page, "CERTIFICATION", MARGIN_X + 10, y - 11, 8, INK, false, faces);
  let lineY = y - header - 14;
  for (const line of lines) {
    if (lineY < bottom + 6) break;
    drawText(page, line, MARGIN_X + inner, lineY, 9, INK, false, faces);
    lineY -= 12;
  }
  return bottom - 16;
}

function drawSignature(
  page: PDFPage,
  faces: Faces,
  cover: ResolvedCover,
  signature: PDFImage | null,
  y: number,
): void {
  const floor = 64;
  const top = Math.max(floor + 36, Math.min(y, 130));
  const gap = 24;
  const leftWidth = CONTENT_W * 0.58;
  const rightX = MARGIN_X + leftWidth + gap;
  const lineY = top - 26;
  if (signature) {
    const maxWidth = leftWidth - 8;
    const maxHeight = 22;
    const scale = Math.min(maxWidth / signature.width, maxHeight / signature.height, 1);
    const width = signature.width * scale;
    const height = signature.height * scale;
    page.drawImage(signature, { x: MARGIN_X, y: lineY + 3, width, height });
  } else {
    drawText(page, cover.translatorName, MARGIN_X, lineY + 6, 11, MUTED, true, faces);
  }
  page.drawLine({
    start: { x: MARGIN_X, y: lineY },
    end: { x: MARGIN_X + leftWidth, y: lineY },
    thickness: 0.8,
    color: INK,
  });
  drawWrapped(
    page,
    `${cover.translatorName}, Certified Translator, CredPronto`,
    MARGIN_X,
    lineY - 12,
    8,
    MUTED,
    false,
    leftWidth,
    faces,
  );

  drawText(page, cover.issued, rightX, lineY + 6, 10, INK, false, faces);
  page.drawLine({
    start: { x: rightX, y: lineY },
    end: { x: PAGE_W - MARGIN_X, y: lineY },
    thickness: 0.8,
    color: INK,
  });
  drawText(page, "Date", rightX, lineY - 12, 8, MUTED, false, faces);
}

function drawRight(
  page: PDFPage,
  text: string,
  right: number,
  y: number,
  size: number,
  color: ReturnType<typeof rgb>,
  faces: Faces,
  minX: number,
): void {
  const width = textWidth(text, size, false, faces);
  drawText(page, text, Math.max(minX, right - width), y, size, color, false, faces);
}

function clip(text: string, max: number, size: number, faces: Faces): string {
  if (textWidth(text, size, false, faces) <= max) return text;
  let clipped = text;
  while (clipped.length > 1 && textWidth(`${clipped}…`, size, false, faces) > max) {
    clipped = Array.from(clipped).slice(0, -1).join("");
  }
  return `${clipped}…`;
}
