import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { degrees } from "pdf-lib";
import { PREVIEW_WATERMARK, PREVIEW_WATERMARK_OPACITY, previewWatermarkRgb } from "../constants";
import { faceForCodePoint, fontFace, type FontFace, type FontFaceId } from "./font";
import {
  assertContiguousPages,
  pageSize,
  translationRenderPasses,
  wrapLines,
  type RenderBlock,
  type RenderInput,
  type RenderPage,
} from "./layout";
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
  doc.registerFontkit(fontkit);
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
  pageCount: number,
): void {
  const { widthPt, heightPt } = pageSize(pageSpec);
  const margin = Math.min(48, widthPt * 0.08, heightPt * 0.08);
  const maxWidth = Math.max(40, widthPt - margin * 2);
  const blocks = blocksFor(pageSpec);
  const footer = Math.max(28, margin * 0.7);
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

  page.drawText(`Page ${pageSpec.combinedPageNumber} of ${pageCount}`, {
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

  ordered.forEach((pageSpec, index) => {
    const { widthPt, heightPt } = pageSize(pageSpec);
    const page = doc.addPage([widthPt, heightPt]);
    const pageFaces = faces;
    drawBody(page, pageFaces, { ...pageSpec, blocks: pageBlocks[index] }, ordered.length);
    if (watermark) drawWatermark(page, faces.regular, widthPt, heightPt);
  });

  return doc.save();
}

export async function renderCertificationPdf(input: RenderInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontFace("regular").bytes, { subset: true });
  const page = doc.addPage([612, 792]);
  const lines = [
    "CredPronto",
    "",
    "Translator certification",
    "",
    `Order: ${input.orderId}`,
    `Date: ${input.date}`,
    `Language: ${input.sourceLanguage} to English`,
    "",
    "I certify that this English translation of the document submitted",
    "with the order above was prepared by CredPronto's certified",
    "translation process and, to the best of that process, is complete",
    "and accurate. Names and dates follow the spellings the customer",
    "confirmed.",
    "",
    "Signature: ______________________________",
  ];

  let y = 720;
  for (const line of lines) {
    if (line) {
      page.drawText(line, { x: 64, y, size: 12, font, color: INK });
    }
    y -= 22;
  }

  return doc.save();
}

/**
 * Clean translation, watermarked preview, and certification are three renders.
 * The preview is produced by its own pass with the watermark drawn into the
 * page content. It is not a copy of the clean file.
 */
export async function renderOrderPdfs(input: RenderInput): Promise<RenderedFiles> {
  const [cleanPass, previewPass] = translationRenderPasses();
  const cleanTranslation = await renderTranslationPdf(input, cleanPass.watermark);
  const watermarkedPreview = await renderTranslationPdf(input, previewPass.watermark);
  const certification = await renderCertificationPdf(input);
  return { cleanTranslation, watermarkedPreview, certification };
}
