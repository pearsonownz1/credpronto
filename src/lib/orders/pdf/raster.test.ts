import { PDFDocument, rgb } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { PREVIEW_WATERMARK } from "../constants";
import { CHECKOUT_PREVIEW_EDGE_PX } from "../checkout-preview";
import { renderOrderPdfs } from "./render";
import { renderPdfPagePng } from "./raster";

async function paintPage(doc: PDFDocument, color: { r: number; g: number; b: number }) {
  const page = doc.addPage([200, 400]);
  page.drawRectangle({ x: 0, y: 0, width: 200, height: 400, color: rgb(color.r, color.g, color.b) });
}

describe("preview page png", () => {
  it("rasterizes page 1 at about 1000px on the long side", async () => {
    const doc = await PDFDocument.create();
    await paintPage(doc, { r: 1, g: 0, b: 0 });
    await paintPage(doc, { r: 0, g: 0, b: 1 });
    const png = await renderPdfPagePng(await doc.save());
    expect(Buffer.from(png.subarray(0, 8)).toString("hex")).toBe("89504e470d0a1a0a");
    const meta = await sharp(png).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(CHECKOUT_PREVIEW_EDGE_PX);
    const stats = await sharp(png).stats();
    expect(stats.channels[0]?.mean).toBeGreaterThan(200);
    expect(stats.channels[2]?.mean).toBeLessThan(40);
  });

  it("keeps the watermark that is absent from the clean final", async () => {
    const rendered = await renderOrderPdfs({
      orderId: "order-1",
      sourceLanguage: "fr",
      date: "2026-10-12",
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          paragraphs: ["Diplome"],
        },
      ],
    });
    expect(PREVIEW_WATERMARK).toContain("PREVIEW");
    const preview = await renderPdfPagePng(rendered.watermarkedPreview);
    const clean = await renderPdfPagePng(rendered.cleanTranslation);
    const previewTint = await blueTint(preview);
    const cleanTint = await blueTint(clean);
    expect(previewTint).toBeGreaterThan(500);
    expect(cleanTint).toBeLessThan(30);
    expect(previewTint).toBeGreaterThan(cleanTint * 20);
  });
});

async function blueTint(png: Uint8Array): Promise<number> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let tinted = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const red = data[i] ?? 0;
    const blue = data[i + 2] ?? 0;
    if (blue > red + 8 && blue > 180 && red < 250) tinted += 1;
  }
  return tinted;
}
