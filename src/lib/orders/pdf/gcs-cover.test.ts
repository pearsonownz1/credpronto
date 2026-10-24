import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { GCS_CERTIFICATION_STATEMENTS, GCS_FOOTER, GCS_SIGNER } from "../gcs";
import { PREVIEW_WATERMARK } from "../constants";
import { renderCertificationPdf, renderOrderPdfs } from "./render";

async function visibleText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const extracted = await extractText(pdf, { mergePages: true });
  return Array.isArray(extracted.text) ? extracted.text.join(" ") : extracted.text;
}

const ORDER_ID = "00000000-0000-4000-8000-000000000000";

describe("GCS certificate", () => {
  it("prints the GEO Credential Services cover and leaves CredPronto off the page", async () => {
    const pdf = await renderCertificationPdf({
      brand: "gcs",
      orderId: ORDER_ID,
      sourceLanguage: "es",
      targetLanguage: "en",
      date: "2026-10-23",
      clientName: "Jane Example",
      documents: [{ name: "Birth Certificate", sourcePages: 2, translatedPages: 2 }],
      pricedPages: 2,
      pages: [
        { combinedPageNumber: 1, widthPt: 612, heightPt: 792, paragraphs: ["Page one"] },
        { combinedPageNumber: 2, widthPt: 612, heightPt: 792, paragraphs: ["Page two"] },
      ],
    });
    const text = await visibleText(pdf);
    expect(text).toContain("Certificate of Translation Accuracy");
    expect(text).toContain("Prepared for Jane Example");
    expect(text).toContain("CERTIFIED TRANSLATION");
    expect(text).toContain("Spanish to English · 1 document · 2 pages");
    expect(text).toContain("support@gcs.org | www.gcs.org");
    expect(text).toContain("CORPORATE MEMBER OF");
    expect(text).toContain(`Order ${ORDER_ID}`);
    expect(text).toContain("Certified translation");
    expect(text).toContain("Issued October 23, 2026");
    expect(text).toContain("Birth Certificate");
    expect(text).toContain("SOURCE PAGES");
    expect(text).toContain("TRANSLATED PAGES");
    expect(text).toContain(GCS_CERTIFICATION_STATEMENTS[0].slice(0, 80));
    expect(text).toContain(GCS_SIGNER);
    expect(text).toContain("Order Date: October 23, 2026");
    expect(text).toContain("1489 W. Palmetto Park Road");
    expect(text).toContain("Suite 500");
    expect(text).toContain("Boca Raton, FL");
    expect(text).toContain(GCS_FOOTER);
    expect(text).toContain(`Page 1 of 3`);
    expect(text).not.toContain("CredPronto");
    expect(text).not.toContain(PREVIEW_WATERMARK);
    expect(text).not.toContain("PREVIEW");
  });

  it("puts the unwatermarked cover on page 1 and the GCS letterhead on the translation", async () => {
    const rendered = await renderOrderPdfs({
      brand: "gcs",
      orderId: ORDER_ID,
      sourceLanguage: "es",
      targetLanguage: "en",
      date: "2026-10-23",
      clientName: "Jane Example",
      documents: [{ name: "Birth Certificate", sourcePages: 1, translatedPages: 1 }],
      pricedPages: 1,
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          paragraphs: ["Acta de nacimiento traducida."],
        },
      ],
    });
    expect(rendered.watermarkedPreview).toEqual(rendered.cleanTranslation);
    const text = await visibleText(rendered.cleanTranslation);
    expect(text).toContain("Certificate of Translation Accuracy");
    expect(text).toContain("Acta de nacimiento traducida.");
    expect(text).toContain("Page 1 of 2");
    expect(text).toContain("Page 2 of 2");
    expect(text).toContain("support@gcs.org | www.gcs.org");
    expect(text).not.toContain(PREVIEW_WATERMARK);
    expect(text).not.toContain("CredPronto");
  });
});
