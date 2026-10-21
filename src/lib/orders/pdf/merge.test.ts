import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { mergeCertifiedPacket } from "./merge";

async function page(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sheet = doc.addPage([200, 200]);
  sheet.drawText(text, { x: 20, y: 100, size: 12, font });
  return doc.save();
}

async function pageText(bytes: Uint8Array): Promise<string[]> {
  const extracted = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: false });
  return extracted.text;
}

describe("mergeCertifiedPacket", () => {
  it("puts the cover first, then the translation, then the original", async () => {
    const merged = await mergeCertifiedPacket({
      certification: await page("COVERPAGE"),
      translation: await page("TRANSLATIONPAGE"),
      original: await page("ORIGINALPAGE"),
      orderId: "order-1",
    });
    const text = await pageText(merged);
    expect(text[0]).toContain("COVERPAGE");
    expect(text[1]).toContain("TRANSLATIONPAGE");
    expect(text[2]).toContain("ORIGINALPAGE");
    expect(text[2]).not.toContain("Page");
  });

  it("does not repeat a cover that is already the first translation page", async () => {
    const cover = await page("cover");
    const body = await page("translation");
    const coverDoc = await PDFDocument.load(cover);
    const bodyDoc = await PDFDocument.load(body);
    const combined = await PDFDocument.create();
    const pages = [
      ...(await combined.copyPages(coverDoc, coverDoc.getPageIndices())),
      ...(await combined.copyPages(bodyDoc, bodyDoc.getPageIndices())),
    ];
    for (const sheet of pages) combined.addPage(sheet);
    const translation = await combined.save();
    const original = await page("original");
    const merged = await mergeCertifiedPacket({
      certification: cover,
      translation,
      original,
      orderId: "order-1",
    });
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(3);
  });
});