import { describe, expect, it } from "vitest";
import { HttpError } from "./errors";
import {
  lineBillableUnits,
  pageStatusTag,
  parseQuotePatch,
  quotePriceAfterSkip,
  skipPageNote,
  sumQuotedBillable,
} from "./skip-pages";

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

describe("page status", () => {
  it("tags a page as translate, a double page, or free", () => {
    expect(pageStatusTag({})).toBe("Translate");
    expect(pageStatusTag({ billableUnits: 1 })).toBe("Translate");
    expect(pageStatusTag({ billableUnits: 2 })).toBe("Counts as 2");
    expect(pageStatusTag({ skip: true, skipReason: "already English", billableUnits: 2 })).toBe(
      "Free (English)",
    );
    expect(pageStatusTag({ skip: true, skipReason: "already_english" })).toBe("Free (English)");
    expect(pageStatusTag({ skip: true, skipReason: "shipping label" })).toBe("Free (shipping label)");
    expect(pageStatusTag({ skip: true, skipReason: "shipping_label" })).toBe("Free (shipping label)");
    expect(pageStatusTag({ skip: true, skipReason: "not a document" })).toBe("Free (not a document)");
    expect(pageStatusTag({ skip: true })).toBe("Free");
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
    expect(() => parseQuotePatch({ includeTranslation: "yes" })).toThrow(/includeTranslation must be true or false/);
    expect(parseQuotePatch({ includeTranslation: true })).toEqual({ includeTranslation: true });
    expect(parseQuotePatch({ services: ["translation", "diploma", "course_by_course"] })).toEqual({
      services: ["translation", "diploma", "course_by_course"],
    });
    expect(parseQuotePatch({ service: "diploma", includeTranslation: false })).toEqual({
      service: "diploma",
      includeTranslation: false,
    });
    expect(() => parseQuotePatch({ services: ["rush"] })).toThrow(/translation, diploma, or course_by_course/);
    expect(() => parseQuotePatch({ services: ["diploma"], totalCents: 1995 })).toThrow(/calculated by the server/);
    expect(parseQuotePatch({ degreeCount: 5 })).toEqual({ degreeCount: 5 });
    expect(() => parseQuotePatch({ degreeCount: 6 })).toThrow(/1 to 5/);
    expect(() => parseQuotePatch({ degreeCount: 2, pages: 4 })).toThrow(/counted from the upload/);
    expect(parseQuotePatch({ includeTranslation: false, skipPages: [0] })).toEqual({
      includeTranslation: false,
      skipPages: [0],
    });
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
    ).toEqual({
      billablePages: 1,
      evaluationCents: null,
      translationCents: null,
      totalCents: 995,
      includeTranslation: false,
      unitPriceCents: 995,
    });
  });

  it("keeps the evaluation fee and drops the translation when every page is skipped", () => {
    expect(
      quotePriceAfterSkip(
        {
          service: "diploma",
          degreeCount: 1,
          sourceLanguage: "es",
          unitPriceCents: 995,
          evaluationCents: 1995,
          addonCents: 0,
          includeTranslation: true,
        },
        0,
      ),
    ).toEqual({
      billablePages: 0,
      evaluationCents: 1995,
      translationCents: 0,
      totalCents: 1995,
      includeTranslation: true,
      unitPriceCents: 1995,
    });
  });

  it("leaves a one-page diploma at $19.95 when translation stays off", () => {
    expect(
      quotePriceAfterSkip(
        {
          service: "diploma",
          degreeCount: 1,
          sourceLanguage: "es",
          unitPriceCents: 995,
          evaluationCents: 1995,
          addonCents: 0,
          includeTranslation: false,
        },
        1,
      ),
    ).toEqual({
      billablePages: 1,
      evaluationCents: 1995,
      translationCents: 0,
      totalCents: 1995,
      includeTranslation: false,
      unitPriceCents: 1995,
    });
  });
});
