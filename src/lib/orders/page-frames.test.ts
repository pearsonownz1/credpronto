import { describe, expect, it } from "vitest";
import { PAGE_FRAME_COLUMNS } from "./db";

describe("preview page frames", () => {
  it("does not read OCR text when signing a preview", () => {
    expect(PAGE_FRAME_COLUMNS.split(",").map((column) => column.trim())).not.toContain("ocr_text");
    expect(PAGE_FRAME_COLUMNS).toContain("width_pt");
    expect(PAGE_FRAME_COLUMNS).toContain("height_pt");
  });
});