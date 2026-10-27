import { describe, expect, it } from "vitest";
import { EMPTY_TRANSLATION_MESSAGE, emptyTranslationMessage, mergeEditedPages, paragraphsForPage, storedPageLayout } from "./translation-edit";

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

  it("refuses release when every paragraph is blank", () => {
    expect(emptyTranslationMessage([])).toBe(EMPTY_TRANSLATION_MESSAGE);
    expect(emptyTranslationMessage([{ paragraphs: ["  "] }, { paragraphs: [] }])).toBe(EMPTY_TRANSLATION_MESSAGE);
    expect(emptyTranslationMessage([{ paragraphs: ["  "] }, { paragraphs: ["Certified translation"] }])).toBeNull();
  });

  it("keeps stored blocks on an unedited page and drops them on a line edit", () => {
    const table = { type: "table" as const, header: true, rows: [["Course", "Grade"], ["Law", "A"]] };
    const withBlocks = [
      { ...current[0], blocks: [table], kind: "certificate" as const },
      current[1],
    ];
    const lineEdit = mergeEditedPages(withBlocks, [
      { documentId: "doc-1", pageNumber: 2, paragraphs: ["Corrected page two"] },
    ]);
    expect(lineEdit.ok).toBe(true);
    if (!lineEdit.ok) return;
    expect(lineEdit.pages[0]?.blocks).toEqual([table]);
    expect(lineEdit.pages[0]?.kind).toBe("certificate");
    expect(lineEdit.pages[1]?.blocks).toBeUndefined();
    expect(lineEdit.pages[1]?.paragraphs).toEqual(["Corrected page two"]);

    const replaced = mergeEditedPages(withBlocks, [
      { documentId: "doc-1", pageNumber: 1, paragraphs: ["Plain correction"] },
    ]);
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.pages[0]?.blocks).toBeUndefined();
    expect(replaced.pages[0]?.kind).toBe("certificate");
    expect(replaced.pages[1]?.paragraphs).toEqual(["Original page two"]);
  });

  it("uses blocks sent by the table editor", () => {
    const next = { type: "table" as const, header: false, rows: [["Law", "B"]] };
    const merged = mergeEditedPages(current, [
      { documentId: "doc-1", pageNumber: 1, paragraphs: ["Law B"], blocks: [next], kind: "form" },
    ]);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.pages[0]?.blocks).toEqual([next]);
    expect(merged.pages[0]?.kind).toBe("form");
    expect(merged.pages[1]?.paragraphs).toEqual(["Original page two"]);
  });

  it("reads stored blocks without inventing them from paragraphs", () => {
    const output = {
      pages: [
        { pageNumber: 1, paragraphs: ["Hello"], blocks: [{ type: "seal", text: "Registrar", column: "right" }] },
        { pageNumber: 2, paragraphs: ["World"] },
      ],
    };
    expect(storedPageLayout(output, { pageNumber: 1 })).toEqual({
      blocks: [{ type: "seal", text: "Registrar", column: "right" }],
      kind: null,
    });
    expect(storedPageLayout(output, { pageNumber: 2 })).toEqual({ kind: null });
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
