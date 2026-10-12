import { extractText, getDocumentProxy } from "unpdf";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { BRAND_FOOTER, BRAND_NAME, BRAND_SIGNER } from "../brand";
import type { EvaluationResult } from "../types";
import { renderEvaluationPdfs } from "./evaluation";
import { renderCertificationPdf } from "./render";

/**
 * Pieces are joined so this file does not contain the legacy names.
 * The rendered page and its metadata must not contain them either.
 */
const BANNED = [
  "G" + "uy",
  "P" + "earson",
  "GC" + "S",
  "gc" + "s.org",
  "GEO " + "Credential Services",
  "Immi" + "Translate",
  "Zoo" + "ma",
  "Boca " + "Raton",
];

const diploma: EvaluationResult = {
  kind: "diploma",
  credentials: [
    {
      applicant: "Alex Example",
      institution: "Example University",
      country: "France",
      credential: "Licence",
      field: "Mathematics",
      dates: "2016–2019",
      usEquivalency: "Bachelor's degree",
      documentsReviewed: ["example.pdf"],
    },
  ],
};

async function visibleText(bytes: Uint8Array): Promise<string> {
  const proxy = await getDocumentProxy(bytes.slice());
  const extracted = await extractText(proxy, { mergePages: true });
  return Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
}

function expectClean(text: string, meta: { author?: string; creator?: string; producer?: string; title?: string }) {
  const haystack = [text, meta.author, meta.creator, meta.producer, meta.title].join("\n").toLowerCase();
  for (const term of BANNED) {
    expect(haystack).not.toContain(term.toLowerCase());
  }
  expect(text).toContain(BRAND_SIGNER);
  expect(text).toContain(BRAND_FOOTER);
  expect(meta.author).toBe(BRAND_NAME);
  expect(meta.creator).toBe(BRAND_NAME);
  expect(meta.producer).toBe(BRAND_NAME);
}

async function metaOf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return {
    author: doc.getAuthor(),
    creator: doc.getCreator(),
    producer: doc.getProducer(),
    title: doc.getTitle(),
  };
}

describe("cover brand", () => {
  it("renders a translation cover without legacy brand strings", async () => {
    const pdf = await renderCertificationPdf({
      orderId: "order-1",
      sourceLanguage: "es",
      targetLanguage: "en",
      date: "2026-10-11",
      clientName: "Alex Example",
      translatorName: "Ada Lovelace",
      documents: [{ name: "example.pdf", sourcePages: 1, translatedPages: 1 }],
      pages: [{ combinedPageNumber: 1, widthPt: 612, heightPt: 792, paragraphs: ["Example page"] }],
    });
    const text = await visibleText(pdf);
    expect(text).not.toContain("Ada Lovelace");
    expectClean(text, await metaOf(pdf));
  });

  it("renders an evaluation cover without legacy brand strings", async () => {
    const files = await renderEvaluationPdfs(diploma);
    const text = await visibleText(files.clean);
    expectClean(text, await metaOf(files.clean));
  });
});
