import { PDFDocument } from "pdf-lib";
import { applyCredProntoPdfMetadata } from "./metadata";
import { stampPacketPageNumbers } from "./page-numbers";

/** Append every page of `extra` after `base`. */
export async function appendPdf(base: Uint8Array, extra: Uint8Array): Promise<Uint8Array> {
  return concatPdfs([base, extra]);
}

export async function concatPdfs(parts: readonly Uint8Array[]): Promise<Uint8Array> {
  const dest = await PDFDocument.create();
  for (const part of parts) {
    if (part.byteLength === 0) continue;
    const src = await PDFDocument.load(part);
    const copied = await dest.copyPages(src, src.getPageIndices());
    for (const page of copied) dest.addPage(page);
  }
  if (dest.getPageCount() === 0) throw new Error("No pages to merge");
  applyCredProntoPdfMetadata(dest);
  return dest.save();
}

/**
 * Signed certification cover, then the translation, then the original.
 * A stored translation that already starts with a cover drops those leading pages
 * so the signed cover is not repeated.
 */
export async function mergeCertifiedPacket(input: {
  certification: Uint8Array;
  translation: Uint8Array;
  original?: Uint8Array | null;
  orderId: string;
}): Promise<Uint8Array> {
  const cover = await PDFDocument.load(input.certification);
  const body = await PDFDocument.load(input.translation);
  const coverCount = cover.getPageCount();
  const drop = body.getPageCount() > coverCount ? coverCount : body.getPageCount() > 1 ? 1 : 0;
  const dest = await PDFDocument.create();
  const coverPages = await dest.copyPages(cover, cover.getPageIndices());
  for (const page of coverPages) dest.addPage(page);
  const indices = body.getPageIndices().slice(drop);
  const kept = indices.length > 0 ? indices : body.getPageIndices();
  const bodyPages = await dest.copyPages(body, kept);
  for (const page of bodyPages) dest.addPage(page);
  const footerPages = dest.getPageCount();
  if (input.original && input.original.byteLength > 0) {
    const original = await PDFDocument.load(input.original);
    const originalPages = await dest.copyPages(original, original.getPageIndices());
    for (const page of originalPages) dest.addPage(page);
  }
  applyCredProntoPdfMetadata(dest);
  const merged = await dest.save();
  if (dest.getPageCount() <= footerPages) return merged;
  return stampPacketPageNumbers(merged, { orderId: input.orderId, footerPages });
}
