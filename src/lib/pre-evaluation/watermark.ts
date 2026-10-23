import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { PreEvalMime } from "./constants";

/** Designer spec was not in the repo. This is the fallback stamp: PREVIEW at -30 degrees plus a navy band. */
export const PRE_EVAL_PREVIEW_LABEL = "PREVIEW";

const NAVY = rgb(0x0b / 255, 0x1f / 255, 0x3a / 255);
const WHITE = rgb(1, 1, 1);
const BAND_HEIGHT = 36;

/** Object key for the watermarked render. It never matches `{id}/{upload filename}`. */
export function preEvaluationPreviewObjectPath(internalId: string): string {
  return `${internalId}/renders/preview.pdf`;
}

function stampPage(page: PDFPage, font: PDFFont): void {
  const { width, height } = page.getSize();
  const size = 22;
  for (let y = -height; y < height * 2; y += 72) {
    for (let x = -width; x < width * 2; x += 160) {
      page.drawText(PRE_EVAL_PREVIEW_LABEL, {
        x,
        y,
        size,
        font,
        color: NAVY,
        opacity: 0.34,
        rotate: degrees(-30),
      });
    }
  }
  page.drawRectangle({ x: 0, y: 0, width, height: BAND_HEIGHT, color: NAVY });
  page.drawText(PRE_EVAL_PREVIEW_LABEL, {
    x: 14,
    y: 12,
    size: 14,
    font,
    color: WHITE,
  });
}

async function pageForImage(doc: PDFDocument, bytes: Uint8Array, mime: "image/jpeg" | "image/png"): Promise<void> {
  const image = mime === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const width = Math.min(Math.max(image.width, 240), 1200);
  const height = Math.min(Math.max(image.height, 240), 1600);
  const page = doc.addPage([width, height]);
  const maxWidth = width;
  const maxHeight = height - BAND_HEIGHT;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const drawnWidth = image.width * scale;
  const drawnHeight = image.height * scale;
  page.drawImage(image, {
    x: (width - drawnWidth) / 2,
    y: BAND_HEIGHT + (maxHeight - drawnHeight) / 2,
    width: drawnWidth,
    height: drawnHeight,
  });
}

/**
 * A new PDF with the uploaded pages or image, stamped so it is not the original file.
 * Translation previews render a translated order, so they are not reused for this upload.
 */
export async function renderWatermarkedPreview(bytes: Uint8Array, mime: PreEvalMime): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  if (mime === "application/pdf") {
    const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const copied = await doc.copyPages(source, source.getPageIndices());
    if (copied.length === 0) doc.addPage();
    for (const page of copied) doc.addPage(page);
  } else {
    await pageForImage(doc, bytes, mime);
  }
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const page of doc.getPages()) stampPage(page, font);
  const rendered = await doc.save();
  if (rendered.byteLength === 0 || bytesEqual(rendered, bytes)) {
    throw new Error("watermarked preview matched the original");
  }
  return rendered;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
