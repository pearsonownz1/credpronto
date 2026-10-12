import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  applyPageOrder,
  compareCombinedPages,
  filesInAppliedOrder,
  isIdentityOrder,
  parseOrderHint,
  pdfPagePermutation,
  permutePdfPages,
  type PageCue,
} from "./page-order";

function cue(patch: Partial<PageCue> & Pick<PageCue, "documentId" | "uploadPosition" | "uploadPage">): PageCue {
  return {
    logicalPage: null,
    hint: null,
    confidence: null,
    ...patch,
  };
}

describe("page order migration", () => {
  it("records applied order and image-quality columns without being applied here", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20261012050400_page_order_image_quality.sql"),
      "utf8",
    );
    expect(sql).toContain("applied_position");
    expect(sql).toContain("page_order jsonb");
    expect(sql).toContain("page_order_basis");
    expect(sql).toContain("quality_score");
    expect(sql).toContain("quality_message");
    expect(sql).toContain("image_quality");
  });
});

describe("parseOrderHint", () => {
  it("reads page N/M, page N of M, and French sur", () => {
    expect(parseOrderHint("page 1/2")).toEqual({ page: 1, total: 2 });
    expect(parseOrderHint("Page 2 of 2")).toEqual({ page: 2, total: 2 });
    expect(parseOrderHint("2 sur 2")).toEqual({ page: 2, total: 2 });
    expect(parseOrderHint("p. 4")).toEqual({ page: 4, total: null });
    expect(parseOrderHint("suite")).toBeNull();
  });
});

describe("applyPageOrder", () => {
  it("puts a French scan uploaded as page 2 then page 1 into printed order", () => {
    const applied = applyPageOrder([
      cue({
        documentId: "page2",
        uploadPosition: 1,
        uploadPage: 1,
        logicalPage: 2,
        hint: "page 2/2",
        confidence: 0.95,
      }),
      cue({
        documentId: "page1",
        uploadPosition: 2,
        uploadPage: 1,
        logicalPage: 1,
        hint: "page 1/2",
        confidence: 0.93,
      }),
    ]);

    expect(applied.basis).toBe("logical");
    expect(applied.pages.map((page) => page.documentId)).toEqual(["page1", "page2"]);
    expect(applied.pages.map((page) => page.appliedPosition)).toEqual([1, 2]);
    expect(applied.pages.map((page) => page.uploadPosition)).toEqual([2, 1]);
    expect(applied.pages.map((page) => page.logicalPage)).toEqual([1, 2]);
  });

  it("keeps upload order when the model is not confident", () => {
    const applied = applyPageOrder([
      cue({
        documentId: "page2",
        uploadPosition: 1,
        uploadPage: 1,
        logicalPage: 2,
        hint: "page 2/2",
        confidence: 0.79,
      }),
      cue({
        documentId: "page1",
        uploadPosition: 2,
        uploadPage: 1,
        logicalPage: 1,
        hint: "page 1/2",
        confidence: 0.95,
      }),
    ]);

    expect(applied.basis).toBe("upload");
    expect(applied.pages.map((page) => [page.documentId, page.appliedPosition])).toEqual([
      ["page2", 1],
      ["page1", 2],
    ]);
  });

  it("keeps upload order when two pages claim the same number", () => {
    const applied = applyPageOrder([
      cue({ documentId: "a", uploadPosition: 1, uploadPage: 1, logicalPage: 1, hint: "page 1", confidence: 0.9 }),
      cue({ documentId: "b", uploadPosition: 2, uploadPage: 1, logicalPage: 1, hint: "page 1", confidence: 0.9 }),
    ]);
    expect(applied.basis).toBe("upload");
    expect(applied.pages.map((page) => page.documentId)).toEqual(["a", "b"]);
  });

  it("uses the hint when the model left logicalPage empty", () => {
    const applied = applyPageOrder([
      cue({ documentId: "second", uploadPosition: 1, uploadPage: 1, hint: "page 2/2", confidence: 0.9 }),
      cue({ documentId: "first", uploadPosition: 2, uploadPage: 1, hint: "page 1/2", confidence: 0.9 }),
    ]);
    expect(applied.basis).toBe("logical");
    expect(applied.pages.map((page) => page.documentId)).toEqual(["first", "second"]);
  });

  it("places a continuation cue after the numbered page", () => {
    const applied = applyPageOrder([
      cue({ documentId: "suite", uploadPosition: 1, uploadPage: 1, hint: "suite", confidence: 0.9 }),
      cue({
        documentId: "first",
        uploadPosition: 2,
        uploadPage: 1,
        logicalPage: 1,
        hint: "page 1",
        confidence: 0.91,
      }),
    ]);
    expect(applied.basis).toBe("logical");
    expect(applied.pages.map((page) => page.documentId)).toEqual(["first", "suite"]);
  });

  it("does not reorder when page totals disagree", () => {
    const applied = applyPageOrder([
      cue({ documentId: "a", uploadPosition: 1, uploadPage: 1, logicalPage: 2, hint: "page 2/3", confidence: 0.95 }),
      cue({ documentId: "b", uploadPosition: 2, uploadPage: 1, logicalPage: 1, hint: "page 1/2", confidence: 0.95 }),
    ]);
    expect(applied.basis).toBe("upload");
  });

  it("reorders pages inside one file and leaves the next document in upload order", () => {
    const applied = applyPageOrder([
      cue({
        documentId: "diploma",
        uploadPosition: 1,
        uploadPage: 1,
        logicalPage: 2,
        hint: "page 2/2",
        confidence: 0.92,
      }),
      cue({
        documentId: "diploma",
        uploadPosition: 1,
        uploadPage: 2,
        logicalPage: 1,
        hint: "page 1/2",
        confidence: 0.92,
      }),
      cue({
        documentId: "passport",
        uploadPosition: 2,
        uploadPage: 1,
        logicalPage: 1,
        hint: "page 1",
        confidence: 0.99,
      }),
    ]);

    expect(applied.basis).toBe("logical");
    const diploma = applied.pages.filter((page) => page.documentId === "diploma");
    expect(diploma.map((page) => page.uploadPage)).toEqual([2, 1]);
    expect(diploma.map((page) => page.appliedPage)).toEqual([1, 2]);
    expect(diploma.every((page) => page.appliedPosition === 1)).toBe(true);
    const passport = applied.pages.find((page) => page.documentId === "passport");
    expect(passport?.appliedPosition).toBe(2);
    expect(applied.pages.map((page) => page.documentId)).toEqual(["diploma", "diploma", "passport"]);
  });

  it("rejects a logical page that disagrees with the hint", () => {
    const applied = applyPageOrder([
      cue({
        documentId: "a",
        uploadPosition: 1,
        uploadPage: 1,
        logicalPage: 1,
        hint: "page 2/2",
        confidence: 0.99,
      }),
      cue({
        documentId: "b",
        uploadPosition: 2,
        uploadPage: 1,
        logicalPage: 2,
        hint: "page 1/2",
        confidence: 0.99,
      }),
    ]);
    expect(applied.basis).toBe("upload");
    expect(applied.pages.map((page) => page.documentId)).toEqual(["a", "b"]);
  });
});

