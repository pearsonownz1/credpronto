import { describe, expect, it } from "vitest";
import {
  CERTIFICATE_PREVIEW,
  LONG_PREVIEW,
  buyLabel,
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
});
