import { describe, expect, it } from "vitest";
import {
  CJK_PAGE_RULE,
  PAGE_RULE,
  WORD_PAGE_RULE,
  billableCjkUnits,
  billableUnits,
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

  it("counts 1,000 units as one page and 1,001 units as two", () => {
    expect(billableUnits(1)).toBe(1);
    expect(billableUnits(1000)).toBe(1);
    expect(billableUnits(1001)).toBe(2);
    expect(billableUnits(2000)).toBe(2);
    expect(billableUnits(2001)).toBe(3);
    expect(billableCjkUnits(1001)).toBe(2);
  });

  it("prices a two-sided diploma under 1,000 units at 2 pages and $19.90", () => {
    const pages = sumBillableUnits([180, 400]);
    expect(pages).toBe(2);
    expect(totalCents(pages, 995)).toBe(1990);
  });

  it("counts 学号 2019 GPA 3.85 as 5 units", () => {
    expect(countCjkUnits("学号 2019 GPA 3.85")).toBe(5);
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

  it("describes the 1,000-unit physical page rule for every language", () => {
    expect(pageRuleForLanguages(["es"])).toBe(WORD_PAGE_RULE);
    expect(pageRuleForLanguages(["zh"])).toBe(CJK_PAGE_RULE);
    expect(pageRuleForLanguages(["zh", "es"])).toContain("1,000 units");
    expect(pageRuleForLanguages(["zh", "es"])).not.toContain("400 units");
    expect(pageRuleForLanguages([null])).toBe(PAGE_RULE);
  });
});
