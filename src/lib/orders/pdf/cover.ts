import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { BRAND_ADDRESS, BRAND_FOOTER, BRAND_LOCALITY, BRAND_SIGNER, BRAND_STREET } from "../brand";
import { languageLabel } from "../languages";
import { faceForCodePoint, fontFace, stableFontkit, type FontFace, type FontFaceId } from "./font";
import { wrapLines, type CoverDocument, type RenderInput } from "./layout";
import { loadTintedOwnerSignature, ownerSignatureBlockHeight, SIGN_ROLE_TRANSLATOR, signOffLayout } from "./signature";

export const COVER_ADDRESS_LINES = [BRAND_STREET, BRAND_LOCALITY] as const;
export const COVER_ADDRESS = BRAND_ADDRESS;
export const COVER_FOOTER = BRAND_FOOTER;
const ATA_LOGO_PATH = path.join(process.cwd(), "src/lib/orders/pdf/ata-logo.png");
const BRAND_LOGO_PATH = path.join(process.cwd(), "src/lib/orders/pdf/credpronto-logo.png");

/** Printed word for word. Do not edit, shorten, or interpolate this statement. */
export const CERTIFICATION_STATEMENTS = [
  "As an authorized representative of CredPronto, a professional translation services agency, I hereby certify that the above-mentioned document has been translated by an experienced, qualified and competent professional translator, fluent in the above-mentioned language pair and that, in my best judgment, the translated text truly reflects the content, meaning, and style of the original text and constitutes in every respect a complete and accurate translation of the original document. This document has not been translated for a family member, friend, or business associate.",
  "This is to certify the correctness of the translation only. I do not make any claims or guarantees about the authenticity or content of the original document. Further, CredPronto assumes no liability for the way in which the translation is used by the customer or any third party, including end-users of the translation.",
] as const;

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
  statements: readonly string[];
  documents: CoverDocument[];
  sourceTotal: number;
  translatedTotal: number;
  /** Detected page count from the order. Null when the cover should keep the source-page total only. */
  pricedPages: number | null;
  /** Stored credential count. Null on a translation that has no evaluation. */
  degreeCount: number | null;
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

export const COVER_FALLBACK_SIGNER = BRAND_SIGNER;

/**
 * Kept for callers. A staff name, a configured translator, or an email is never printed.
 * The cover draws the owner signature and the Certified Translator role instead.
 */
