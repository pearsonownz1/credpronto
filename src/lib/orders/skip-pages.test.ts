import { describe, expect, it } from "vitest";
import { HttpError } from "./errors";
import { lineBillableUnits, parseQuotePatch, quotePriceAfterSkip, skipPageNote, sumQuotedBillable } from "./skip-pages";

describe("quoted billable units", () => {
  it("sums billable units and counts a missing field as one page", () => {
    expect(lineBillableUnits({})).toBe(1);
    expect(lineBillableUnits({ billableUnits: null })).toBe(1);
    expect(lineBillableUnits({ billableUnits: 2 })).toBe(2);
    expect(
      sumQuotedBillable([{ billableUnits: 2 }, { billableUnits: 1 }, {}]),
    ).toBe(4);
  });

  it("drops skipped pages from the billable sum", () => {
    expect(sumQuotedBillable([{ billableUnits: 2, skip: true }, { billableUnits: 1 }])).toBe(1);
    expect(sumQuotedBillable([{ skip: true }])).toBe(0);
  });
});

describe("skip notes", () => {
  it("uses the skip reason when the page was skipped for a known cause", () => {
    expect(skipPageNote("already English")).toBe("Skipped: already English");
    expect(skipPageNote("already_english")).toBe("Skipped: already English");
    expect(skipPageNote("not a document")).toBe("Skipped: not a document");
    expect(skipPageNote("not_a_document")).toBe("Skipped: not a document");
    expect(skipPageNote(null)).toBe("Skipped");
    expect(skipPageNote("cover sheet")).toBe("Skipped: cover sheet");
  });
});

describe("quote patch", () => {
  it("accepts page indexes and a target language", () => {
    expect(parseQuotePatch({ skipPages: [1, 1, 0] })).toEqual({ skipPages: [1, 0] });
    expect(parseQuotePatch({ targetLanguage: "es", skipPages: [] })).toEqual({
      skipPages: [],
      targetLanguage: "es",
    });
  });

  it("rejects a body that does not name pages or a language", () => {
    expect(() => parseQuotePatch(null)).toThrow(HttpError);
    expect(() => parseQuotePatch({})).toThrow(/Nothing to update/);
    expect(() => parseQuotePatch({ skipPages: ["p2"] })).toThrow(/page indexes/);
    expect(() => parseQuotePatch({ skipPages: [-1] })).toThrow(/page indexes/);
    expect(() => parseQuotePatch({ skipPages: [1.5] })).toThrow(/page indexes/);
    try {
      parseQuotePatch({ skipPages: "page-1" });
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(400);
    }
  });
});

describe("price after skip", () => {
  it("reprices a translation from the remaining billable pages", () => {
    expect(
      quotePriceAfterSkip(
        {
          service: null,
          sourceLanguage: "es",
          unitPriceCents: 995,
          evaluationCents: null,
          addonCents: 0,
        },
        1,
      ),
    ).toEqual({ billablePages: 1, translationCents: null, totalCents: 995 });
  });

  it("keeps the evaluation fee and drops the translation when every page is skipped", () => {
    expect(
      quotePriceAfterSkip(
        {
          service: "diploma",
          sourceLanguage: "es",
          unitPriceCents: 995,
          evaluationCents: 1995,
          addonCents: 0,
        },
        0,
      ),
    ).toEqual({ billablePages: 0, translationCents: 0, totalCents: 1995 });
  });
});
