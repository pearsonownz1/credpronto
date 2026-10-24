import type { PDFDocument } from "pdf-lib";
import { BRAND_NAME } from "../brand";

/** Author, creator, and producer on every PDF this server writes. */
export function applyCredProntoPdfMetadata(doc: PDFDocument): void {
  applyPdfMetadata(doc, "credpronto");
}

/** GCS certificates name GEO Credential Services. Every other PDF stays CredPronto. */
export function applyPdfMetadata(doc: PDFDocument, brand?: "credpronto" | "gcs" | null): void {
  const name = brand === "gcs" ? "GEO Credential Services" : BRAND_NAME;
  doc.setTitle(name);
  doc.setAuthor(name);
  doc.setSubject(name);
  doc.setKeywords([name]);
  doc.setCreator(name);
  doc.setProducer(name);
}
