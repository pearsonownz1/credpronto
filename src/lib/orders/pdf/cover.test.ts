import { describe, expect, it } from "vitest";
import {
  COVER_ADDRESS,
  coverClientName,
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
    expect(cover.statement).toContain("competent to translate from Spanish into English");
    expect(cover.statement).toContain("complete and accurate");
    expect(cover.issued).toBe("October 11, 2026");
    expect(cover.pageCount).toBe(4);
    expect(COVER_ADDRESS).toContain("Sacramento, CA 95833");
    expect(cover.clientName).toBe("María Ruiz");
  });
});
