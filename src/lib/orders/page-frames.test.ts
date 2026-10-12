import { describe, expect, it } from "vitest";
import {
  PAGE_FRAME_COLUMNS,
  PREVIEW_CORRECTION_COLUMNS,
  PREVIEW_DOCUMENT_COLUMNS,
  PREVIEW_ORDER_COLUMNS,
  PREVIEW_ROW_COLUMNS,
} from "./db";

describe("preview page frames", () => {
  it("does not read OCR text or full rows when signing a preview", () => {
    expect(PAGE_FRAME_COLUMNS.split(",").map((column) => column.trim())).not.toContain("ocr_text");
    expect(PAGE_FRAME_COLUMNS).toContain("width_pt");
    expect(PAGE_FRAME_COLUMNS).toContain("height_pt");
    expect(PREVIEW_DOCUMENT_COLUMNS).toContain(`document_pages(${PAGE_FRAME_COLUMNS})`);
    expect(PREVIEW_DOCUMENT_COLUMNS).toContain("applied_position");
    expect(PREVIEW_DOCUMENT_COLUMNS).not.toContain("ocr_text");
    expect(PREVIEW_DOCUMENT_COLUMNS).not.toContain("*");
    for (const column of ["page_order", "progress", "final_translation_path", "certification_path", "ocr_text"]) {
      expect(PREVIEW_ORDER_COLUMNS).not.toContain(column);
    }
    expect(PREVIEW_ORDER_COLUMNS).toContain("user_id");
    expect(PREVIEW_ORDER_COLUMNS).toContain("combined_original_path");
    expect(PREVIEW_CORRECTION_COLUMNS).not.toContain("*");
    expect(PREVIEW_ROW_COLUMNS).not.toContain("*");
    expect(PREVIEW_ROW_COLUMNS).toContain("preview_path");
  });
});