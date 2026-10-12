import { extractText, getDocumentProxy } from "unpdf";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PREVIEW_WATERMARK, PREVIEW_WATERMARK_OPACITY, previewWatermarkRgb } from "../constants";
import { buildCombinedOriginal } from "./combine";
import { translationRenderPasses } from "./layout";
import { renderOrderPdfs } from "./render";

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pageCount: number }> {
  const proxy = await getDocumentProxy(bytes);
  const extracted = await extractText(proxy, { mergePages: false });
  return { text: extracted.text.join("\n"), pageCount: extracted.totalPages };
}

describe("translated pdf renders", () => {
  it("bakes the watermark into a separate preview and leaves it off the clean file", async () => {
    const passes = translationRenderPasses();
    expect(passes[1]).toMatchObject({
      watermark: true,
      includeCertification: false,
      bucket: "previews",
    });
    expect(passes[0].bucket).toBe("finals");
    expect(passes[0].watermark).toBe(false);

    const rendered = await renderOrderPdfs({
      orderId: "order-1",
      sourceLanguage: "es",
      date: "2026-10-12",
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          paragraphs: ["Hello diploma"],
        },
      ],
    });

    expect(rendered.watermarkedPreview).not.toEqual(rendered.cleanTranslation);

    const preview = await pdfText(rendered.watermarkedPreview);
    const clean = await pdfText(rendered.cleanTranslation);
    const certification = await pdfText(rendered.certification);

    expect(preview.pageCount).toBe(1);
    expect(clean.pageCount).toBe(1);
    expect(preview.text).toContain("Hello diploma");
    expect(PREVIEW_WATERMARK).toBe("PREVIEW · CREDPRONTO · NOT FOR OFFICIAL USE");
    expect(PREVIEW_WATERMARK_OPACITY).toBeCloseTo(0.16);
    expect(previewWatermarkRgb()).toEqual({ r: 0x1f / 255, g: 0x5e / 255, b: 0xff / 255 });
    expect(preview.text).toContain(PREVIEW_WATERMARK);
    expect(preview.text).not.toContain("Translator certification");
    expect(clean.text).toContain("Hello diploma");
    expect(clean.text).not.toContain("PREVIEW");
    expect(certification.text).toContain("Translator certification");
    expect(certification.text).toContain("order-1");
  });
});

describe("combined original", () => {
  it("keeps upload order and gives the viewer one page per original side", async () => {
    const src = await PDFDocument.create();
    src.addPage([200, 400]);
    src.addPage([300, 500]);
    const pdf = await src.save();

    const combined = await buildCombinedOriginal([
      { bytes: pdf, mime: "application/pdf" },
      { bytes: PNG, mime: "image/png" },
    ]);

    expect(combined.pages.map((page) => page.sourcePage)).toEqual([1, 2, 1]);
    expect(combined.pages.map((page) => [page.widthPt, page.heightPt])).toEqual([
      [200, 400],
      [300, 500],
      [612, 792],
    ]);

    const loaded = await PDFDocument.load(combined.pdf);
    expect(loaded.getPageCount()).toBe(3);
  });
});
