import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { countUploadPages, estimatedPageLabel, higherPageCount, sumUploadPages } from "./upload-pages";

async function pdfFile(pages: number): Promise<File> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) doc.addPage();
  const saved = await doc.save();
  const bytes = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;
  return new File([bytes], "diploma.pdf", { type: "application/pdf" });
}

describe("countUploadPages", () => {
  it("counts a photo as one page", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "scan.jpg", { type: "image/jpeg" });
    expect(await countUploadPages(file)).toBe(1);
  });

  it("counts every page of a PDF instead of one page per file", async () => {
    expect(await countUploadPages(await pdfFile(2))).toBe(2);
  });

  it("sums pages across PDFs and photos", async () => {
    const pdf = await pdfFile(2);
    const photo = new File([new Uint8Array([1, 2, 3])], "scan.png", { type: "image/png" });
    const counts = await Promise.all([countUploadPages(pdf), countUploadPages(photo)]);
    expect(counts).toEqual([2, 1]);
    expect(sumUploadPages(counts)).toBe(3);
    expect(estimatedPageLabel(3)).toBe("Estimated 3 pages");
  });

  it("keeps the higher count when pdf.js reports one page of a two-page PDF", () => {
    expect(higherPageCount([1, 2])).toBe(2);
    expect(higherPageCount([null, 2])).toBe(2);
  });

  it("does not invent a page count for a file the upload will not accept", async () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    expect(await countUploadPages(file)).toBeNull();
    expect(sumUploadPages([2, null])).toBeNull();
  });
});
