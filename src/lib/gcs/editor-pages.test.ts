import { describe, expect, it } from "vitest";
import { editorPagesFromTranslations, outputsAfterEdit, sanitizeEditorPages } from "./editor-pages";

describe("GCS editor pages", () => {
  it("keeps editable blocks and writes them back onto the latest translation", () => {
    const stored = {
      id: "tr-1",
      documentId: "doc-1",
      version: 2,
      output: {
        model: "kept",
        pages: [
          {
            pageNumber: 1,
            combinedPageNumber: 1,
            kind: "form",
            blocks: [
              { type: "heading", text: "UNIVERSITÉ LAVAL", level: 1 },
              { type: "signature", electronic: false, column: "right", lines: ["Registrar"] },
              { type: "seal", text: "Old seal", column: "left" },
            ],
          },
        ],
      },
    };
    const pages = editorPagesFromTranslations({
      translations: [
        { ...stored, id: "tr-old", version: 1, output: { pages: [{ pageNumber: 1, blocks: [{ type: "paragraph", text: "stale" }] }] } },
        stored,
      ],
      sourcePages: [{ documentId: "doc-1", pageNumber: 1, widthPt: 612, heightPt: 792, combinedPageNumber: 1 }],
    });
    expect(pages).toHaveLength(1);
    expect(pages[0]?.blocks.some((block) => block.type === "signature")).toBe(true);
    const edited = sanitizeEditorPages([
      {
        ...pages[0],
        kind: "letter",
        blocks: [
          { type: "heading", text: "LAVAL", level: 1 },
          { type: "table", header: true, rows: [["Course", "Title"], ["MCB-8853", "Thesis"]] },
          { type: "seal", text: "Registrar", column: "center" },
          { type: "signature", electronic: false, column: "right", lines: ["Registrar"] },
        ],
      },
    ]);
    expect(edited?.[0]?.kind).toBe("letter");
    const updates = outputsAfterEdit([stored], edited ?? []);
    const output = updates[0]?.output as { model: string; pages: Array<{ kind: string; blocks: Array<{ type: string }> }> };
    expect(output.model).toBe("kept");
    expect(output.pages[0]?.kind).toBe("letter");
    expect(output.pages[0]?.blocks.map((block) => block.type)).toEqual(["heading", "table", "seal", "signature"]);
  });

  it("rejects a save with no pages", () => {
    expect(sanitizeEditorPages([])).toBeNull();
    expect(sanitizeEditorPages([{ pageNumber: 1 }])).toBeNull();
  });
});
