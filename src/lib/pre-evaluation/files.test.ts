import { describe, expect, it } from "vitest";
import { PRE_EVAL_MAX_BYTES } from "./constants";
import { assertPreEvalFile, extensionMime, sniffPreEvalMime } from "./files";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

describe("pre-evaluation files", () => {
  it("accepts a PDF, JPG, or PNG whose name matches the bytes", () => {
    expect(assertPreEvalFile({ filename: "scan.pdf", declaredType: "application/pdf", bytes: PDF }).mime).toBe(
      "application/pdf",
    );
    expect(assertPreEvalFile({ filename: "photo.jpg", declaredType: "image/jpeg", bytes: JPEG }).mime).toBe(
      "image/jpeg",
    );
    expect(assertPreEvalFile({ filename: "photo.png", declaredType: "", bytes: PNG }).mime).toBe("image/png");
    expect(sniffPreEvalMime(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(extensionMime("notes.webp")).toBeNull();
  });

  it("rejects a renamed file, an empty file, and a file over 10MB", () => {
    expect(() => assertPreEvalFile({ filename: "scan.png", declaredType: "image/png", bytes: PDF })).toThrow(
      /PDF, JPG, or PNG/,
    );
    expect(() =>
      assertPreEvalFile({ filename: "scan.pdf", declaredType: "image/png", bytes: PDF }),
    ).toThrow(/PDF, JPG, or PNG/);
    expect(() => assertPreEvalFile({ filename: "scan.pdf", declaredType: "application/pdf", bytes: new Uint8Array() })).toThrow(
      /Empty/,
    );
    const oversized = new Uint8Array(PRE_EVAL_MAX_BYTES + 1);
    oversized.set(PDF);
    expect(() => assertPreEvalFile({ filename: "scan.pdf", declaredType: "application/pdf", bytes: oversized })).toThrow(
      /10MB/,
    );
  });
});
