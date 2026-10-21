import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { degrees } from "pdf-lib";
import { PREVIEW_WATERMARK, PREVIEW_WATERMARK_OPACITY, previewWatermarkRgb } from "../constants";
import { documentKind, planDocument, type PlanRect, type PlanStyle, type PlanText } from "./document-layout";
import { faceForCodePoint, fontFace, serifFace, stableFontkit, type FontFace, type FontFaceId } from "./font";
import {
  assertContiguousPages,
  pageSize,
  translationRenderPasses,
  wrapLines,
  type RenderBlock,
  type RenderInput,
  type RenderPage,
} from "./layout";
import { drawCertificationPage, drawFinalFooter } from "./cover";
import { applyCredProntoPdfMetadata } from "./metadata";
import { blocksToParagraphs, finalizeBlocks, structurePage } from "./structure";

export type { RenderInput, RenderPage } from "./layout";

export type RenderedFiles = {
  cleanTranslation: Uint8Array;
  watermarkedPreview: Uint8Array;
  certification: Uint8Array;
};

const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.38, 0.4, 0.45);

type ReadyFace = {
  id: FontFaceId;
  pdf: PDFFont;
  has: (codePoint: number) => boolean;
  italic: boolean;
};

type Paint = {
  text: string;
  x: number;
  y: number;
  size: number;
  color: ReturnType<typeof rgb>;
  italic: boolean;
};

function blocksFor(page: RenderPage): RenderBlock[] {
  if (page.blocks?.length) return finalizeBlocks(page.blocks);
  const text = page.paragraphs.join("\n");
  return text.trim() ? structurePage(text) : [{ type: "paragraph", text: " " }];
}

function noteText(block: RenderBlock): string | null {
  if (block.type === "seal") return `[Seal: ${block.text}]`;
  if (block.type === "signature") return block.electronic ? "[Electronic signature]" : "[Signature]";
  if (block.type === "note") return block.text;
  return null;
}

function blockText(blocks: RenderBlock[]): string {
  return blocksToParagraphs(blocks).join("\n");
}

async function embedFaces(doc: PDFDocument, blocks: RenderBlock[]): Promise<{ upright: ReadyFace[]; italic: ReadyFace | null; regular: PDFFont }> {
  doc.registerFontkit(stableFontkit());
  const sample = `${blockText(blocks)}\n${PREVIEW_WATERMARK}\nPage 1 of 1`;
  const ids = new Set<FontFaceId>(["regular"]);
  let italic = false;
  for (const block of blocks) {
    if (noteText(block)) italic = true;
  }
  for (const char of Array.from(sample)) {
    const codePoint = char.codePointAt(0) ?? 0;
    const face = faceForCodePoint(codePoint, false);
    if (face) ids.add(face.id);
    if (italic) {
      const oblique = faceForCodePoint(codePoint, true);
      if (oblique?.italic) ids.add(oblique.id);
    }
  }

  const ready = new Map<FontFaceId, ReadyFace>();
  for (const id of ids) {
    const face: FontFace = fontFace(id);
    const pdf = await doc.embedFont(face.bytes, { subset: true });
    ready.set(id, { id, pdf, has: (codePoint) => face.hasGlyph(codePoint), italic: face.italic });
  }
  const uprightOrder: FontFaceId[] = ["regular", "symbols", "cjk-sc", "cjk-jp", "cjk-kr"];
  const upright = uprightOrder.flatMap((id) => {
    const face = ready.get(id);
    return face ? [face] : [];
  });
  const regular = ready.get("regular")?.pdf;
  if (!regular) throw new Error("Body font did not embed");
  return { upright, italic: ready.get("italic") ?? null, regular };
}

function fontFor(char: string, italic: boolean, upright: ReadyFace[], italicFace: ReadyFace | null): PDFFont | null {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint < 32) return null;
  if (italic && italicFace?.has(codePoint)) return italicFace.pdf;
  for (const face of upright) {
    if (face.has(codePoint)) return face.pdf;
  }
  return null;
}