export function coverTranslatorName(approverName?: string | null, configuredName?: string | null): string {
  void approverName;
  void configuredName;
  return COVER_FALLBACK_SIGNER;
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

export function loadAtaLogo(): Uint8Array {
  return new Uint8Array(readFileSync(ATA_LOGO_PATH));
}

export function loadBrandLogo(): Uint8Array {
  return new Uint8Array(readFileSync(BRAND_LOGO_PATH));
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

function foldDocumentText(value: string): string {
  return value
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i");
}

function isCaptureFilename(filename: string): boolean {
  const base = filename.trim().split(/[/\\]/).pop() ?? filename.trim();
  return /screenshot|whatsapp|^img[_-]?\d|^dsc[_-]?\d|^pxl[_-]?\d|^scan[_-]?\d|^photo[_-]?\d|^image[_-]?\d|^camera/i.test(base);
}

/** Document type printed on the cover. A capture filename is never shown as the name. */
export function documentDisplayName(filename: string, text: string): string {
  const hay = foldDocumentText(text);
  if (/出生医学证明|medical certificate of birth/.test(hay)) return "Medical Certificate of Birth";
  if (/avukatlik ruhsat|attorney at law license|attorney's license|attorneys license|barolar birligi/.test(hay)) {
    return "Attorney at Law License";
  }
  if (/atama islemi|appointment procedure|bas hukuk musaviri|chief legal counsel/.test(hay)) return "Appointment Letter";
  if (/acta de nacimiento|\bbirth certificate\b/.test(hay)) return "Birth Certificate";
  if (isCaptureFilename(filename)) return "Document";
  const trimmed = filename.trim();
  return trimmed || "Document";
}

export function coverDocuments(
  documents: Array<{ id: string; filename: string }>,
  sourcePages: Array<{ documentId: string; ocrText?: string | null }>,
  translatedCounts?: Map<string, number>,
  translatedText?: Map<string, string>,
): CoverDocument[] {
  return documents.map((document) => {
    const pages = sourcePages.filter((page) => page.documentId === document.id);
    const source = pages.length;
    const translated = translatedCounts?.get(document.id) ?? source;
    const ocr = pages.map((page) => page.ocrText ?? "").join("\n");
    const extra = translatedText?.get(document.id) ?? "";
    return {
      name: documentDisplayName(document.filename, `${ocr}\n${extra}`),
      sourcePages: source,
      translatedPages: translated,
    };
  });
}

/** First eight characters. Translation-page footers only. */
export function shortOrderNumber(orderId: string): string {
  return orderId.trim().slice(0, 8);
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
  const pricedPages =
    input.pricedPages != null && Number.isInteger(input.pricedPages) && input.pricedPages > 0
      ? input.pricedPages
      : null;
  const degreeCount =
    input.degreeCount != null && Number.isInteger(input.degreeCount) && input.degreeCount > 0
      ? input.degreeCount
      : null;
  const shownPages = pricedPages ?? sourceTotal;
  const pageLabel = shownPages === 1 ? "1 page" : `${shownPages} pages`;
  return {
    orderId: input.orderId,
    issued: formatCoverDate(input.date),
    clientName: input.clientName?.trim() || "Client",
    sourceLanguage: sourceLabel,
    targetLanguage: targetLabel,
    pair,
    summary: `${pair} · ${documentLabel} · ${pageLabel}`,
    statements: CERTIFICATION_STATEMENTS,
    documents,
    sourceTotal,
    translatedTotal,
    pricedPages,
    degreeCount,
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
  const text = `Order ${shortOrderNumber(input.orderId)} · Page ${input.pageNumber} of ${input.pageCount}`;
  const textWidth = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: Math.max(margin, input.width - margin - textWidth),
    y,
    size,
    font,
    color: MUTED,
  });
}

export async function drawCertificationPage(doc: PDFDocument, input: RenderInput): Promise<void> {
  const cover = resolveCover(input);
  const sample = [
    cover.clientName,
    ...cover.statements,
    cover.summary,
    cover.translatorName,
    ...cover.documents.map((document) => document.name),
    COVER_FOOTER,
  ].join("\n");
  const faces = await embedFaces(doc, sample);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const signature = await embedSignature(doc, loadTintedOwnerSignature());
  const brand = await embedSignature(doc, loadBrandLogo());
  const ata = await embedSignature(doc, loadAtaLogo());
  if (!brand) throw new Error("CredPronto logo did not embed");
  if (!ata) throw new Error("ATA logo did not embed");
  if (!signature) throw new Error("Signature did not embed");
  let y = drawHeader(page, faces, cover, brand, ata);
  y = drawTitle(page, faces, cover, y);
  y = drawSummary(page, faces, cover, y);
  y = drawOrderBox(page, faces, cover, y);
  const footerClearance = 50;
  const signatureBlock = ownerSignatureBlockHeight(signature);
  const statementGap = 16;
  let statementSize = 8.5;
  let measured = measureStatements(faces, cover.statements, statementSize);
  let tableFloor = footerClearance + signatureBlock + statementGap + measured.height + 12;
  while (y - tableFloor < 36 && statementSize > 7) {
    statementSize -= 0.25;
    measured = measureStatements(faces, cover.statements, statementSize);
    tableFloor = footerClearance + signatureBlock + statementGap + measured.height + 12;
  }
  y = drawTable(page, faces, cover, y, tableFloor);
  y = drawStatements(page, faces, measured, y);
  drawSignature(page, faces, cover, signature, y - statementGap);
  drawCoverFooter(page, faces, cover);
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

function drawHeader(page: PDFPage, faces: Faces, cover: ResolvedCover, brand: PDFImage, ata: PDFImage): number {
  const contentTop = PAGE_H - 40;
  const brandHeight = 22;
  const brandWidth = brandHeight * (brand.width / brand.height);
  page.drawImage(brand, {
    x: MARGIN_X,
    y: contentTop - brandHeight,
    width: brandWidth,
    height: brandHeight,
  });

  let addressY = contentTop - brandHeight - 14;
  for (const line of COVER_ADDRESS_LINES) {
    drawText(page, line, MARGIN_X, addressY, 8, MUTED, false, faces);
    addressY -= 11;
  }

  const right = PAGE_W - MARGIN_X;
  const ataHeight = 24;
  const ataWidth = ataHeight * (ata.width / ata.height);
  const ataBottom = contentTop - ataHeight;
  page.drawImage(ata, { x: right - ataWidth, y: ataBottom, width: ataWidth, height: ataHeight });

  const lines = [`Order ${cover.orderId}`, "Certified translation", `Issued ${cover.issued}`];
  let y = ataBottom - 14;
  for (const line of lines) {
    const size = 8;
    const width = textWidth(line, size, false, faces);
    drawText(page, line, right - width, y, size, MUTED, false, faces);
    y -= 11;
  }
  const ruleY = Math.min(addressY + 4, y + 4);
  page.drawLine({
    start: { x: MARGIN_X, y: ruleY },
    end: { x: right, y: ruleY },
    thickness: 1.5,
    color: INK,
  });
  return ruleY - 22;
}

function drawCoverFooter(page: PDFPage, faces: Faces, cover: ResolvedCover): void {
  const y = 28;
  page.drawLine({
    start: { x: MARGIN_X, y: y + 14 },
    end: { x: PAGE_W - MARGIN_X, y: y + 14 },
    thickness: 0.6,
    color: LINE,
  });
  const pageLabel = `Order ${cover.orderId} · Page 1 of ${cover.pageCount}`;
  const gap = 16;
  let size = 7.5;
  let brandWidth = textWidth(COVER_FOOTER, size, false, faces);
  let pageWidth = textWidth(pageLabel, size, false, faces);
  while (brandWidth + gap + pageWidth > CONTENT_W && size > 6) {
    size -= 0.25;
    brandWidth = textWidth(COVER_FOOTER, size, false, faces);
    pageWidth = textWidth(pageLabel, size, false, faces);
  }
  drawText(page, COVER_FOOTER, MARGIN_X, y, size, MUTED, false, faces);
  drawText(page, pageLabel, PAGE_W - MARGIN_X - pageWidth, y, size, MUTED, false, faces);
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
  const rows: Array<[string, string]> = [
    ["Order number", cover.orderId],
    ["Date", cover.issued],
    ["Client", cover.clientName],
    ["Language pair", cover.pair],
  ];
  if (cover.pricedPages != null) rows.push(["Pages", String(cover.pricedPages)]);
  if (cover.degreeCount != null) {
    rows.push(["Credentials", cover.degreeCount === 1 ? "1 credential" : `${cover.degreeCount} credentials`]);
  }
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

function drawTable(page: PDFPage, faces: Faces, cover: ResolvedCover, y: number, floor: number): number {
  const header = 16;
  const natural = 14;
  const count = cover.documents.length + 1;
  const maxHeight = Math.max(header + count * 8, y - floor);
  const rowHeight = Math.min(natural, Math.max(8, (maxHeight - header) / count));
  const height = header + rowHeight * count;
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

type MeasuredStatements = {
  size: number;
  lineHeight: number;
  paragraphs: string[][];
  height: number;
};

function measureStatements(faces: Faces, statements: readonly string[], size: number): MeasuredStatements {
  const limit = CONTENT_W - 20;
  const lineHeight = size * 1.55;
  const gap = 6;
  const paragraphs = statements.map((text) => wrapLines(text, (line) => textWidth(line, size, false, faces), limit));
  const textHeight =
    paragraphs.reduce((sum, lines) => sum + lines.length * lineHeight, 0) + gap * Math.max(0, paragraphs.length - 1);
  return { size, lineHeight, paragraphs, height: 16 + 8 + textHeight + 4 };
}

function drawStatements(page: PDFPage, faces: Faces, measured: MeasuredStatements, y: number): number {
  const header = 16;
  const bottom = y - measured.height;
  page.drawRectangle({
    x: MARGIN_X,
    y: bottom,
    width: CONTENT_W,
    height: measured.height,
    borderColor: LINE,
    borderWidth: 1,
    color: WHITE,
  });
  page.drawRectangle({ x: MARGIN_X, y: y - header, width: CONTENT_W, height: header, color: SOFT });
  drawText(page, "CERTIFICATION", MARGIN_X + 10, y - 11, 8, INK, false, faces);
  let lineY = y - header - 14;
  measured.paragraphs.forEach((lines, index) => {
    for (const line of lines) {
      drawText(page, line, MARGIN_X + 10, lineY, measured.size, INK, false, faces);
      lineY -= measured.lineHeight;
    }
    if (index < measured.paragraphs.length - 1) lineY -= 6;
  });
  return bottom;
}

function drawSignature(
  page: PDFPage,
  faces: Faces,
  cover: ResolvedCover,
  signature: PDFImage,
  y: number,
): void {
  const layout = signOffLayout({
    image: signature,
    top: y,
    left: MARGIN_X,
    contentWidth: CONTENT_W,
    pageRight: PAGE_W - MARGIN_X,
  });
  page.drawImage(signature, layout.image);
  page.drawLine({
    start: { x: MARGIN_X, y: layout.lineY },
    end: { x: layout.leftLineEnd, y: layout.lineY },
    thickness: 0.6,
    color: INK,
  });
  drawText(page, SIGN_ROLE_TRANSLATOR, MARGIN_X, layout.roleY, 8, MUTED, false, faces);
  drawText(page, cover.issued, layout.rightX, layout.dateY, 10, INK, false, faces);
  page.drawLine({
    start: { x: layout.rightX, y: layout.lineY },
    end: { x: layout.rightLineEnd, y: layout.lineY },
    thickness: 0.6,
    color: INK,
  });
  drawText(page, "Date", layout.rightX, layout.roleY, 8, MUTED, false, faces);
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
