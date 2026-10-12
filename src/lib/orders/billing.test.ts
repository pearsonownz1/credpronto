import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UNIT_PRICE_CENTS } from "./constants";
import {
  CJK_PAGE_RULE,
  WORD_PAGE_RULE,
  billableCjkUnits,
  billableUnits,
  countCjkChars,
  countCjkUnits,
  pageRuleForLanguages,
  lineItemForStoredPage,
  quotePage,
  quotePages,
  storedDensity,
  sumBillableUnits,
  totalCents,
  type PageQuote,
} from "./billing";

function obeysStoredRule(quote: PageQuote): boolean {
  if (quote.skip) return quote.billableUnits === 0 && quote.counted >= 0;
  if (quote.billingBasis === "cjk") {
    return quote.billableUnits === Math.max(1, Math.ceil(quote.counted / 1000));
  }
  return quote.billableUnits === Math.max(1, Math.ceil(quote.counted / 250));
}

describe("billable page math", () => {
  it("keeps a one-page floor on the density helpers and skips a blank page", () => {
    expect(billableUnits(0)).toBe(1);
    expect(billableCjkUnits(0)).toBe(1);
    const blank = quotePage({ text: " \n\t", pageIndex: 0 });
    expect(blank.billableUnits).toBe(0);
    expect(blank.skip).toBe(true);
    expect(blank.skipReason).toBe("blank");
  });

  it("counts 250 words as one page and 251 words as two", () => {
    expect(billableUnits(1)).toBe(1);
    expect(billableUnits(250)).toBe(1);
    expect(billableUnits(251)).toBe(2);
    expect(billableUnits(500)).toBe(2);
    expect(billableUnits(501)).toBe(3);
    expect(billableUnits(750)).toBe(3);
  });

  it("counts 1000 CJK characters as one page and 1001 characters as two", () => {
    expect(billableCjkUnits(1)).toBe(1);
    expect(billableCjkUnits(1000)).toBe(1);
    expect(billableCjkUnits(1001)).toBe(2);
    expect(billableCjkUnits(2000)).toBe(2);
    expect(billableCjkUnits(2001)).toBe(3);
  });

  it("prices the two-sided diploma example at 3 pages and $29.85", () => {
    const pages = sumBillableUnits([180, 400]);
    expect(pages).toBe(3);
    expect(totalCents(pages, 995)).toBe(2985);
  });

  it("counts 学号 2019 GPA 3.85 as 2 CJK characters and 5 legacy units", () => {
    expect(countCjkChars("学号 2019 GPA 3.85")).toBe(2);
    expect(countCjkUnits("学号 2019 GPA 3.85")).toBe(5);
  });

  it("does not let Latin groups add a CJK page", () => {
    const text = `${"学".repeat(1000)} GPA 3.85 2019`;
    const quote = quotePage({ text, pageIndex: 0, targetLanguage: "en" });
    expect(countCjkChars(text)).toBe(1000);
    expect(quote.billableUnits).toBe(1);
    expect(quote.billingBasis).toBe("cjk");
    expect(quote.skip).toBe(false);
  });

  it("treats a number or Latin group with internal separators as one legacy unit", () => {
    expect(countCjkUnits("3.85")).toBe(1);
    expect(countCjkUnits("2019")).toBe(1);
    expect(countCjkUnits("GPA")).toBe(1);
    expect(countCjkUnits("2019-06")).toBe(1);
    expect(countCjkUnits("2019/06")).toBe(1);
    expect(countCjkUnits("1,000")).toBe(1);
    expect(countCjkUnits(" ")).toBe(0);
    expect(countCjkUnits("。、")).toBe(0);
    expect(countCjkChars("。、")).toBe(0);
  });

  it("skips English pages only when the target is English", () => {
    const text = "This is to certify that the following student record is true and complete.";
    const intoEnglish = quotePage({ text, pageIndex: 2, targetLanguage: "en" });
    expect(intoEnglish).toMatchObject({
      pageIndex: 2,
      billableUnits: 0,
      skip: true,
      skipReason: "english",
    });
    const intoSpanish = quotePage({ text, pageIndex: 0, targetLanguage: "es" });
    expect(intoSpanish.skip).toBe(false);
    expect(intoSpanish.billableUnits).toBe(1);
    expect(intoSpanish.skipReason).toBeNull();
  });

  it("bills Spanish and skips a shipping label", () => {
    const spanish = quotePage({
      text: "El certificado de nacimiento es un documento oficial para los registros civiles.",
      pageIndex: 0,
      targetLanguage: "en",
    });
    expect(spanish.skip).toBe(false);
    expect(spanish.billableUnits).toBe(1);
    expect(spanish.billingBasis).toBe("words");

    const label = quotePage({
      text: "UPS SHIP TO Ada Lovelace TRACKING NUMBER 1Z999AA10123456784",
      pageIndex: 3,
      targetLanguage: "en",
    });
    expect(label).toMatchObject({
      pageIndex: 3,
      billableUnits: 0,
      skip: true,
      skipReason: "label",
    });
  });

  it("quotes a 9-page CJK transcript with English pages at 6 billable pages", () => {
    const english =
      "This is to certify that the following student record is true and that the courses were completed.";
    const quote = quotePages(
      [
        english,
        "课".repeat(400),
        "课".repeat(800),
        "课".repeat(999),
        "课".repeat(1000),
        "课".repeat(1500),
        english,
        " \n\t",
        "UPS SHIP TO Ada Lovelace TRACKING NUMBER 1Z999AA10123456784",
      ],
      "en",
    );

    expect(quote.lineItems).toEqual([
      { pageIndex: 0, billableUnits: 0, skip: true, skipReason: "english" },
      { pageIndex: 1, billableUnits: 1, skip: false, skipReason: null },
      { pageIndex: 2, billableUnits: 1, skip: false, skipReason: null },
      { pageIndex: 3, billableUnits: 1, skip: false, skipReason: null },
      { pageIndex: 4, billableUnits: 1, skip: false, skipReason: null },
      { pageIndex: 5, billableUnits: 2, skip: false, skipReason: null },
      { pageIndex: 6, billableUnits: 0, skip: true, skipReason: "english" },
      { pageIndex: 7, billableUnits: 0, skip: true, skipReason: "blank" },
      { pageIndex: 8, billableUnits: 0, skip: true, skipReason: "label" },
    ]);
    expect(quote.billablePages).toBe(6);
    expect(quote.totalCents).toBe(6 * UNIT_PRICE_CENTS);
    expect(quote.totalCents).toBe(5970);
    expect(quote.lineItems.reduce((sum, item) => sum + item.billableUnits, 0) * UNIT_PRICE_CENTS).toBe(
      quote.totalCents,
    );
  });

  it("stores a word count the database check can accept", () => {
    const samples = [
      quotePage({ text: "", pageIndex: 0 }),
      quotePage({ text: "alpha ".repeat(251), pageIndex: 1, targetLanguage: "en" }),
      quotePage({ text: "汉".repeat(1001), pageIndex: 2, targetLanguage: "en" }),
      quotePage({
        text: "This is to certify that the record is true.",
        pageIndex: 3,
        targetLanguage: "en",
      }),
    ];
    expect(samples.every(obeysStoredRule)).toBe(true);
    expect(samples.every((quote) => storedDensity(quote) >= 1)).toBe(true);
    const english = samples[3];
    expect(english?.skip).toBe(true);
    expect(english?.billableUnits).toBe(0);
    expect(storedDensity(english!)).toBe(1);
    expect(storedDensity(samples[0]!)).toBe(1);
  });

  it("charges a skipped stored page as zero and keeps a customer skip reason", () => {
    expect(
      lineItemForStoredPage({
        pageIndex: 0,
        text: "This is to certify that the record is true.",
        targetLanguage: "en",
        billableUnits: 1,
        skip: true,
        skipReason: "already English",
      }),
    ).toEqual({
      pageIndex: 0,
      billableUnits: 0,
      skip: true,
      skipReason: "already English",
    });
    expect(
      lineItemForStoredPage({
        pageIndex: 1,
        text: "This is to certify that the record is true.",
        targetLanguage: "en",
        billableUnits: 1,
        skip: false,
      }),
    ).toEqual({
      pageIndex: 1,
      billableUnits: 1,
      skip: false,
      skipReason: null,
    });
  });

  it("describes the rule that applies to the detected language", () => {
    expect(pageRuleForLanguages(["es"])).toBe(WORD_PAGE_RULE);
    expect(pageRuleForLanguages(["zh"])).toBe(CJK_PAGE_RULE);
    expect(pageRuleForLanguages(["ja", "ko"])).toBe(CJK_PAGE_RULE);
    expect(pageRuleForLanguages(["zh", "es"])).toContain("1000");
    expect(pageRuleForLanguages(["zh", "es"])).toContain("250 words");
    expect(pageRuleForLanguages(["zh"])).not.toContain("400 units");
    expect(pageRuleForLanguages(["zh", "es"])).not.toContain("400 units");
    expect(CJK_PAGE_RULE).not.toContain("400 units");
    expect(pageRuleForLanguages([null])).toBe(WORD_PAGE_RULE);
  });

  it("does not add a column for the new CJK rule", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20261012100536_cjk_page_quote.sql"),
      "utf8",
    );
    expect(sql).toContain("/ 1000");
    expect(sql).toContain("billable_units = 0");
    expect(sql.toLowerCase()).not.toMatch(/add column/);
    expect(sql.toLowerCase()).not.toMatch(/create table/);
  });
});
