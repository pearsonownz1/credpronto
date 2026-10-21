import { resolveUploadMime } from "@/lib/orders/file-type";
import { openPdfDocument } from "./pdf-preview";

/** Physical pages in an upload. A photo is one page. A PDF uses its page count. */
export async function countUploadPages(file: File): Promise<number | null> {
  const mime = resolveUploadMime(file.name, file.type || "");
  if (mime === "application/pdf") {
    try {
      const pdf = await openPdfDocument({ data: new Uint8Array(await file.arrayBuffer()) });
      try {
        return pdf.numPages;
      } finally {
        await pdf.cleanup();
        await pdf.loadingTask.destroy();
      }
    } catch {
      return null;
    }
  }
  if (mime?.startsWith("image/")) return 1;
  return null;
}
