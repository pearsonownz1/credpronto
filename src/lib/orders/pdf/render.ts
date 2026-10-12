import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { degrees } from "pdf-lib";
import { PREVIEW_WATERMARK, PREVIEW_WATERMARK_OPACITY, previewWatermarkRgb } from "../constants";
import { loadNotoSans } from "./font";
import {
  assertContiguousPages,
  pageSize,
  translationRenderPasses,
  wrapLines,
  type RenderInput,
  type RenderPage,
} from "./layout";

export type { RenderInput, RenderPage } from "./layout";

export type RenderedFiles = {
  cleanTranslation: Uint8Array;
  watermarkedPreview: Uint8Array;
  certification: Uint8Array;
};

async function embedBodyFont(doc: PDFDocument): Promise<PDFFont> {
  doc.registerFontkit(fontkit);
  return doc.embedFont(loadNotoSans(), { subset: true });
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

function drawBody(page: PDFPage, font: PDFFont, pageSpec: RenderPage, pageCount: number): void {
  const { widthPt, heightPt } = pageSize(pageSpec);
  const margin = Math.min(48, widthPt * 0.08, heightPt * 0.08);
  const maxWidth = Math.max(40, widthPt - margin * 2);
  const paragraphs = pageSpec.paragraphs.length > 0 ? pageSpec.paragraphs : [" "];

  let size = 12;
  while (size >= 8) {
    const lineHeight = size * 1.35;
    const widthOf = (line: string) => font.widthOfTextAtSize(line, size);
    const lines: string[] = [];
    for (const paragraph of paragraphs) {
      const wrapped = wrapLines(paragraph, widthOf, maxWidth);
      lines.push(...(wrapped.length > 0 ? wrapped : [""]));
      lines.push("");
    }
    const needed = lines.length * lineHeight + lineHeight;
    if (needed <= heightPt - margin * 2 || size === 8) {
      let y = heightPt - margin - lineHeight;
      for (const line of lines) {
        if (y < margin) break;
        if (line) {
          page.drawText(line, {
            x: margin,
            y,
            size,
            font,
            color: rgb(0.1, 0.1, 0.12),
          });
        }
        y -= lineHeight;
      }
      page.drawText(`Page ${pageSpec.combinedPageNumber} of ${pageCount}`, {
        x: margin,
        y: Math.max(16, margin / 2),
        size: 8,
        font,
        color: rgb(0.35, 0.35, 0.38),
      });
      return;
    }
    size -= 1;
  }
}

async function renderTranslationPdf(input: RenderInput, watermark: boolean): Promise<Uint8Array> {
  assertContiguousPages(input.pages);
  const ordered = [...input.pages].sort((a, b) => a.combinedPageNumber - b.combinedPageNumber);
  const doc = await PDFDocument.create();
  const font = await embedBodyFont(doc);

  for (const pageSpec of ordered) {
    const { widthPt, heightPt } = pageSize(pageSpec);
    const page = doc.addPage([widthPt, heightPt]);
    drawBody(page, font, pageSpec, ordered.length);
    if (watermark) drawWatermark(page, font, widthPt, heightPt);
  }

  return doc.save();
}

export async function renderCertificationPdf(input: RenderInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedBodyFont(doc);
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
      page.drawText(line, { x: 64, y, size: 12, font, color: rgb(0.1, 0.1, 0.12) });
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
