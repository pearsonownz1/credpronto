import { describe, expect, it } from "vitest";
import { HttpError } from "./errors";
import { parseCorrectionBody } from "./corrections";

describe("correction request", () => {
  it("accepts a page and a note without a passage", () => {
    expect(parseCorrectionBody({ documentId: "doc-1", page: 2, note: "fix the date" })).toEqual({
      documentId: "doc-1",
      page: 2,
      passage: null,
      note: "fix the date",
    });
  });

  it("stores an explicit null passage or quote", () => {
    expect(
      parseCorrectionBody({ documentId: "doc-1", page: 1, passage: null, note: "check the name" }),
    ).toMatchObject({ passage: null });
    expect(
      parseCorrectionBody({ documentId: "doc-1", page: 1, quote: null, note: "check the name" }),
    ).toMatchObject({ passage: null });
  });

  it("keeps a passage when the customer highlighted text", () => {
    expect(
      parseCorrectionBody({
        documentId: "doc-1",
        page: 3,
        quote: " 14 de marzo ",
        note: "day first",
      }),
    ).toMatchObject({ passage: "14 de marzo", page: 3 });
  });

  it("rejects a request that has no page or no note", () => {
    expect(() => parseCorrectionBody({ documentId: "doc-1", note: "fix it" })).toThrow(HttpError);
    expect(() => parseCorrectionBody({ documentId: "doc-1", page: 1, note: "  " })).toThrow(HttpError);
  });
});
