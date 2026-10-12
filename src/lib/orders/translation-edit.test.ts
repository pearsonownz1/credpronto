import { describe, expect, it } from "vitest";
import { mergeEditedPages, paragraphsForPage } from "./translation-edit";

const current = [
  {
    documentId: "doc-1",
    pageNumber: 1,
    combinedPageNumber: 1,
    widthPt: 612,
    heightPt: 792,
    paragraphs: ["Original page one"],
  },
  {
    documentId: "doc-1",
    pageNumber: 2,
    combinedPageNumber: 2,
    widthPt: null,
    heightPt: null,
    paragraphs: ["Original page two"],
  },
];

describe("translation edits", () => {
  it("reads paragraphs for a document page", () => {
    expect(
      paragraphsForPage(
        {
          pages: [
            { pageNumber: 1, combinedPageNumber: 1, paragraphs: ["Hello"] },
            { pageNumber: 2, combinedPageNumber: 2, paragraphs: ["World"] },
          ],
        },
        { pageNumber: 2, combinedPageNumber: 2 },
      ),
    ).toEqual(["World"]);
  });

  it("replaces only the edited page and keeps the other text", () => {
    const merged = mergeEditedPages(current, [
      { documentId: "doc-1", pageNumber: 2, paragraphs: ["  Corrected page two  "] },
    ]);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.edited).toBe(1);
    expect(merged.pages.map((page) => page.paragraphs)).toEqual([["Original page one"], ["Corrected page two"]]);
    expect(merged.pages[1]?.widthPt).toBe(612);
  });

  it("rejects an unknown page and an empty edit", () => {
    expect(mergeEditedPages(current, []).ok).toBe(false);
    expect(
      mergeEditedPages(current, [{ documentId: "missing", pageNumber: 1, paragraphs: ["x"] }]).ok,
    ).toBe(false);
    expect(
      mergeEditedPages(current, [{ documentId: "doc-1", pageNumber: 1, paragraphs: ["  "] }]).ok,
    ).toBe(false);
  });
});
