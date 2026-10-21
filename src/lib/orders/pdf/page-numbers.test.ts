import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { BRAND_FOOTER } from "../brand";
import { CERTIFICATION_STATEMENTS } from "./cover";
import { mergeCertifiedPacket } from "./merge";
import { renderOrderPdfs } from "./render";

async function pageText(bytes: Uint8Array): Promise<string[]> {
  const extracted = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: false });
  return extracted.text;
}

async function blankPage(label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sheet = doc.addPage([612, 792]);
  sheet.drawText(label, { x: 48, y: 28, size: 12, font });
  return doc.save();
}

describe("merged packet page numbers", () => {
  it("numbers the cover and translation against the merged page count", async () => {
    const rendered = await renderOrderPdfs({
      orderId: "order-1",
      sourceLanguage: "es",
      date: "2026-10-12",
      pages: [{ combinedPageNumber: 1, widthPt: 612, heightPt: 792, paragraphs: ["Hello diploma"] }],
    });
    const merged = await mergeCertifiedPacket({
      certification: rendered.certification,
      translation: rendered.cleanTranslation,
      original: await blankPage("ORIGINAL-FOOTER"),
      orderId: "order-1",
    });
    const pages = await pageText(merged);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain("Certificate of Translation Accuracy");
    expect(pages[0]).toContain("2520 Venture Oaks Way");
    expect(pages[0]).toContain(CERTIFICATION_STATEMENTS[0].slice(0, 40));
    expect(pages[0]).toContain(BRAND_FOOTER);
    expect(pages[0]).toContain("Order order-1 · Page 1 of 3");
    expect(pages[0]).not.toContain("Page 1 of 2");
    expect(pages[1]).toContain("Hello diploma");
    expect(pages[1]).toContain("Order order-1 · Page 2 of 3");
    expect(pages[1]).not.toContain("Page 2 of 2");
    expect(pages[2]).toContain("ORIGINAL-FOOTER");
    expect(pages[2]).not.toContain("Page 3 of 3");
  });

  it("counts every translation page in a longer packet", async () => {
    const rendered = await renderOrderPdfs({
      orderId: "order-1",
      sourceLanguage: "es",
      date: "2026-10-12",
      pages: [
        { combinedPageNumber: 1, widthPt: 612, heightPt: 792, paragraphs: ["First page"] },
        { combinedPageNumber: 2, widthPt: 612, heightPt: 792, paragraphs: ["Second page"] },
      ],
    });
    const merged = await mergeCertifiedPacket({
      certification: rendered.certification,
      translation: rendered.cleanTranslation,
      original: await blankPage("ORIGINAL-FOOTER"),
      orderId: "order-1",
    });
    const pages = await pageText(merged);
    expect(pages).toHaveLength(4);
    expect(pages[0]).toContain("Page 1 of 4");
    expect(pages[0]).not.toContain("Page 1 of 3");
    expect(pages[1]).toContain("Page 2 of 4");
    expect(pages[1]).not.toContain("Page 2 of 3");
    expect(pages[2]).toContain("Page 3 of 4");
    expect(pages[2]).not.toContain("Page 3 of 3");
    expect(pages[2]).toContain("Second page");
    expect(pages[3]).toContain("ORIGINAL-FOOTER");
    expect(pages[3]).not.toContain("Page 4 of 4");
  });

  it("keeps the cover footer when the order id is long", async () => {
    const orderId = "123e4567-e89b-12d3-a456-426614174000";
    const rendered = await renderOrderPdfs({
      orderId,
      sourceLanguage: "es",
      date: "2026-10-12",
      pages: [{ combinedPageNumber: 1, widthPt: 612, heightPt: 792, paragraphs: ["Hello diploma"] }],
    });
    const merged = await mergeCertifiedPacket({
      certification: rendered.certification,
      translation: rendered.cleanTranslation,
      original: await blankPage("ORIGINAL-FOOTER"),
      orderId,
    });
    const pages = await pageText(merged);
    expect(pages[0]).toContain(BRAND_FOOTER);
    expect(pages[0]).toContain(`Order ${orderId} · Page 1 of 3`);
    expect(pages[0]).not.toContain("Page 1 of 2");
    expect(pages[1]).toContain(`Page 2 of 3`);
  });
});
