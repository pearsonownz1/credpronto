import { inflateSync } from "node:zlib";
import { extractText, getDocumentProxy } from "unpdf";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { GCS_CERTIFICATION_STATEMENTS, GCS_FOOTER, GCS_SIGNER } from "../gcs";
import { PREVIEW_WATERMARK } from "../constants";
import { loadGcsSignature } from "./gcs-cover";
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
    expect(text).toContain("Order number");
    expect(text).toContain("Language pair");
    expect(text).toContain("Spanish to English");
    expect(text).toContain("Pages");
    expect(text).toContain("ORDER");
    expect(text).toContain("CERTIFICATION");
    expect(text).not.toContain("Birth Certificate");
    expect(text).not.toContain("SOURCE PAGES");
    expect(text).not.toContain("TRANSLATED PAGES");
    expect(text).not.toContain("DOCUMENT");
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
    expect(text).not.toContain("SOURCE PAGES");
    expect(text).not.toContain("TRANSLATED PAGES");
    expect(text).not.toContain(PREVIEW_WATERMARK);
    expect(text).not.toContain("CredPronto");
  });

  it("embeds the flattened signature instead of a solid rectangle", async () => {
    const signature = loadGcsSignature();
    expect(signature.byteLength).toBeGreaterThan(1000);

    const pdf = await renderCertificationPdf({
      brand: "gcs",
      orderId: ORDER_ID,
      sourceLanguage: "es",
      targetLanguage: "en",
      date: "2026-10-23",
      clientName: "Jane Example",
      documents: [{ name: "Birth Certificate", sourcePages: 1, translatedPages: 1 }],
      pricedPages: 1,
      pages: [{ combinedPageNumber: 1, widthPt: 612, heightPt: 792, paragraphs: ["Page one"] }],
    });
    const embedded = await embeddedSignature(pdf);
    expect(embedded.width).toBe(201);
    expect(embedded.height).toBe(106);
    expect(embedded.colorSpace).toBe("/DeviceRGB");
    expect(embedded.softMask).toBe(false);
    expect(embedded.samples.length).toBe(201 * 106 * 3);
    const colors = new Set<string>();
    let white = 0;
    let ink = 0;
    for (let index = 0; index < embedded.samples.length; index += 3) {
      const red = embedded.samples[index] ?? 0;
      const green = embedded.samples[index + 1] ?? 0;
      const blue = embedded.samples[index + 2] ?? 0;
      if (red > 250 && green > 250 && blue > 250) white += 1;
      if (red < 40 && green < 50 && blue < 70) ink += 1;
      if (colors.size < 8) colors.add(`${red},${green},${blue}`);
    }
    expect(colors.size).toBeGreaterThan(1);
    expect(white).toBeGreaterThan(100);
    expect(ink).toBeGreaterThan(20);
  });
});

function pdfNumber(value: unknown): number {
  if (value && typeof value === "object" && "asNumber" in value) {
    const read = (value as { asNumber: () => number }).asNumber;
    if (typeof read === "function") return read.call(value);
  }
  return Number.NaN;
}

async function embeddedSignature(bytes: Uint8Array): Promise<{
  width: number;
  height: number;
  colorSpace: string;
  softMask: boolean;
  samples: Uint8Array;
}> {
  const doc = await PDFDocument.load(bytes);
  for (const page of doc.getPages()) {
    const resources = page.node.Resources();
    const xobjects = resources?.lookup(PDFName.of("XObject"), PDFDict);
    if (!xobjects) continue;
    for (const key of xobjects.keys()) {
      const stream = xobjects.lookup(key);
      if (!(stream instanceof PDFRawStream)) continue;
      const subtype = String(stream.dict.lookup(PDFName.of("Subtype")));
      if (subtype !== "/Image") continue;
      const width = pdfNumber(stream.dict.lookup(PDFName.of("Width")));
      const height = pdfNumber(stream.dict.lookup(PDFName.of("Height")));
      if (width !== 201 || height !== 106) continue;
      const filter = String(stream.dict.lookup(PDFName.of("Filter")) ?? "");
      const packed = filter.includes("FlateDecode") ? inflateSync(stream.contents) : stream.contents;
      return {
        width,
        height,
        colorSpace: String(stream.dict.lookup(PDFName.of("ColorSpace"))),
        softMask: stream.dict.has(PDFName.of("SMask")),
        samples: packed,
      };
    }
  }
  throw new Error("GCS cover did not embed the signature image");
}
