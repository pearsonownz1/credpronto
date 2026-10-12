import { PDFDocument } from "pdf-lib";
import { LETTER_HEIGHT_PT, LETTER_WIDTH_PT } from "../constants";
import { HttpError } from "../errors";

export type CombinedPage = {
  widthPt: number;
  heightPt: number;
  sourceIndex: number;
  sourcePage: number;
};

export type SourceFile = {
  bytes: Uint8Array;
  mime: string;
};

async function toPngOrJpeg(
  bytes: Uint8Array,
  mime: string,
): Promise<{ bytes: Uint8Array; mime: "image/png" | "image/jpeg" }> {
  if (mime === "image/jpeg" || mime === "image/jpg") {
    return { bytes, mime: "image/jpeg" };
  }
  if (mime === "image/png") {
    return { bytes, mime: "image/png" };
  }
  if (mime === "image/heic" || mime === "image/heif") {
    const convert = (await import("heic-convert")).default;
    const png = await convert({ buffer: Buffer.from(bytes), format: "PNG" });
    return { bytes: new Uint8Array(png), mime: "image/png" };
  }

  const sharp = (await import("sharp")).default;
  const png = await sharp(Buffer.from(bytes)).png().toBuffer();
  return { bytes: new Uint8Array(png), mime: "image/png" };
}

async function addImagePage(
  dest: PDFDocument,
  bytes: Uint8Array,
  mime: string,
): Promise<{ widthPt: number; heightPt: number }> {
  const embeddable = await toPngOrJpeg(bytes, mime);
  const image =
    embeddable.mime === "image/jpeg"
      ? await dest.embedJpg(embeddable.bytes)
      : await dest.embedPng(embeddable.bytes);

  const margin = 36;
  const maxW = LETTER_WIDTH_PT - margin * 2;
  const maxH = LETTER_HEIGHT_PT - margin * 2;
  const scale = Math.min(maxW / image.width, maxH / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  const page = dest.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT]);
  page.drawImage(image, {
    x: (LETTER_WIDTH_PT - drawW) / 2,
    y: (LETTER_HEIGHT_PT - drawH) / 2,
    width: drawW,
    height: drawH,
  });

  return { widthPt: LETTER_WIDTH_PT, heightPt: LETTER_HEIGHT_PT };
}

/**
 * One PDF, upload order preserved, one viewer page per original side.
 * PDF pages keep their own size. Images become a letter page.
 */
export async function buildCombinedOriginal(files: SourceFile[]): Promise<{
  pdf: Uint8Array;
  pages: CombinedPage[];
}> {
  if (files.length === 0) {
    throw new HttpError("Upload at least one file", 400);
  }

  const dest = await PDFDocument.create();
  const pages: CombinedPage[] = [];

  for (let sourceIndex = 0; sourceIndex < files.length; sourceIndex += 1) {
    const file = files[sourceIndex];
    if (file.mime === "application/pdf") {
      let src: PDFDocument;
      try {
        src = await PDFDocument.load(file.bytes, { ignoreEncryption: false });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`Could not open PDF: ${detail}`, error);
        throw new HttpError(
          "A PDF is password-protected or could not be opened.",
          400,
        );
      }
      const copied = await dest.copyPages(src, src.getPageIndices());
      copied.forEach((page, pageIndex) => {
        const size = page.getSize();
        dest.addPage(page);
        pages.push({
          widthPt: size.width,
          heightPt: size.height,
          sourceIndex,
          sourcePage: pageIndex + 1,
        });
      });
      if (copied.length === 0) {
        throw new HttpError("A PDF has no pages.", 400);
      }
      continue;
    }

    const size = await addImagePage(dest, file.bytes, file.mime);
    pages.push({
      ...size,
      sourceIndex,
      sourcePage: 1,
    });
  }

  return { pdf: await dest.save(), pages };
}
