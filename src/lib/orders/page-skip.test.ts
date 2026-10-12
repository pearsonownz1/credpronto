import { describe, expect, it } from "vitest";
import { UNIT_PRICE_CENTS } from "./constants";
import { quotePages } from "./page-skip";

const CHINESE =
  "教育部学历证书电子注册备案表 验证报告 姓名张伟 性别男 出生日期一九九八年六月一日 院校北京大学 层次本科 专业计算机科学与技术 学号2019001234 证书编号120190001234 学信网CHESICC";

const ENGLISH =
  "Verification Report of China Higher Education Student's Academic Transcript. This is to certify that the following information is true and correct. Name Zhang Wei. Date of birth 1 June 1998. Institution Peking University. The Ministry of Education issued this verification report.";

const LABEL = "DHL EXPRESS WAYBILL\nSHIP TO NEW YORK\nTRACKING 1234567890";

describe("quote pages", () => {
  it("bills four Chinese CHESICC pages and skips the English pages and the DHL label", () => {
    const texts = [CHINESE, ENGLISH, CHINESE, ENGLISH, CHINESE, ENGLISH, CHINESE, ENGLISH, LABEL];
    const pages = quotePages({ texts, targetLanguage: "en" });

    expect(pages).toHaveLength(9);
    expect(pages.filter((page) => page.skip)).toHaveLength(5);
    const billed = pages.reduce((sum, page) => sum + page.billableUnits, 0);
    expect(billed).toBe(4);
    expect(billed * UNIT_PRICE_CENTS).toBe(3980);
    expect(pages.map((page) => page.skipReason)).toEqual([
      null,
      "target_language",
      null,
      "target_language",
      null,
      "target_language",
      null,
      "target_language",
      "not_document",
    ]);
    expect(pages.every((page) => page.pageIndex === pages.indexOf(page) + 1)).toBe(true);
  });

  it("skips a blank page and bills a page only after 1,000 units", () => {
    const dense = "学".repeat(1001);
    const pages = quotePages({ texts: ["   ", dense], targetLanguage: "en" });
    expect(pages[0]).toMatchObject({ skip: true, skipReason: "blank", billableUnits: 0 });
    expect(pages[1]).toMatchObject({ skip: false, billableUnits: 2, units: 1001 });
  });

  it("treats skipPages as the full list, so an English page can be billed", () => {
    const pages = quotePages({
      texts: [CHINESE, ENGLISH],
      targetLanguage: "en",
      skipPages: [],
    });
    expect(pages.every((page) => page.skip)).toBe(false);
    expect(pages.reduce((sum, page) => sum + page.billableUnits, 0)).toBe(2);

    const chosen = quotePages({
      texts: [CHINESE, ENGLISH],
      targetLanguage: "en",
      skipPages: [1],
    });
    expect(chosen[0]).toMatchObject({ skip: true, skipReason: "customer", billableUnits: 0 });
    expect(chosen[1]).toMatchObject({ skip: false, billableUnits: 1 });
  });
});
