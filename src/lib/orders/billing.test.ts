import { describe, expect, it } from "vitest";
import {
  CJK_PAGE_RULE,
  PAGE_RULE,
  WORD_PAGE_RULE,
  billableCjkUnits,
  billableForText,
  billableUnits,
  countCjkChars,
  countCjkUnits,
  pageRuleForLanguages,
  sumBillableUnits,
  totalCents,
} from "./billing";

describe("billable page math", () => {
  it("counts an empty side as one billable page", () => {
    expect(billableUnits(0)).toBe(1);
    expect(billableCjkUnits(0)).toBe(1);
  });

  it("counts 250 words as one page and 251 words as two", () => {
    expect(billableUnits(1)).toBe(1);
    expect(billableUnits(250)).toBe(1);
    expect(billableUnits(251)).toBe(2);
    expect(billableUnits(500)).toBe(2);
    expect(billableUnits(501)).toBe(3);
  });

  it("counts 1,000 CJK characters as one page and 1,001 as two", () => {
    expect(billableCjkUnits(1)).toBe(1);
    expect(billableCjkUnits(1000)).toBe(1);
    expect(billableCjkUnits(1001)).toBe(2);
    expect(billableCjkUnits(2000)).toBe(2);
    expect(billableCjkUnits(2001)).toBe(3);
  });

  it("prices a two-sided diploma of 180 and 400 words at 3 pages and $29.85", () => {
    const pages = sumBillableUnits([180, 400]);
    expect(pages).toBe(3);
    expect(totalCents(pages, 995)).toBe(2985);
  });

  it("counts CJK characters only, and keeps the older mixed tokenizer", () => {
    expect(countCjkChars("学号 2019 GPA 3.85")).toBe(2);
    expect(countCjkUnits("学号 2019 GPA 3.85")).toBe(5);
    expect(billableForText("学".repeat(1000))).toBe(1);
    expect(billableForText("学".repeat(1001))).toBe(2);
    expect(billableForText(Array.from({ length: 251 }, () => "alpha").join(" "))).toBe(2);
  });

  it("treats a number or Latin group with internal separators as one unit", () => {
    expect(countCjkUnits("3.85")).toBe(1);
    expect(countCjkUnits("2019")).toBe(1);
    expect(countCjkUnits("GPA")).toBe(1);
    expect(countCjkUnits("2019-06")).toBe(1);
    expect(countCjkUnits("2019/06")).toBe(1);
    expect(countCjkUnits("1,000")).toBe(1);
    expect(countCjkUnits(" ")).toBe(0);
    expect(countCjkUnits("。、")).toBe(0);
  });

  it("describes about 250 words or 1,000 characters per page", () => {
    expect(pageRuleForLanguages(["es"])).toBe(WORD_PAGE_RULE);
    expect(pageRuleForLanguages(["zh"])).toBe(CJK_PAGE_RULE);
    expect(pageRuleForLanguages(["zh", "es"])).toContain("250 words");
    expect(pageRuleForLanguages(["zh", "es"])).toContain("1,000 characters");
    expect(pageRuleForLanguages([null])).toBe(PAGE_RULE);
  });
});
