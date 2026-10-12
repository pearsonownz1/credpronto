import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { billableUnits, countCjkUnits, totalCents } from "./billing";
import { UNIT_PRICE_CENTS } from "./constants";
import { pdfPageTexts } from "./pdf-text";
import { countWords } from "./words";

async function pdfWithPages(pageCount: number, wordsPerPage: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const text = Array.from({ length: wordsPerPage }, () => "alpha").join(" ");
  for (let index = 0; index < pageCount; index += 1) {
    const page = doc.addPage([612, 792]);
    page.drawText(text, { x: 48, y: 740, size: 11, font, maxWidth: 516 });
  }
  return doc.save();
}

describe("three-page PDF billing", () => {
  it("counts 3 sides and bills $29.85 when each side is within 250 words", async () => {
    const bytes = await pdfWithPages(3, 40);
    const texts = await pdfPageTexts(bytes);
    expect(texts).toHaveLength(3);
    const pages = texts.map((text) => billableUnits(countCjkUnits(text)));
    expect(pages).toEqual([1, 1, 1]);
    expect(pages.reduce((sum, page) => sum + page, 0)).toBe(3);
    expect(totalCents(3, UNIT_PRICE_CENTS)).toBe(2985);
  });

  it("still bills one page per side when each side is 251 words", async () => {
    const bytes = await pdfWithPages(3, 251);
    const texts = await pdfPageTexts(bytes);
    expect(texts).toHaveLength(3);
    expect(texts.every((text) => countWords(text) === 251)).toBe(true);
    const pages = texts.map((text) => billableUnits(countCjkUnits(text)));
    expect(pages).toEqual([1, 1, 1]);
    expect(pages.reduce((sum, page) => sum + page, 0)).toBe(3);
    expect(totalCents(3, UNIT_PRICE_CENTS)).toBe(2985);
  });
});
