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
const QUIET_MODULES = 4;

/**
 * Draw a QR code and the verify URL on the first page.
 * The URL is the access key: scanning it opens the document, and the same address can be saved.
 */
export async function stampVerificationQr(bytes: Uint8Array, token: string): Promise<Uint8Array> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes);
  } catch {
    throw new HttpError("The PDF could not be stamped", 422);
  }
  if (doc.getPageCount() < 1) throw new HttpError("The PDF could not be stamped", 422);

  const url = verificationUrl(token);
  const matrix = qrMatrix(url);
  const page = doc.getPage(0);
  const { width, height } = page.getSize();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const margin = Math.min(18, width * 0.04);
  const maxCard = Math.max(96, width - margin * 2);
  let moduleSize = 2.4;
  let fitted = cardSize(matrix.size, moduleSize, font, url, maxCard);
  while (fitted.height > height - margin * 2 && moduleSize > 1.15) {
    moduleSize -= 0.15;
    fitted = cardSize(matrix.size, moduleSize, font, url, maxCard);
  }

  const cardWidth = Math.min(maxCard, fitted.width);
  const x = Math.max(margin, width - margin - cardWidth);
  const y = margin;
  page.drawRectangle({
    x,
    y,
    width: cardWidth,
    height: fitted.height,
    color: WHITE,
    borderColor: rgb(228 / 255, 231 / 255, 236 / 255),
    borderWidth: 0.6,
  });

  const qrSide = (matrix.size + QUIET_MODULES * 2) * moduleSize;
  const qrX = x + (cardWidth - qrSide) / 2;
  const qrY = y + fitted.height - 8 - qrSide;
  drawModules(page, matrix, qrX, qrY, moduleSize);

  let textY = qrY - 12;
  page.drawText("Verify this CredPronto document", {
    x: x + 8,
    y: textY,
    size: 7,
    font,
    color: INK,
  });
  textY -= 11;
  for (const line of fitted.lines) {
    page.drawText(line, { x: x + 8, y: textY, size: 6, font, color: INK });
    textY -= 8;
  }

  return doc.save();
}

function cardSize(
  modules: number,
  moduleSize: number,
  font: { widthOfTextAtSize(text: string, size: number): number },
  url: string,
  maxCard: number,
): { width: number; height: number; lines: string[] } {
  const qrSide = (modules + QUIET_MODULES * 2) * moduleSize;
  const textWidth = Math.max(qrSide, Math.min(maxCard - 16, 300));
  const lines = wrapUrl(url, (line) => font.widthOfTextAtSize(line, 6), textWidth);
  const width = Math.min(maxCard, Math.max(qrSide, textWidth) + 16);
  const height = 8 + qrSide + 12 + 11 + lines.length * 8 + 8;
  return { width, height, lines };
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
