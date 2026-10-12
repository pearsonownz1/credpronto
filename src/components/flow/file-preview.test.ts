import { describe, expect, it } from "vitest";
import { inlineSourceUrl, previewKind } from "./file-preview";

describe("quote file preview", () => {
  it("treats PDFs and images as previewable", () => {
    expect(previewKind("notes.PDF")).toBe("pdf");
    expect(previewKind("scan.jpeg")).toBe("image");
    expect(previewKind("photo.heic")).toBe("image");
    expect(previewKind("notes.docx")).toBe("file");
  });

  it("prefers a URL already on the order before asking for a signed one", () => {
    expect(inlineSourceUrl(undefined)).toBeNull();
    expect(inlineSourceUrl({ filename: "a.pdf" })).toBeNull();
    expect(inlineSourceUrl({ url: " https://files.example/a.pdf " })).toBe("https://files.example/a.pdf");
    expect(inlineSourceUrl({ sourceUrl: "https://files.example/source.pdf", url: "https://files.example/other.pdf" })).toBe(
      "https://files.example/source.pdf",
    );
  });
});
