import { PDFDocument } from "pdf-lib";
import { knownPageCount } from "@/lib/analytics/google-ads";
import { resolveUploadMime } from "@/lib/orders/file-type";
import { openPdfDocument } from "./pdf-preview";

/** pdf.js `numPages` and pdf-lib `getPageCount`. The higher one wins when they disagree. */
export function higherPageCount(counts: Array<number | null>): number | null {
  const known = counts.filter((count): count is number => count != null && count > 0);
  if (known.length === 0) return null;
  return Math.max(...known);
}

async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
  const [fromLib, fromJs] = await Promise.all([pdfLibPageCount(bytes), pdfJsPageCount(bytes)]);
  return higherPageCount([fromLib, fromJs]);
}

async function pdfLibPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true });
    const count = doc.getPageCount();
    return count > 0 ? count : null;
  } catch {
    return null;
  }
}

async function pdfJsPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const pdf = await openPdfDocument({ data: bytes.slice() });
    try {
      return pdf.numPages > 0 ? pdf.numPages : null;
    } finally {
      await pdf.cleanup();
      await pdf.loadingTask.destroy();
    }
  } catch {
    return null;
  }
}

/**
 * Physical pages in one upload file.
 * A photo is one page. A PDF is pdf.js / pdf-lib `getPageCount`, not one page per file.
 */
export async function countUploadPages(file: File): Promise<number | null> {
  const mime = resolveUploadMime(file.name, file.type || "");
  if (mime?.startsWith("image/")) return 1;
  if (mime !== "application/pdf") return null;
  return pdfPageCount(new Uint8Array(await file.arrayBuffer()));
}

/** Sum of every file. Unknown until each file has a count. */
export function sumUploadPages(counts: Array<number | null | undefined>): number | null {
  return knownPageCount(counts);
}

/** Pre-quote page label. The server quote replaces this number. */
export function estimatedPageLabel(pages: number): string {
  return `Estimated ${pages} ${pages === 1 ? "page" : "pages"}`;
}
