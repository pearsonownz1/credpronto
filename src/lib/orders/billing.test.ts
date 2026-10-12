import { describe, expect, it } from "vitest";
import {
  CJK_PAGE_RULE,
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

  it("counts 250 words as one page and 251 words as two", () => {
    expect(billableUnits(1)).toBe(1);
    expect(billableUnits(250)).toBe(1);
    expect(billableUnits(251)).toBe(2);
    expect(billableUnits(500)).toBe(2);
    expect(billableUnits(501)).toBe(3);
    expect(billableUnits(750)).toBe(3);
  });

  it("counts 400 CJK units as one page and 401 units as two", () => {
    expect(billableCjkUnits(1)).toBe(1);
    expect(billableCjkUnits(400)).toBe(1);
    expect(billableCjkUnits(401)).toBe(2);
    expect(billableCjkUnits(800)).toBe(2);
    expect(billableCjkUnits(801)).toBe(3);
  });

  it("bills three dense sides as six pages", () => {
    const pages = sumBillableUnits([300, 300, 300]);
    expect(pages).toBe(6);
    expect(totalCents(pages)).toBe(5970);
    expect(totalCents(3)).toBe(2985);
  });

  it("prices the two-sided diploma example at 3 pages and $29.85", () => {
    const pages = sumBillableUnits([180, 400]);
    expect(pages).toBe(3);
    expect(totalCents(pages, 995)).toBe(2985);
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

  it("describes the rule that applies to the detected language", () => {
    expect(pageRuleForLanguages(["es"])).toBe(WORD_PAGE_RULE);
    expect(pageRuleForLanguages(["zh"])).toBe(CJK_PAGE_RULE);
    expect(pageRuleForLanguages(["ja", "ko"])).toBe(CJK_PAGE_RULE);
    expect(pageRuleForLanguages(["zh", "es"])).toContain("400 units");
    expect(pageRuleForLanguages(["zh", "es"])).toContain("250 words");
    expect(pageRuleForLanguages([null])).toBe(WORD_PAGE_RULE);
  });
});
