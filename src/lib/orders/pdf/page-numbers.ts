import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  rgb,
  type PDFFont,
  type PDFPage,
  type PDFRef,
} from "pdf-lib";
import { BRAND_FOOTER } from "../brand";
import { fontFace, stableFontkit } from "./font";
import { applyCredProntoPdfMetadata } from "./metadata";

const MUTED = rgb(91 / 255, 100 / 255, 116 / 255);
const WHITE = rgb(1, 1, 1);
const FOOTER_Y = 28;
const LABEL_SIZE = 7.5;

/** Right-hand footer. The same string the cover and translation pages already use. */
export function packetPageLabel(orderId: string, pageNumber: number, pageCount: number): string {
  return `Order ${orderId} · Page ${pageNumber} of ${pageCount}`;
}

function footerMargin(width: number): number {
  return Math.min(48, width * 0.08);
}

/** Size the cover used so the brand line and the page label share the footer. */
function fitCoverLabelSize(font: PDFFont, width: number, label: string): number {
  const contentW = width - footerMargin(width) * 2;
  let size = LABEL_SIZE;
  while (
    size > 6 &&
    font.widthOfTextAtSize(BRAND_FOOTER, size) + 16 + font.widthOfTextAtSize(label, size) > contentW
  ) {
    size -= 0.25;
  }
  return size;
}

/**
 * Drop a page-number text object at the footer baseline.
 * The brand line on the cover starts at x=48 and is left alone.
 */
function stripFooterLabel(content: string, minX: number): string {
  return content.replace(/q\r?\nBT\r?\n[\s\S]*?\r?\nET\r?\nQ\r?\n?/g, (block) => {
    if (block.length > 800) return block;
    const placed = /1 0 0 1 ([0-9.]+) ([0-9.]+) Tm/.exec(block);
    if (!placed) return block;
    const x = Number(placed[1]);
    const y = Number(placed[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return block;
    if (Math.abs(y - FOOTER_Y) > 0.6 || x < minX) return block;
    return "";
  });
}

function strippedBytes(stream: PDFRawStream, minX: number): Uint8Array | null {
  let decoded: Uint8Array;
  try {
    decoded = decodePDFRawStream(stream).decode();
  } catch {
    return null;
  }
  const content = Buffer.from(decoded).toString("latin1");
  const stripped = stripFooterLabel(content, minX);
  if (stripped === content || content.length - stripped.length > 1500) return null;
  return Buffer.from(stripped, "latin1");
}

function removeOldPageLabel(doc: PDFDocument, page: PDFPage, minX: number): void {
  const contents = page.node.Contents();
  if (contents instanceof PDFArray) {
    for (let index = 0; index < contents.size(); index += 1) {
      const ref = contents.get(index);
      const stream = doc.context.lookup(ref as PDFRef);
      if (!(stream instanceof PDFRawStream)) continue;
      const bytes = strippedBytes(stream, minX);
      if (!bytes) continue;
      contents.set(index, doc.context.register(doc.context.flateStream(bytes)));
    }
    return;
  }
  if (contents instanceof PDFRawStream) {
    const bytes = strippedBytes(contents, minX);
    if (!bytes) return;
    page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(bytes)));
  }
}

function paintPageLabel(
  page: PDFPage,
  font: PDFFont,
  input: { orderId: string; pageNumber: number; pageCount: number; footerPages: number; cover: boolean },
): void {
  const { width } = page.getSize();
  const margin = footerMargin(width);
  const right = width - margin;
  const previous = packetPageLabel(input.orderId, input.pageNumber, input.footerPages);
  const label = packetPageLabel(input.orderId, input.pageNumber, input.pageCount);
  const previousSize = input.cover ? fitCoverLabelSize(font, width, previous) : LABEL_SIZE;
  let size = input.cover ? previousSize : LABEL_SIZE;
  let leftLimit = margin;
  if (input.cover) {
    const contentW = width - margin * 2;
    const brandWidth = font.widthOfTextAtSize(BRAND_FOOTER, previousSize);
    const available = contentW - brandWidth - 16;
    while (size > 6 && font.widthOfTextAtSize(label, size) > available) size -= 0.25;
    leftLimit = margin + brandWidth + 8;
  }
  const widthNeeded = Math.max(
    font.widthOfTextAtSize(previous, previousSize),
    font.widthOfTextAtSize(label, size),
  );
  const left = Math.max(leftLimit, right - widthNeeded - 3);
  page.drawRectangle({
    x: left,
    y: 19,
    width: Math.max(4, right + 2 - left),
    height: 18,
    color: WHITE,
    borderWidth: 0,
  });
  const textWidth = font.widthOfTextAtSize(label, size);
  page.drawText(label, {
    x: Math.max(left, right - textWidth),
    y: FOOTER_Y,
    size,
    font,
    color: MUTED,
  });
}

/**
 * Renumber the cover and translation footers to the merged page count.
 * `footerPages` is how many leading pages were numbered before the original was appended.
 * Original pages are not stamped.
 */
export async function stampPacketPageNumbers(
  pdf: Uint8Array,
  input: { orderId: string; footerPages: number },
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf);
  const total = doc.getPageCount();
  const footerPages = Math.min(Math.max(0, Math.floor(input.footerPages)), total);
  if (footerPages <= 0 || footerPages >= total) return pdf;

  doc.registerFontkit(stableFontkit());
  const font = await doc.embedFont(fontFace("regular").bytes, { subset: true });
  for (let index = 0; index < footerPages; index += 1) {
    const page = doc.getPage(index);
    const cover = index === 0;
    removeOldPageLabel(doc, page, cover ? 72 : 0);
    paintPageLabel(page, font, {
      orderId: input.orderId,
      pageNumber: index + 1,
      pageCount: total,
      footerPages,
      cover,
    });
  }
  applyCredProntoPdfMetadata(doc);
  return doc.save();
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}
