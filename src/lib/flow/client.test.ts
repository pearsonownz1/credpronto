import { describe, expect, it } from "vitest";
import { orderDownloadPath } from "./client";
import { samplePreviewPages } from "./sample-order";

describe("order download path", () => {
  it("signs one original when documentId is set", () => {
    expect(orderDownloadPath("tok en", "original", "acta")).toBe(
      "/api/orders/tok%20en/download?file=original&documentId=acta",
    );
  });

  it("omits documentId so a multi-file order can return originals[]", () => {
    expect(orderDownloadPath("tok", "original")).toBe(
      "/api/orders/tok/download?file=original",
    );
    expect(orderDownloadPath("tok", "translation")).toBe(
      "/api/orders/tok/download?file=translation",
    );
  });
});

describe("flow mock preview pages", () => {
  it("labels the sample PDF with both uploads", () => {
    const pages = samplePreviewPages();
    expect(pages.map((page) => page.documentId)).toEqual(["acta", "back", "back"]);
    expect(pages[0]?.documentName).toBe("acta-nacimiento.pdf");
    expect(pages[1]?.documentName).toBe("IMG_4021.HEIC");
    expect(pages[1]?.documentIndex).toBe(1);
  });
});
