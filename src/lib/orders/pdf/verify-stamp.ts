import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import { create } from "qrcode";
import { LETTER_HEIGHT_PT, LETTER_WIDTH_PT } from "../constants";
import { HttpError } from "../errors";

export const VERIFY_ORIGIN = "https://www.credpronto.com";

/** Short verify URL printed and encoded on a finished PDF. */
export function verificationUrl(token: string): string {
  return `${VERIFY_ORIGIN}/verify/${token}`;
}

export type QrMatrix = {
  size: number;
  get(row: number, col: number): boolean;
};

/** Error correction M. The matrix has no quiet zone; callers pad four modules. */
export function qrMatrix(text: string): QrMatrix {
  const code = create(text, { errorCorrectionLevel: "M" });
  return {
    size: code.modules.size,
    get(row: number, col: number) {
      return Boolean(code.modules.get(row, col));
    },
  };
}

const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const GRAY = rgb(91 / 255, 100 / 255, 116 / 255);
const QUIET_MODULES = 4;

/** Finished page 1 stays US Letter. The top 72pt is the verify band; the page sits in the 720pt below it. */
const PAGE_W = LETTER_WIDTH_PT;
const PAGE_H = LETTER_HEIGHT_PT;
const BAND_H = 72;
const CONTENT_H = PAGE_H - BAND_H;
const QR_SIZE = 56;
const QR_INSET = (BAND_H - QR_SIZE) / 2;
const URL_SIZE = 8;
const URL_LEADING = 11;
const URL_LEFT = 16;
const URL_GAP = 12;

export type StampRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type StampText = {
  text: string;
  x: number;
  y: number;
  size: number;
};

/** Letter page, top band, and the scaled original page inside the remaining area. */
export type VerificationStampPlacement = {
  page: { width: number; height: number };
  band: StampRect;
  qr: StampRect;
  label: StampRect;
  content: StampRect;
  scale: number;
  moduleSize: number;
  urlLines: StampText[];
};

/**
 * Fit page 1 on US Letter. The QR and verify URL occupy a 72pt band at the top.
 * The original page is scaled uniformly into the 612x720 area under that band.
 */
export function verificationStampPlacement(
  source: { width: number; height: number },
  url: string,
  widthOf: (text: string, size: number) => number,
  modules: number,
): VerificationStampPlacement {
  const scale = Math.min(PAGE_W / source.width, CONTENT_H / source.height);
  const contentWidth = Math.min(PAGE_W, source.width * scale);
  const contentHeight = Math.min(CONTENT_H, source.height * scale);
  const content: StampRect = {
    x: (PAGE_W - contentWidth) / 2,
    y: (CONTENT_H - contentHeight) / 2,
    width: contentWidth,
    height: contentHeight,
  };
  const band: StampRect = { x: 0, y: CONTENT_H, width: PAGE_W, height: BAND_H };
  const qr: StampRect = {
    x: PAGE_W - QR_INSET - QR_SIZE,
    y: band.y + QR_INSET,
    width: QR_SIZE,
    height: QR_SIZE,
  };
  const textWidth = Math.max(40, qr.x - URL_GAP - URL_LEFT);
  const lines = wrapUrl(url, (line) => widthOf(line, URL_SIZE), textWidth);
  const textHeight = URL_SIZE + Math.max(0, lines.length - 1) * URL_LEADING;
  const blockTop = band.y + (BAND_H + textHeight) / 2;
  const urlLines = lines.map((text, index) => ({
    text,
    x: URL_LEFT,
    y: blockTop - URL_SIZE - index * URL_LEADING,
    size: URL_SIZE,
  }));
  const lowest = urlLines.length > 0 ? (urlLines[urlLines.length - 1]?.y ?? blockTop) : blockTop;
  const labelWidth = lines.reduce((widest, line) => Math.max(widest, widthOf(line, URL_SIZE)), 0);
  const label: StampRect = {
    x: URL_LEFT,
    y: lowest - 2,
    width: labelWidth,
    height: blockTop - (lowest - 2),
  };
  const cells = modules + QUIET_MODULES * 2;
  return {
    page: { width: PAGE_W, height: PAGE_H },
    band,
    qr,
    label,
    content,
    scale,
    moduleSize: QR_SIZE / cells,
    urlLines,
  };
}

/**
 * Draw a QR code and the verify URL on the first page.
 * The URL is the access key: scanning it opens the document, and the same address can be saved.
 */
export async function stampVerificationQr(bytes: Uint8Array, token: string): Promise<Uint8Array> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new HttpError("The PDF could not be stamped", 422);
  }
  if (doc.getPageCount() < 1) throw new HttpError("The PDF could not be stamped", 422);

  const url = verificationUrl(token);
  const matrix = qrMatrix(url);
  const donor = await PDFDocument.load(bytes, { updateMetadata: false });
  const source = donor.getPage(0);
  if (!source.node.Contents()) source.drawRectangle({ x: 0, y: 0, width: 0, height: 0 });
  const embedded = await doc.embedPage(source);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const placement = verificationStampPlacement(
    embedded.size(),
    url,
    (text, size) => font.widthOfTextAtSize(text, size),
    matrix.size,
  );

  doc.removePage(0);
  const page = doc.insertPage(0, [PAGE_W, PAGE_H]);
  page.setMediaBox(0, 0, PAGE_W, PAGE_H);
  page.setCropBox(0, 0, PAGE_W, PAGE_H);
  page.drawPage(embedded, {
    x: placement.content.x,
    y: placement.content.y,
    width: placement.content.width,
    height: placement.content.height,
  });
  page.drawRectangle({
    x: placement.band.x,
    y: placement.band.y,
    width: placement.band.width,
    height: placement.band.height,
    color: WHITE,
  });
  drawModules(page, matrix, placement.qr.x, placement.qr.y, placement.moduleSize);
  for (const line of placement.urlLines) {
    page.drawText(line.text, { x: line.x, y: line.y, size: line.size, font, color: GRAY });
  }

  return doc.save();
}

function drawModules(page: PDFPage, matrix: QrMatrix, originX: number, originY: number, moduleSize: number): void {
  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (!matrix.get(row, col)) continue;
      page.drawRectangle({
        x: originX + (QUIET_MODULES + col) * moduleSize,
        y: originY + (QUIET_MODULES + (matrix.size - 1 - row)) * moduleSize,
        width: moduleSize,
        height: moduleSize,
        color: BLACK,
      });
    }
  }
}

function wrapUrl(url: string, widthOf: (line: string) => number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const char of url) {
    const next = current + char;
    if (current && widthOf(next) > maxWidth) {
      lines.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [url];
}
