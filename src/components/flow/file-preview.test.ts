import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FilePreview, freePageLabel, inlineSourceUrl, previewKind } from "./file-preview";

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

  it("labels a free page without a physical page total", () => {
    expect(freePageLabel(undefined)).toBeNull();
    expect(freePageLabel({ skip: false, billableUnits: 2 })).toBeNull();
    expect(freePageLabel({ skip: true, skipReason: "shipping label" })).toBe("Free (shipping label)");
    const html = renderToStaticMarkup(
      createElement(FilePreview, {
        token: "tok",
        fileId: "file",
        filename: "notes.pdf",
        pages: [{ skip: true, skipReason: "english" }],
        renderThumb: () => null,
      }),
    );
    expect(html).toContain('data-testid="page-viewer-label"');
    expect(html).toContain("Page 1");
    expect(html).not.toContain("of 1");
    expect(html).toContain("Free (English)");
    expect(html).toContain("md:w-[420px]");
    expect(html).toContain("opacity-40");
  });

  it("does not render a viewer box for a file it cannot preview", () => {
    const html = renderToStaticMarkup(
      createElement(FilePreview, {
        token: "tok",
        fileId: "file",
        filename: "notes.docx",
        renderThumb: () => null,
      }),
    );
    expect(html).not.toContain('data-testid="page-viewer"');
    expect(html).not.toContain('data-testid="file-thumb-fallback"');
    expect(html).not.toContain('data-testid="file-thumb-skeleton"');
  });
});
