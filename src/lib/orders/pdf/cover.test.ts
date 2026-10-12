import { describe, expect, it } from "vitest";
import {
  CERTIFICATION_STATEMENTS,
  COVER_ADDRESS,
  COVER_ADDRESS_LINES,
  coverClientName,
  loadAtaLogo,
  coverDocuments,
  coverSignature,
  coverTranslatorName,
  formatCoverDate,
  resolveCover,
} from "./cover";

describe("certification cover", () => {
  it("uses the approving staff member, then the configured translator", () => {
    expect(coverTranslatorName("Ada Lovelace", "Configured")).toBe("Ada Lovelace");
    expect(coverTranslatorName("  ", "Configured")).toBe("Configured");
    expect(coverTranslatorName(null, "  ")).toBe("CredPronto");
  });

  it("keeps a signature only for the configured translator", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(coverSignature(null, bytes, "Configured")).toBe(bytes);
    expect(coverSignature("Configured", bytes, "Configured")).toBe(bytes);
    expect(coverSignature("Ada Lovelace", bytes, "Configured")).toBeNull();
    expect(coverSignature("Ada Lovelace", bytes, "")).toBeNull();
    expect(coverSignature(null, new Uint8Array(), "Configured")).toBeNull();
  });

  it("fills the cover from the order instead of the sample comp", () => {
    expect(formatCoverDate("2026-10-11")).toBe("October 11, 2026");
    expect(coverClientName([{ fieldKey: "full_name", confirmedValue: "María Ruiz" }], "a@b.co")).toBe("María Ruiz");
    expect(coverClientName([{ fieldKey: "full_name", confirmedValue: " " }], "a@b.co")).toBe("a@b.co");
    expect(
      coverDocuments(
        [{ id: "doc-1", filename: "acta.pdf" }],
        [{ documentId: "doc-1" }, { documentId: "doc-1" }],
        new Map([["doc-1", 2]]),
      ),
    ).toEqual([{ name: "acta.pdf", sourcePages: 2, translatedPages: 2 }]);

    const cover = resolveCover({
      orderId: "order-1",
      sourceLanguage: "es",
      targetLanguage: "en",
      date: "2026-10-11",
      clientName: "María Ruiz",
      translatorName: "Ada Lovelace",
      documents: [
        { name: "acta.pdf", sourcePages: 1, translatedPages: 1 },
        { name: "diploma.pdf", sourcePages: 2, translatedPages: 2 },
      ],
      pages: [
        { combinedPageNumber: 1, widthPt: 612, heightPt: 792, paragraphs: ["a"] },
        { combinedPageNumber: 2, widthPt: 612, heightPt: 792, paragraphs: ["b"] },
        { combinedPageNumber: 3, widthPt: 612, heightPt: 792, paragraphs: ["c"] },
      ],
    });
    expect(cover.summary).toBe("Spanish to English · 2 documents · 3 pages");
    expect(cover.statements).toEqual(CERTIFICATION_STATEMENTS);
    expect(cover.statements[0]).toBe(
      "As an authorized representative of CredPronto, a professional translation services agency, I hereby certify that the above-mentioned document has been translated by an experienced, qualified and competent professional translator, fluent in the above-mentioned language pair and that, in my best judgment, the translated text truly reflects the content, meaning, and style of the original text and constitutes in every respect a complete and accurate translation of the original document. This document has not been translated for a family member, friend, or business associate.",
    );
    expect(cover.statements[1]).toBe(
      "This is to certify the correctness of the translation only. I do not make any claims or guarantees about the authenticity or content of the original document. Further, CredPronto assumes no liability for the way in which the translation is used by the customer or any third party, including end-users of the translation.",
    );
    expect(cover.statements.join(" ")).not.toContain("Intended use");
    expect(cover.issued).toBe("October 11, 2026");
    expect(cover.pageCount).toBe(4);
    expect(COVER_ADDRESS).toBe("2520 Venture Oaks Way, Suite 120, Sacramento, CA 95833");
    expect(COVER_ADDRESS_LINES).toEqual(["2520 Venture Oaks Way, Suite 120", "Sacramento, CA 95833"]);
    const ata = loadAtaLogo();
    expect(Array.from(ata.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(cover.clientName).toBe("María Ruiz");
  });
});