describe("combined PDF order", () => {
  it("sorts files by the applied position and swaps pages inside a file", () => {
    const applied = applyPageOrder([
      cue({
        documentId: "scan",
        uploadPosition: 1,
        uploadPage: 1,
        logicalPage: 2,
        hint: "page 2/2",
        confidence: 0.9,
      }),
      cue({
        documentId: "scan",
        uploadPosition: 1,
        uploadPage: 2,
        logicalPage: 1,
        hint: "page 1/2",
        confidence: 0.9,
      }),
    ]);
    const files = filesInAppliedOrder(
      [
        { documentId: "scan", pageCount: 2 },
      ],
      applied,
    );
    const permutation = pdfPagePermutation(files, applied);
    expect(permutation).toEqual([1, 0]);
    expect(isIdentityOrder(permutation)).toBe(false);

    expect(
      compareCombinedPages(
        [{ id: "scan", position: 1, appliedPosition: 1 }],
        { documentId: "scan", pageNumber: 2 },
        { documentId: "scan", pageNumber: 1 },
      ),
    ).toBeGreaterThan(0);
  });

  it("builds the combined PDF in the applied page order", async () => {
    const src = await PDFDocument.create();
    src.addPage([200, 200]);
    src.addPage([300, 400]);
    const swapped = await permutePdfPages(await src.save(), [1, 0]);
    const out = await PDFDocument.load(swapped);
    expect(out.getPageCount()).toBe(2);
    expect(out.getPage(0).getSize()).toEqual({ width: 300, height: 400 });
    expect(out.getPage(1).getSize()).toEqual({ width: 200, height: 200 });
  });
});
