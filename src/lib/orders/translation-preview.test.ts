import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { PREVIEW_WATERMARK } from "./constants";
import { needsBundledTranslation } from "./evaluation-price";
import {
  evaluationPreviewObjects,
  translationPreviewBytes,
  translationPreviewRecord,
} from "./evaluation";
import { renderOrderPdfs } from "./pdf/render";

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const proxy = await getDocumentProxy(copyBytes(bytes));
  const extracted = await extractText(proxy, { mergePages: true });
  return Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
}

describe("evaluation translation preview", () => {
  it("names the translation preview beside the report and gives it a separate preview row", () => {
    expect(evaluationPreviewObjects("order-1", 2)).toEqual({
      reportPath: "order-1/report-v2.pdf",
      translationPreviewPath: "order-1/translation-preview-v2.pdf",
    });
    expect(
      translationPreviewRecord({ orderId: "order-1", reportVersion: 2, rowVersion: 3 }),
    ).toEqual({
      version: 3,
      previewPath: "order-1/translation-preview-v2.pdf",
    });
    expect(() =>
      translationPreviewRecord({ orderId: "order-1", reportVersion: 2, rowVersion: 2 }),
    ).toThrow(/own preview version/);
    expect(needsBundledTranslation("es")).toBe(true);
    expect(needsBundledTranslation("en")).toBe(false);
    expect(needsBundledTranslation(null)).toBe(false);
  });

  it("stores the watermarked translation pass and leaves off the certification cover", async () => {
    const rendered = await renderOrderPdfs({
      orderId: "order-1",
      sourceLanguage: "es",
      targetLanguage: "en",
      date: "2026-10-12",
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          paragraphs: ["Licenciatura en Administración de Empresas"],
        },
      ],
    });
    const stored = translationPreviewBytes(rendered);
    expect(stored).toEqual(rendered.watermarkedPreview);
    expect(stored).not.toEqual(rendered.cleanTranslation);
    expect(stored).not.toEqual(rendered.certification);

    const text = await pdfText(stored);
    expect(text).toContain("Licenciatura en Administración de Empresas");
    expect(text).toContain(PREVIEW_WATERMARK);
    expect(text).not.toContain("Certificate of Translation Accuracy");
  });
});
