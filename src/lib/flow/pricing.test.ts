import { describe, expect, it } from "vitest";
import { sampleDraft } from "./mock-data";
import {
  PRICE_PER_PAGE_CENTS,
  billablePages,
  formatMoney,
  pageLabel,
  priceDraft,
} from "./pricing";

describe("page labels", () => {
  it("uses the singular only for one page", () => {
    expect(pageLabel(1)).toBe("1 page");
    expect(pageLabel(0)).toBe("0 pages");
    expect(pageLabel(3)).toBe("3 pages");
  });
});

describe("billable pages", () => {
  it("counts one side of up to 250 words as one page", () => {
    expect(billablePages(182, 1)).toBe(1);
    expect(billablePages(96, 1)).toBe(1);
    expect(billablePages(250, 1)).toBe(1);
  });

  it("counts another page when a side passes 250 words", () => {
    expect(billablePages(251, 1)).toBe(2);
    expect(billablePages(500, 1)).toBe(2);
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