function widthOf(text: string, size: number, italic: boolean, upright: ReadyFace[], italicFace: ReadyFace | null): number {
  let total = 0;
  let buffer = "";
  let font: PDFFont | null = null;
  const flush = () => {
    if (buffer && font) total += font.widthOfTextAtSize(buffer, size);
    buffer = "";
  };
  for (const char of Array.from(text)) {
    const next = fontFor(char, italic, upright, italicFace);
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

function drawStyled(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  color: ReturnType<typeof rgb>,
  italic: boolean,
  upright: ReadyFace[],
  italicFace: ReadyFace | null,
): void {
  let cursor = x;
  let buffer = "";
  let font: PDFFont | null = null;
  const flush = () => {
    if (!buffer || !font) return;
    page.drawText(buffer, { x: cursor, y, size, font, color });
    cursor += font.widthOfTextAtSize(buffer, size);
    buffer = "";
  };
  for (const char of Array.from(text)) {
    const next = fontFor(char, italic, upright, italicFace);
    if (!next) continue;
    if (next !== font) {
      flush();
      font = next;
    }
    buffer += char;
  }
  flush();
}

function layoutBlocks(
  blocks: RenderBlock[],
  upright: ReadyFace[],
  italicFace: ReadyFace | null,
  size: number,
  margin: number,
  maxWidth: number,
  top: number,
): { paints: Paint[]; bottom: number } {
  const labelWidth = Math.min(220, maxWidth * 0.44);
  const columnGap = 14;
  const valueWidth = Math.max(40, maxWidth - labelWidth - columnGap);
  const measure = (text: string, fontSize: number, italic: boolean) => widthOf(text, fontSize, italic, upright, italicFace);
  const paints: Paint[] = [];
  let y = top;

  const paintLines = (text: string, x: number, fontSize: number, color: ReturnType<typeof rgb>, italic: boolean, width: number) => {
    const lines = wrapLines(text, (line) => measure(line, fontSize, italic), width);
    const lineHeight = fontSize * 1.3;
    for (const line of lines) {
      paints.push({ text: line, x, y, size: fontSize, color, italic });
      y -= lineHeight;
    }
    return lineHeight;
  };

  for (const block of blocks) {
    const noted = noteText(block);
    if (block.type === "heading") {
      const fontSize = block.level === 2 ? size + 0.5 : size + 2.5;
      paintLines(block.text, margin, fontSize, INK, false, maxWidth);
      y -= 3;
    } else if (block.type === "paragraph") {
      paintLines(block.text, margin, size, INK, false, maxWidth);
      y -= 5;
    } else if (noted) {
      paintLines(noted, margin, Math.max(8, size - 0.5), MUTED, true, maxWidth);
      y -= 5;
    } else if (block.type === "fields") {
      const labelSize = Math.max(7.5, size - 1);
      const valueSize = size;
      const lineHeight = Math.max(labelSize, valueSize) * 1.28;
      for (const row of block.rows) {
        const labels = wrapLines(row.label, (line) => measure(line, labelSize, false), labelWidth);
        const values = wrapLines(row.value || " ", (line) => measure(line, valueSize, false), valueWidth);
        const count = Math.max(labels.length, values.length, 1);
        for (let index = 0; index < count; index += 1) {
          const label = labels[index];
          const value = row.value ? values[index] : undefined;
          if (label) paints.push({ text: label, x: margin, y, size: labelSize, color: MUTED, italic: false });
          if (value) paints.push({ text: value, x: margin + labelWidth + columnGap, y, size: valueSize, color: INK, italic: false });
          y -= lineHeight;
        }
        y -= 1;
      }
      y -= 3;
    }
  }

  return { paints, bottom: y };
}

type SerifFaces = {
  regular: PDFFont;
  bold: PDFFont;
  regularFace: FontFace;
  boldFace: FontFace;
};

function roundedPath(width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  return [
    `M ${r} 0`,
    `H ${width - r}`,
    `A ${r} ${r} 0 0 1 ${width} ${r}`,
    `V ${height - r}`,
    `A ${r} ${r} 0 0 1 ${width - r} ${height}`,
    `H ${r}`,
    `A ${r} ${r} 0 0 1 0 ${height - r}`,
    `V ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    `Z`,
  ].join(" ");
}

function drawRounded(page: PDFPage, rect: PlanRect): void {
  page.drawSvgPath(roundedPath(rect.w, rect.h, rect.radius), {
    x: rect.x,
    y: rect.y + rect.h,
    borderColor: INK,
    borderWidth: rect.stroke,
  });
}

async function embedSerif(doc: PDFDocument): Promise<SerifFaces> {
  const regularFace = serifFace(false);
  const boldFace = serifFace(true);
  return {
    regularFace,
    boldFace,
    regular: await doc.embedFont(regularFace.bytes, { subset: true }),
    bold: await doc.embedFont(boldFace.bytes, { subset: true }),
  };
}

function serifFontFor(
  char: string,
  bold: boolean,
  serif: SerifFaces | null,
  upright: ReadyFace[],
  italicFace: ReadyFace | null,
): PDFFont | null {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint < 32) return null;
  if (serif) {
    const face = bold ? serif.boldFace : serif.regularFace;
    if (face.hasGlyph(codePoint)) return bold ? serif.bold : serif.regular;
  }
  return fontFor(char, false, upright, italicFace);
}

function widthPlanned(
  text: string,
  size: number,
  style: PlanStyle,
  serif: SerifFaces | null,
  upright: ReadyFace[],
  italicFace: ReadyFace | null,
): number {
  if (!style.serif) return widthOf(text, size, Boolean(style.italic), upright, italicFace);
  let total = 0;
  let buffer = "";
  let font: PDFFont | null = null;
  const flush = () => {
    if (buffer && font) total += font.widthOfTextAtSize(buffer, size);
    buffer = "";
  };
  for (const char of Array.from(text)) {
    const next = serifFontFor(char, Boolean(style.bold), serif, upright, italicFace);
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

function drawRun(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  color: ReturnType<typeof rgb>,
  fontForChar: (char: string) => PDFFont | null,
): number {
  let cursor = x;
  let buffer = "";
  let font: PDFFont | null = null;
  const flush = () => {
    if (!buffer || !font) return;
    page.drawText(buffer, { x: cursor, y, size, font, color });
    cursor += font.widthOfTextAtSize(buffer, size);
    buffer = "";
  };
  for (const char of Array.from(text)) {
    const next = fontForChar(char);
    if (!next) continue;
    if (next !== font) {
      flush();
      font = next;
    }
    buffer += char;
  }
  flush();
  return cursor - x;
}

function drawPlannedText(
  page: PDFPage,
  item: PlanText,
  serif: SerifFaces | null,
  upright: ReadyFace[],
  italicFace: ReadyFace | null,
): void {
  const color = item.color === "muted" ? MUTED : INK;
  if (item.serif && serif) {
    drawRun(page, item.text, item.x, item.y, item.size, color, (char) => serifFontFor(char, Boolean(item.bold), serif, upright, italicFace));
  } else {
    drawStyled(page, item.text, item.x, item.y, item.size, color, false, upright, italicFace);
    if (item.bold) drawStyled(page, item.text, item.x + 0.28, item.y, item.size, color, false, upright, italicFace);
  }
  if (!item.underline) return;
  const width = widthPlanned(item.text, item.size, item, serif, upright, italicFace);
  page.drawLine({
    start: { x: item.x, y: item.y - 1.4 },
    end: { x: item.x + width, y: item.y - 1.4 },
    thickness: 0.6,
    color,
  });
}

function drawWatermark(page: PDFPage, font: PDFFont, width: number, height: number): void {
  const size = 18;
  const color = previewWatermarkRgb();
  for (let y = -height; y < height * 2; y += 78) {
    for (let x = -width; x < width * 2; x += 390) {
      page.drawText(PREVIEW_WATERMARK, {
        x,
        y,
        size,
        font,
        color: rgb(color.r, color.g, color.b),
        opacity: PREVIEW_WATERMARK_OPACITY,
        rotate: degrees(45),
      });
    }
  }
}

function drawBody(
  page: PDFPage,
  faces: { upright: ReadyFace[]; italic: ReadyFace | null; regular: PDFFont },
  pageSpec: RenderPage,
  options: {
    orderId: string;
    translationPages: number;
    certified: boolean;
    serif: SerifFaces | null;
    image: PDFImage | null;
  },
): void {
  const { widthPt, heightPt } = pageSize(pageSpec);
  const margin = Math.min(48, widthPt * 0.08, heightPt * 0.08);
  const maxWidth = Math.max(40, widthPt - margin * 2);
  const blocks = blocksFor(pageSpec);
  const footer = options.certified ? 48 : Math.max(28, margin * 0.7);
  const kind = documentKind({ ...pageSpec, blocks });
  if (kind) {
    const measure = (text: string, size: number, style: PlanStyle) =>
      widthPlanned(text, size, style, options.serif, faces.upright, faces.italic);
    const hasPhoto = Boolean(options.image);
    let size = 12;
    let plan = planDocument({ kind, blocks, width: widthPt, height: heightPt, footer, size, measure, hasPhoto });
    while (plan.overflow && size > 10) {
      size -= 0.5;
      plan = planDocument({ kind, blocks, width: widthPt, height: heightPt, footer, size, measure, hasPhoto });
    }
    if (plan.frame) drawRounded(page, plan.frame);
    for (const box of plan.boxes) drawRounded(page, box);
    if (plan.image && options.image) {
      page.drawImage(options.image, {
        x: plan.image.x,
        y: plan.image.y,
        width: plan.image.w,
        height: plan.image.h,
      });
    }
    for (const item of plan.texts) {
      if (item.y < 12) continue;
      drawPlannedText(page, item, options.serif, faces.upright, faces.italic);
    }
  } else {
    let chosen: Paint[] = [];
    let size = 11;
    while (size >= 8) {
      const top = heightPt - margin - size;
      const laid = layoutBlocks(blocks, faces.upright, faces.italic, size, margin, maxWidth, top);
      chosen = laid.paints;
      if (laid.bottom >= footer || size === 8) break;
      size -= 0.5;
    }
    for (const paint of chosen) {
      if (paint.y < 12) continue;
      drawStyled(page, paint.text, paint.x, paint.y, paint.size, paint.color, paint.italic, faces.upright, faces.italic);
    }
  }

  if (options.certified) {
    drawFinalFooter(page, faces.regular, {
      orderId: options.orderId,
      pageNumber: pageSpec.combinedPageNumber + 1,
      pageCount: options.translationPages + 1,
      width: widthPt,
    });
    return;
  }
  page.drawText(`Page ${pageSpec.combinedPageNumber} of ${options.translationPages}`, {
    x: margin,
    y: Math.max(16, margin / 2),
    size: 8,
    font: faces.regular,
    color: MUTED,
  });
}

async function renderTranslationPdf(input: RenderInput, watermark: boolean): Promise<Uint8Array> {
  assertContiguousPages(input.pages);
  const ordered = [...input.pages].sort((a, b) => a.combinedPageNumber - b.combinedPageNumber);
  const doc = await PDFDocument.create();
  const pageBlocks = ordered.map((page) => blocksFor(page));
  const faces = await embedFaces(doc, pageBlocks.flat());
  const needsSerif = ordered.some((page, index) => documentKind({ ...page, blocks: pageBlocks[index] }) === "certificate");
  const serif = needsSerif ? await embedSerif(doc) : null;
  const images = new Map<number, PDFImage>();
  for (let index = 0; index < ordered.length; index += 1) {
    const png = ordered[index]?.photoPng;
    if (!png?.byteLength) continue;
    try {
      images.set(index, await doc.embedPng(png));
    } catch {
      images.delete(index);
    }
  }

  ordered.forEach((pageSpec, index) => {
    const { widthPt, heightPt } = pageSize(pageSpec);
    const page = doc.addPage([widthPt, heightPt]);
    const pageFaces = faces;
    drawBody(page, pageFaces, { ...pageSpec, blocks: pageBlocks[index] }, {
      orderId: input.orderId,
      translationPages: ordered.length,
      certified: !watermark,
      serif,
      image: images.get(index) ?? null,
    });
    if (watermark) drawWatermark(page, faces.regular, widthPt, heightPt);
  });

  applyCredProntoPdfMetadata(doc);
  return doc.save();
}

export async function renderCertificationPdf(input: RenderInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  await drawCertificationPage(doc, input);
  applyCredProntoPdfMetadata(doc);
  return doc.save();
}

/** Swap page 1 of a certified final for a newly drawn cover. Later pages stay. */
export async function replaceCoverPage(cleanPdf: Uint8Array, cover: Uint8Array): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  const coverDoc = await PDFDocument.load(cover);
  const bodyDoc = await PDFDocument.load(cleanPdf);
  const bodyIndices = bodyDoc.getPageIndices().slice(bodyDoc.getPageCount() > 1 ? 1 : bodyDoc.getPageCount());
  const pages = [
    ...(await merged.copyPages(coverDoc, [0])),
    ...(await merged.copyPages(bodyDoc, bodyIndices)),
  ];
  for (const page of pages) merged.addPage(page);
  applyCredProntoPdfMetadata(merged);
  return merged.save();
}

/**
 * Clean translation, watermarked preview, and certification are three renders.
 * The preview is produced by its own pass with the watermark drawn into the
 * page content. It is not a copy of the clean file.
 */
async function prependPdf(cover: Uint8Array, body: Uint8Array): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  const coverDoc = await PDFDocument.load(cover);
  const bodyDoc = await PDFDocument.load(body);
  const pages = [
    ...(await merged.copyPages(coverDoc, coverDoc.getPageIndices())),
    ...(await merged.copyPages(bodyDoc, bodyDoc.getPageIndices())),
  ];
  for (const page of pages) merged.addPage(page);
  applyCredProntoPdfMetadata(merged);
  return merged.save();
}

export async function renderOrderPdfs(input: RenderInput): Promise<RenderedFiles> {
  const [cleanPass, previewPass] = translationRenderPasses();
  const certification = await renderCertificationPdf(input);
  const cleanBody = await renderTranslationPdf(input, cleanPass.watermark);
  const cleanTranslation = cleanPass.includeCertification ? await prependPdf(certification, cleanBody) : cleanBody;
  const watermarkedPreview = await renderTranslationPdf(input, previewPass.watermark);
  return { cleanTranslation, watermarkedPreview, certification };
}
