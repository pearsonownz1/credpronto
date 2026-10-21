import { getDocumentProxy } from "unpdf";
import { ORIGINALS_BUCKET } from "./constants";
import { listDocuments, updateDocument, updateOrder, type Db } from "./db";
import { knownBillablePages } from "./evaluation-price";
import { downloadObject } from "./storage";
import type { DocumentRecord, OrderRecord } from "./types";

/** Physical pages in one uploaded file. A photo is one page. A PDF uses its page count. */
export async function countOriginalPages(
  bytes: Uint8Array,
  mime: string | null,
  filename: string,
): Promise<number | null> {
  if (mime?.startsWith("image/")) return 1;
  const pdf = mime === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
  if (!pdf) return null;
  try {
    const proxy = await getDocumentProxy(bytes.slice());
    return proxy.numPages > 0 ? proxy.numPages : null;
  } catch {
    return null;
  }
}

/**
 * Combined checkout reuses the upload page count.
 * It is already on the order, or on each document. When neither was stored, read it from the file once.
 */
export async function withQuotedPages(db: Db, order: OrderRecord): Promise<OrderRecord> {
  if (order.includeTranslation !== true) return order;
  if (order.service !== "diploma" && order.service !== "course_by_course") return order;
  if (order.billablePages != null && order.billablePages > 0) return order;

  const documents = await listDocuments(db, order.id);
  const counted: DocumentRecord[] = [];
  for (const document of documents) {
    if (document.pageCount != null && document.pageCount > 0) {
      counted.push(document);
      continue;
    }
    try {
      const bytes = await downloadObject(db, ORIGINALS_BUCKET, document.originalPath);
      const pages = await countOriginalPages(bytes, document.mime, document.filename);
      if (pages == null || pages < 1) {
        counted.push(document);
        continue;
      }
      await updateDocument(db, document.id, { page_count: pages });
      counted.push({ ...document, pageCount: pages });
    } catch {
      counted.push(document);
    }
  }

  const pages = knownBillablePages({ billablePages: null, documents: counted });
  if (pages == null || pages < 1) return order;
  await updateOrder(db, order.id, { billable_pages: pages });
  return { ...order, billablePages: pages };
}
