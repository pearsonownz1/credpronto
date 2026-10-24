import { describe, expect, it } from "vitest";
import { carriedFileDetail, formatFileSize, orderPreEvaluationId } from "./stored-file";

const file = {
  name: "licenciatura.pdf",
  mimeType: "application/pdf" as const,
  size: 2048,
  pageCount: 3,
  kind: "diploma" as const,
};

describe("carried pre-evaluation file", () => {
  it("shows pages and size, and a single page without a plural", () => {
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(carriedFileDetail(file)).toBe("3 pages · 2 KB");
    expect(carriedFileDetail({ ...file, pageCount: 1, size: 512 })).toBe("1 page · 512 B");
    expect(carriedFileDetail({ ...file, pageCount: 0, size: 1536 })).toBe("1.5 KB");
  });

  it("sends the pre-evaluation id only while the stored file stays attached", () => {
    expect(orderPreEvaluationId({ id: " prev-1 ", file, removed: false })).toBe("prev-1");
    expect(orderPreEvaluationId({ id: "prev-1", file, removed: true })).toBeNull();
    expect(orderPreEvaluationId({ id: "prev-1", file: null, removed: false })).toBeNull();
    expect(orderPreEvaluationId({ id: "  ", file, removed: false })).toBeNull();
  });
});
