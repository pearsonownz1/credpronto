import { inflateSync } from "node:zlib";
import { extractText, extractTextItems, getDocumentProxy } from "unpdf";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, type PDFPage } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { GCS_CERTIFICATION_STATEMENTS, GCS_FOOTER, GCS_SIGNER } from "../gcs";
import { PREVIEW_WATERMARK } from "../constants";
import { gcsBodyTopInset, gcsLetterheadRuleY, loadGcsSignature } from "./gcs-cover";
import { renderCertificationPdf, renderOrderPdfs } from "./render";
import { structurePage } from "./structure";

async function visibleText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const extracted = await extractText(pdf, { mergePages: true });
  return Array.isArray(extracted.text) ? extracted.text.join(" ") : extracted.text;
}

const ORDER_ID = "00000000-0000-4000-8000-000000000000";

describe("GCS letterhead clearance", () => {
  it("uses one inset for transcripts, letters, and certificates", () => {
    expect(gcsBodyTopInset(null)).toBe(72);
    expect(gcsBodyTopInset("letter")).toBe(72);
    expect(gcsBodyTopInset("certificate")).toBe(72);
    expect(gcsLetterheadRuleY(792)).toBe(792 - 88);
  });

  it("keeps a heading and table below the letterhead rule and above the footer", async () => {
    const rows = [
      ["Course", "Title", "Grade", "Credits"],
      ...Array.from({ length: 28 }, (_, index) => [`MCB-${8800 + index}`, `Thesis research activity ${index + 1}`, "T", "12"]),
    ];
    const pdf = await renderOrderPdfs({
      brand: "gcs",
      orderId: ORDER_ID,
      sourceLanguage: "fr",
      targetLanguage: "en",
      date: "2026-10-23",
      clientName: "Zeineb M'hamdi",
      documents: [{ name: "Transcript", sourcePages: 1, translatedPages: 1 }],
      pricedPages: 1,
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          paragraphs: [],
          kind: "form",
          blocks: [
            { type: "heading", text: "UNIVERSITÉ LAVAL", level: 1 },
            { type: "box", label: "Record", value: "111 094 267", column: "left" },
            { type: "box", label: "Cycle", value: "3", column: "right" },
            { type: "seal", text: "Université Laval", column: "right" },
            { type: "table", rows, header: true },
          ],
        },
      ],
    });
    const text = await visibleText(pdf.cleanTranslation);
    expect(text).toContain("UNIVERSITÉ LAVAL");
    expect(text).toContain("[SEAL]");
    expect(text).toContain("Université Laval");
    expect(text).toContain("111 094 267");
    expect(text).toContain("MCB-8800");
    expect(text).not.toContain("[Seal:");

    const doc = await PDFDocument.load(pdf.cleanTranslation);
    const page = doc.getPage(1);
    const { height } = page.getSize();
    const ruleY = gcsLetterheadRuleY(height);
    const extracted = await extractTextItems(new Uint8Array(pdf.cleanTranslation));
    const items = extracted.items[1] ?? [];
    const chrome = /support@gcs\.org|www\.gcs\.org|CORPORATE|GEO Credential|Page \d|Order /;
    const body = items.filter((item) => item.str.trim() && item.y >= 36 && !chrome.test(item.str));
    expect(body.length).toBeGreaterThan(3);
    const highest = Math.max(...body.map((item) => item.y + Math.max(item.height, 8)));
    expect(ruleY - highest).toBeGreaterThanOrEqual(18);
    const lowest = Math.min(...body.map((item) => item.y));
    expect(lowest).toBeGreaterThan(40);

    const rules = horizontalRules(pageContent(page)).filter((y) => y < ruleY - 2 && y > 42);
    expect(rules.length).toBeGreaterThan(0);
    expect(ruleY - Math.max(...rules)).toBeGreaterThanOrEqual(18);
  });

  it("turns [SEAL] and pipe rows into a stamp and a table", () => {
    const blocks = structurePage(["UNIVERSITÉ LAVAL", "Last name, first name: M'hamdi, Zeineb", "[SEAL]", "Course | Title | Grade", "MCB-8853 | Thesis research activity 3 | T"].join("\n"));
    expect(blocks.some((block) => block.type === "seal" && block.text === "")).toBe(true);
    const table = blocks.find((block) => block.type === "table");
    expect(table).toMatchObject({
      type: "table",
      header: true,
      rows: [
        ["Course", "Title", "Grade"],
        ["MCB-8853", "Thesis research activity 3", "T"],
      ],
    });
    expect(blocks.some((block) => block.type === "fields" && block.rows.some((row) => row.value.includes("M'hamdi")))).toBe(true);
  });
});

function pageContent(page: PDFPage): string {
  const contents = page.node.Contents();
  const streams: PDFRawStream[] = [];
  if (contents instanceof PDFRawStream) streams.push(contents);
  else if (contents instanceof PDFArray) {
    for (const entry of contents.asArray()) {
      const stream = entry instanceof PDFRawStream ? entry : page.node.context.lookup(entry);
      if (stream instanceof PDFRawStream) streams.push(stream);
    }
  }
  let text = "";
  for (const stream of streams) {
    const filter = String(stream.dict.lookup(PDFName.of("Filter")) ?? "");
    const bytes = filter.includes("FlateDecode") ? inflateSync(stream.contents) : stream.contents;
    text += Buffer.from(bytes).toString("latin1");
  }
  return text;
}

function horizontalRules(content: string): number[] {
  const rules: number[] = [];
  const pattern = /([\d.]+) ([\d.]+) m\s+([\d.]+) ([\d.]+) l/g;
  for (const match of content.matchAll(pattern)) {
    const y1 = Number(match[2]);
    const y2 = Number(match[4]);
    const x1 = Number(match[1]);
    const x2 = Number(match[3]);
    if (!Number.isFinite(y1) || Math.abs(y1 - y2) > 0.2) continue;
    if (Math.abs(x2 - x1) < 40) continue;
    rules.push(y1);
  }
  return rules;
}

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
