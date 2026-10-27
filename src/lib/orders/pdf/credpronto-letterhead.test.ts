import { extractText, extractTextItems, getDocumentProxy } from "unpdf";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { BRAND_FOOTER } from "../brand";
import { PREVIEW_WATERMARK } from "../constants";
import { CREDPRONTO_LETTERHEAD_CONTACT } from "./cover";
import { GCS_LETTERHEAD_BODY_CLEARANCE, gcsLetterheadRuleY } from "./gcs-cover";
import { renderOrderPdfs } from "./render";

const ORDER_ID = "00000000-0000-4000-8000-0000000000aa";

const BANNED = [
  "G" + "uy",
  "P" + "earson",
  "GC" + "S",
  "gc" + "s.org",
  "GEO " + "Credential Services",
  "Boca " + "Raton",
];

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const extracted = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: false });
  return extracted.text;
}

function expectNoForeignBrand(text: string) {
  const haystack = text.toLowerCase();
  for (const term of BANNED) {
    expect(haystack, term).not.toContain(term.toLowerCase());
  }
  expect(text).not.toContain("1489 W. Palmetto Park Road");
}

describe("CredPronto translated body letterhead", () => {
  it("draws the CredPronto letterhead on clean and preview pages and leaves GCS off them", async () => {
    const rendered = await renderOrderPdfs({
      orderId: ORDER_ID,
      sourceLanguage: "es",
      targetLanguage: "en",
      date: "2026-10-23",
      clientName: "Ada Example",
      documents: [{ name: "Diploma", sourcePages: 1, translatedPages: 1 }],
      pricedPages: 1,
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          paragraphs: ["Hello diploma"],
          blocks: [
            { type: "heading", text: "FACULTY OF LAW", level: 1 },
            { type: "paragraph", text: "Hello diploma" },
          ],
        },
      ],
    });

    expect(rendered.watermarkedPreview).not.toEqual(rendered.cleanTranslation);
    const cleanPages = await pageTexts(rendered.cleanTranslation);
    const previewPages = await pageTexts(rendered.watermarkedPreview);
    expect(cleanPages).toHaveLength(2);
    expect(previewPages).toHaveLength(1);

    const body = cleanPages[1] ?? "";
    const preview = previewPages[0] ?? "";
    for (const page of [body, preview]) {
      expect(page).toContain(CREDPRONTO_LETTERHEAD_CONTACT);
      expect(page).toContain("support@credpronto.com | www.credpronto.com");
      expect(page).toContain("CORPORATE MEMBER OF");
      expect(page).toContain("Hello diploma");
      expect(page).toContain("FACULTY OF LAW");
      expectNoForeignBrand(page);
    }

    expect(cleanPages[0]).toContain(BRAND_FOOTER);
    expect(cleanPages[0]).toContain("2520 Venture Oaks Way, Suite 120, Sacramento, CA 95833");
    expect(body).toContain(`Order ${ORDER_ID.slice(0, 8)} · Page 2 of 2`);
    expect(body).not.toContain(PREVIEW_WATERMARK);
    expect(preview).toContain(PREVIEW_WATERMARK);
    expect(preview).not.toContain("Certificate of Translation Accuracy");
    expect(preview).not.toContain("2520 Venture Oaks Way");
    expectNoForeignBrand(cleanPages.join("\n"));

    const previewSource = Buffer.from(rendered.watermarkedPreview).toString("latin1");
    expect(previewSource).toContain("/Width 848");
    expect(previewSource).toContain("/Width 868");
    expect(previewSource).not.toContain("/Width 492");
    expect(previewSource).not.toContain("/Width 603");

    const doc = await PDFDocument.load(rendered.cleanTranslation, { updateMetadata: false });
    expect(doc.getAuthor()).toBe("CredPronto");
    expect(doc.getCreator()).toBe("CredPronto");
  });

  it("keeps headings, and a certificate title, below the letterhead rule", async () => {
    const course = ["MCB-8853", "3", "Thesis research activity 3", "T", "12"];
    const summary = ["Session total", "Credits registered: 12", "Credits earned: 12", "Average: N/A"];
    const header = ["Course", "Cycle", "Title", "Grade", "Credits"];
    for (const heightPt of [792, 400]) {
      const rendered = await renderOrderPdfs({
        orderId: ORDER_ID,
        sourceLanguage: "fr",
        targetLanguage: "en",
        date: "2026-10-23",
        clientName: "Ada Example",
        pages: [
          {
            combinedPageNumber: 1,
            widthPt: 612,
            heightPt,
            kind: "form",
            paragraphs: ["UNIVERSITE LAVAL"],
            blocks: [
              { type: "heading", text: "UNIVERSITE LAVAL", level: 1 },
              { type: "fields", rows: [{ label: "Student", value: "Ada Lovelace" }] },
              { type: "table", header: true, rows: [header, course, summary] },
            ],
          },
        ],
      });
      const extracted = await extractTextItems(new Uint8Array(rendered.cleanTranslation));
      const page = extracted.items[1] ?? [];
      const contact = page.find((item) => item.str.includes("support@credpronto.com"));
      const heading = page.find((item) => item.str.includes("UNIVERSITE"));
      expect(contact, `contact on ${heightPt}`).toBeTruthy();
      expect(heading, `heading on ${heightPt}`).toBeTruthy();
      if (!contact || !heading) continue;
      const fromBottom = contact.y > heading.y;
      const baseline = fromBottom ? heading.y : heightPt - heading.y - heading.fontSize;
      const ascender = baseline + heading.fontSize;
      const ruleY = gcsLetterheadRuleY(heightPt);
      expect(ascender, `ascender on ${heightPt}`).toBeLessThan(ruleY);
      expect(ruleY - ascender, `clearance on ${heightPt}`).toBeGreaterThanOrEqual(GCS_LETTERHEAD_BODY_CLEARANCE);
      expect(page.some((item) => item.str.includes(CREDPRONTO_LETTERHEAD_CONTACT))).toBe(true);
      expectNoForeignBrand(page.map((item) => item.str).join(" "));
    }

    const certificate = await renderOrderPdfs({
      orderId: ORDER_ID,
      sourceLanguage: "es",
      targetLanguage: "en",
      date: "2026-10-23",
      clientName: "Ada Example",
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          kind: "certificate",
          paragraphs: ["BIRTH CERTIFICATE"],
          blocks: [
            { type: "heading", text: "BIRTH CERTIFICATE", level: 1 },
            { type: "fields", rows: [{ label: "Name", value: "Ada Lovelace" }] },
          ],
        },
      ],
    });
    const extracted = await extractTextItems(new Uint8Array(certificate.cleanTranslation));
    const page = extracted.items[1] ?? [];
    const contact = page.find((item) => item.str.includes("support@credpronto.com"));
    const title = page.find((item) => /birth/i.test(item.str));
    expect(contact).toBeTruthy();
    expect(title).toBeTruthy();
    if (contact && title) {
      const fromBottom = contact.y > title.y;
      const baseline = fromBottom ? title.y : 792 - title.y - title.fontSize;
      const ascender = baseline + title.fontSize;
      const ruleY = gcsLetterheadRuleY(792);
      expect(ascender).toBeLessThan(ruleY);
      expect(ruleY - ascender).toBeGreaterThanOrEqual(GCS_LETTERHEAD_BODY_CLEARANCE);
    }
    const preview = (await pageTexts(certificate.watermarkedPreview))[0] ?? "";
    expect(preview).toContain(CREDPRONTO_LETTERHEAD_CONTACT);
    expect(preview).toContain(PREVIEW_WATERMARK);
    expectNoForeignBrand(preview);
  });

  it("does not put the CredPronto contact line on a GCS translation", async () => {
    const rendered = await renderOrderPdfs({
      brand: "gcs",
      orderId: ORDER_ID,
      sourceLanguage: "es",
      targetLanguage: "en",
      date: "2026-10-23",
      clientName: "Ada Example",
      pages: [{ combinedPageNumber: 1, widthPt: 612, heightPt: 792, paragraphs: ["Acta traducida"] }],
    });
    const text = (await pageTexts(rendered.cleanTranslation)).join("\n");
    expect(text).toContain("support@gcs.org | www.gcs.org");
    expect(text).not.toContain(CREDPRONTO_LETTERHEAD_CONTACT);
    expect(text).not.toContain("CredPronto");
    expect(text).not.toContain("2520 Venture Oaks Way");
  });
});
