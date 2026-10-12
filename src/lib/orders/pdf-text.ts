import { getDocumentProxy } from "unpdf";
import { joinTextItems, type TextItemLike } from "./text-layer";

/**
 * Text layer of a PDF, one string per page.
 *
 * pdf.js transfers the typed array to its worker and detaches the caller's
 * buffer. Copy first so a later pdf-lib open of the same upload still works.
 */
export async function pdfPageTexts(
  bytes: Uint8Array,
  onPage?: (page: { pageNumber: number; pageCount: number }) => Promise<void> | void,
): Promise<string[]> {
  const proxy = await getDocumentProxy(bytes.slice());
  const pageCount = proxy.numPages;
  const texts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await proxy.getPage(pageNumber);
    const content = await page.getTextContent();
    texts.push(joinTextItems(content.items as TextItemLike[]));
    if (onPage) await onPage({ pageNumber, pageCount });
  }
  return texts;
}
