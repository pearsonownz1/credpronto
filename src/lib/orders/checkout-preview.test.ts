import { describe, expect, it } from "vitest";
import { PREVIEWS_BUCKET } from "./constants";
import {
  CHECKOUT_IMAGE_SECONDS,
  checkoutLineProduct,
  checkoutProductDescription,
  existingCheckoutPreviewPath,
  newCheckoutPreviewPath,
  watermarkedPreviewObject,
} from "./checkout-preview";

describe("checkout product description", () => {
  it("names the language pair, the document, and a single page", () => {
    expect(
      checkoutProductDescription({
        sourceLanguage: "fr",
        targetLanguage: "en",
        documentNames: ["fr_diplome-licence.pdf"],
        pages: 1,
      }),
    ).toBe("French → English · fr_diplome-licence.pdf · 1 page");
  });

  it("adds +N more for the other documents and pluralizes pages", () => {
    expect(
      checkoutProductDescription({
        sourceLanguage: "es",
        targetLanguage: "en",
        documentNames: ["acta.pdf", "transcript.pdf", "id-card.png"],
        pages: 3,
      }),
    ).toBe("Spanish → English · acta.pdf +2 more · 3 pages");
  });

  it("keeps each document's own name in upload order", () => {
    expect(
      checkoutProductDescription({
        sourceLanguage: "pt",
        targetLanguage: "en",
        documentNames: ["  certidao.pdf  ", ""],
        pages: 2,
      }),
    ).toBe("Portuguese → English · certidao.pdf · 2 pages");
  });
});

describe("checkout line product", () => {
  it("puts the signed image on images[0] and omits images when rendering failed", () => {
    const description = "French → English · fr_diplome-licence.pdf · 1 page";
    expect(
      checkoutLineProduct({
        billablePages: 1,
        description,
        imageUrl: "https://files.example/preview.png",
      }),
    ).toEqual({
      name: "CredPronto certified translation (1 page)",
      description,
      images: ["https://files.example/preview.png"],
    });
    expect(
      checkoutLineProduct({ billablePages: 1, description, imageUrl: null }),
    ).toEqual({
      name: "CredPronto certified translation (1 page)",
      description,
    });
    expect(checkoutLineProduct({ billablePages: 3, description, imageUrl: null }).name).toBe(
      "CredPronto certified translation (3 pages)",
    );
  });
});

describe("watermarked checkout preview", () => {
  it("signs only the watermarked preview object", () => {
    expect(CHECKOUT_IMAGE_SECONDS).toBe(25 * 60 * 60);
    expect(watermarkedPreviewObject("order-1/preview-v3.pdf")).toEqual({
      bucket: PREVIEWS_BUCKET,
      path: "order-1/preview-v3.pdf",
    });
  });

  it("also accepts the evaluation report and its translation preview", () => {
    expect(watermarkedPreviewObject("order-1/report-v2.pdf")).toEqual({
      bucket: PREVIEWS_BUCKET,
      path: "order-1/report-v2.pdf",
    });
    expect(watermarkedPreviewObject("order-1/translation-preview-v2.pdf")).toEqual({
      bucket: PREVIEWS_BUCKET,
      path: "order-1/translation-preview-v2.pdf",
    });
  });

  it("refuses the clean final", () => {
    expect(() => watermarkedPreviewObject("order-1/translation-v3.pdf")).toThrow(
      /watermarked preview/,
    );
    expect(() => watermarkedPreviewObject("order-1/evaluation-v2.pdf")).toThrow(
      /watermarked preview/,
    );
    expect(() => watermarkedPreviewObject("finals/preview-v1.pdf")).toThrow(/watermarked preview/);
    expect(() => watermarkedPreviewObject("order-1/finals/preview-v1.pdf")).toThrow(
      /watermarked preview/,
    );
    expect(() => watermarkedPreviewObject("  ")).toThrow(/watermarked preview/);
  });
});

describe("checkout preview object reuse", () => {
  it("reuses an existing png and otherwise stores a new random name", () => {
    expect(existingCheckoutPreviewPath("order-1", ["b.png", "a.png", "notes.txt"])).toBe(
      "checkout-previews/order-1/a.png",
    );
    expect(existingCheckoutPreviewPath("order-1", [])).toBeNull();
    expect(existingCheckoutPreviewPath("order-1", ["../secret.png", "folder/a.png"])).toBeNull();
    expect(newCheckoutPreviewPath("order-1", "11111111-1111-1111-1111-111111111111")).toBe(
      "checkout-previews/order-1/11111111-1111-1111-1111-111111111111.png",
    );
  });
});
