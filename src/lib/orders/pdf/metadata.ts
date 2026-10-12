import type { PDFDocument } from "pdf-lib";
import { BRAND_NAME } from "../brand";

/** Author, creator, and producer on every PDF this server writes. */
export function applyCredProntoPdfMetadata(doc: PDFDocument): void {
  doc.setTitle(BRAND_NAME);
  doc.setAuthor(BRAND_NAME);
  doc.setSubject(BRAND_NAME);
  doc.setKeywords([BRAND_NAME]);
  doc.setCreator(BRAND_NAME);
  doc.setProducer(BRAND_NAME);
}
