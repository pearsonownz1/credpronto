import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import { create } from "qrcode";
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
const INK = rgb(11 / 255, 18 / 255, 32 / 255);
const LINE = rgb(228 / 255, 231 / 255, 236 / 255);
const QUIET_MODULES = 4;
const PAD_X = 16;
const PAD_Y = 12;
const COLUMN_GAP = 14;
const CAPTION = "Verify this CredPronto document";
const CAPTION_SIZE = 8;
const URL_SIZE = 7;
const URL_LEADING = 9;
const CAPTION_GAP = 4;
const TARGET_QR = 88;
const MIN_MODULE = 1.6;
const MAX_MODULE = 2.5;

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

/** QR, caption, and verify URL, all inside a band added above the original page. */
export type VerificationStampPlacement = {
  band: StampRect;
  card: StampRect;
  qr: StampRect;
  label: StampRect;
  moduleSize: number;
  caption: StampText;
  urlLines: StampText[];
};

/**
 * Place the QR and the verify URL in a new band above the page.
 * Existing marks, including the signature line and the footer, stay where they are.
 */
export function verificationStampPlacement(
  media: { x: number; y: number; width: number; height: number },
  url: string,
  widthOf: (text: string, size: number) => number,
  modules: number,
): VerificationStampPlacement {
  const cells = modules + QUIET_MODULES * 2;
  const maxSide = Math.max(64, media.width - PAD_X * 2);
  const moduleSize = Math.min(MAX_MODULE, Math.max(MIN_MODULE, Math.min(TARGET_QR, maxSide) / cells));
  const qrSide = cells * moduleSize;
  const sideTextWidth = media.width - PAD_X * 2 - qrSide - COLUMN_GAP;
  const stacked = sideTextWidth < 160;
  const textWidth = Math.max(40, stacked ? media.width - PAD_X * 2 : sideTextWidth);
  const lines = wrapUrl(url, (line) => widthOf(line, URL_SIZE), textWidth);
  const textHeight = CAPTION_SIZE + CAPTION_GAP + URL_SIZE + Math.max(0, lines.length - 1) * URL_LEADING;
  const innerHeight = stacked ? qrSide + 8 + textHeight : Math.max(qrSide, textHeight);
  const band: StampRect = {
    x: media.x,
    y: media.y + media.height,
    width: media.width,
    height: innerHeight + PAD_Y * 2,
  };
  const qr: StampRect = stacked
    ? {
        x: band.x + (band.width - qrSide) / 2,
        y: band.y + band.height - PAD_Y - qrSide,
        width: qrSide,
        height: qrSide,
      }
    : {
        x: band.x + PAD_X,
        y: band.y + (band.height - qrSide) / 2,
        width: qrSide,
        height: qrSide,
      };
  const textX = stacked ? band.x + PAD_X : qr.x + qrSide + COLUMN_GAP;
  const blockTop = stacked ? qr.y - 8 : band.y + (band.height + textHeight) / 2;
  const captionBaseline = blockTop - CAPTION_SIZE;
  const urlLines = lines.map((text, index) => ({
    text,
    x: textX,
    y: captionBaseline - CAPTION_GAP - URL_SIZE - index * URL_LEADING,
    size: URL_SIZE,
  }));
  const lowest = urlLines.length > 0 ? (urlLines[urlLines.length - 1]?.y ?? captionBaseline) : captionBaseline;
  const label: StampRect = {
    x: textX,
    y: lowest - 2,
    width: textWidth,
    height: captionBaseline + CAPTION_SIZE - (lowest - 2),
  };
  return {
    band,
    card: { ...band },
    qr,
    label,
    moduleSize,
    caption: { text: CAPTION, x: textX, y: captionBaseline, size: CAPTION_SIZE },
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
  const page = doc.getPage(0);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const placement = verificationStampPlacement(page.getMediaBox(), url, (text, size) => font.widthOfTextAtSize(text, size), matrix.size);
  reserveTopBand(page, placement.band.height);

  page.drawRectangle({
    x: placement.card.x,
    y: placement.card.y,
    width: placement.card.width,
    height: placement.card.height,
    color: WHITE,
  });
  const seam = placement.card.y + 0.8;
  page.drawLine({
    start: { x: placement.card.x, y: seam },
    end: { x: placement.card.x + placement.card.width, y: seam },
    thickness: 0.6,
    color: LINE,
  });
  drawModules(page, matrix, placement.qr.x, placement.qr.y, placement.moduleSize);
  page.drawText(placement.caption.text, {
    x: placement.caption.x,
    y: placement.caption.y,
    size: placement.caption.size,
    font,
    color: INK,
  });
  for (const line of placement.urlLines) {
    page.drawText(line.text, { x: line.x, y: line.y, size: line.size, font, color: INK });
  }

  return doc.save();
}

/** Grow the page upward. Marks already on the page keep their coordinates. */
function reserveTopBand(page: PDFPage, bandHeight: number): void {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const mediaTop = media.y + media.height;
  const cropTop = crop.y + crop.height;
  page.setMediaBox(media.x, media.y, media.width, media.height + bandHeight);
  if (cropTop >= mediaTop - 0.5) {
    page.setCropBox(crop.x, crop.y, crop.width, crop.height + (mediaTop - cropTop) + bandHeight);
  }
}

function drawModules(
  page: PDFPage,
  matrix: QrMatrix,
  originX: number,
  originY: number,
  moduleSize: number,
): void {
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
