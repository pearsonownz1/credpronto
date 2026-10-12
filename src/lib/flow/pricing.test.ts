import { describe, expect, it } from "vitest";
import { sampleDraft } from "./mock-data";
import {
  PRICE_PER_PAGE_CENTS,
  billablePages,
  formatMoney,
  priceDraft,
} from "./pricing";

describe("billable pages", () => {
  it("counts one side of up to 1,000 units as one page", () => {
    expect(billablePages(182, 1)).toBe(1);
    expect(billablePages(96, 1)).toBe(1);
    expect(billablePages(1000, 1)).toBe(1);
  });

  it("counts another page when a side exceeds 1,000 units", () => {
    expect(billablePages(1001, 1)).toBe(2);
    expect(billablePages(2000, 1)).toBe(2);
  });

  it("counts each side when the word count is short", () => {
    expect(billablePages(100, 2)).toBe(2);
  });
});

describe("sample quote", () => {
  it("prices the two sample files at $19.90 with a free preview", () => {
    const quote = priceDraft(sampleDraft());
    expect(quote.pages).toBe(2);
    expect(quote.wordCount).toBe(278);
    expect(quote.perPageCents).toBe(PRICE_PER_PAGE_CENTS);
    expect(quote.previewCents).toBe(0);
    expect(quote.totalCents).toBe(1990);
    expect(formatMoney(quote.totalCents)).toBe("$19.90");
    expect(quote.files.map((file) => file.pages)).toEqual([1, 1]);
  });
});
