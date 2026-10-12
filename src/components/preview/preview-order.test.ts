import { describe, expect, it } from "vitest";
import {
  CERTIFICATE_PREVIEW,
  LONG_PREVIEW,
  buyLabel,
  documentGroups,
  formatMoney,
  pagesAlign,
} from "./preview-order";

describe("preview order", () => {
  it("formats cents and the buy label", () => {
    expect(formatMoney(1990)).toBe("$19.90");
    expect(buyLabel(CERTIFICATE_PREVIEW)).toBe("Buy & download — $29.85");
  });

  it("matches translation page N to original page N, with point sizes", () => {
    expect(CERTIFICATE_PREVIEW.pageCount).toBe(3);
    expect(CERTIFICATE_PREVIEW.pricing.totalCents).toBe(3 * 995);
    expect(pagesAlign(CERTIFICATE_PREVIEW)).toBe(true);
    expect(pagesAlign(LONG_PREVIEW)).toBe(true);
    expect(LONG_PREVIEW.original.pages[9]).toEqual({
      page: 10,
      widthPt: 612,
      heightPt: 792,
    });
  });

  it("groups labeled pages by document in upload order", () => {
    expect(documentGroups(CERTIFICATE_PREVIEW.original.pages)).toEqual([]);
    expect(
      documentGroups([
        {
          page: 3,
          widthPt: 612,
          heightPt: 792,
          documentId: "back",
          documentIndex: 1,
          documentName: "IMG_4021.HEIC",
        },
        {
          page: 1,
          widthPt: 612,
          heightPt: 792,
          documentId: "acta",
          documentIndex: 0,
          documentName: "acta-nacimiento.pdf",
        },
        {
          page: 2,
          widthPt: 612,
          heightPt: 792,
          documentId: "acta",
          documentIndex: 0,
          documentName: "acta-nacimiento.pdf",
        },
      ]),
    ).toEqual([
      {
        documentId: "acta",
        documentIndex: 0,
        documentName: "acta-nacimiento.pdf",
        firstPage: 1,
      },
      {
        documentId: "back",
        documentIndex: 1,
        documentName: "IMG_4021.HEIC",
        firstPage: 3,
      },
    ]);
  });
});
