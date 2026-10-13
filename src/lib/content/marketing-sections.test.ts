import { describe, expect, it } from "vitest";
import { evaluationsPage, homePage } from "./marketing";
import { faqOf, listOf, marketingSections, sectionByHeading } from "./marketing-sections";

describe("marketing sections", () => {
  it("keeps the translation headings, steps, and certification rule", () => {
    const sections = marketingSections(homePage.body);
    expect(sections.map((section) => section.heading)).toEqual([
      "Certified translations accepted by USCIS, and you see them first",
      "How it works",
      "Documents we translate",
      "Who uses CredPronto",
      "Clear pricing",
      "Frequently asked questions",
    ]);
    expect(listOf(sectionByHeading(sections, "How it works"), true).map((item) => item.lead)).toEqual([
      "Upload",
      "Confirm the details",
      "Preview for free",
      "Pay and download",
    ]);
    expect(listOf(sectionByHeading(sections, "How it works"), true)[2]?.text).toContain(
      "Most previews are ready in 3 minutes.",
    );
    const includes = listOf(
      sectionByHeading(sections, "Certified translations accepted by USCIS, and you see them first"),
      false,
    );
    expect(includes.map((item) => item.text).join(" ")).toContain("8 CFR 103.2(b)(3)");
    expect(faqOf(sectionByHeading(sections, "Frequently asked questions"))).toHaveLength(7);
  });

  it("keeps the evaluation headings and steps", () => {
    const sections = marketingSections(evaluationsPage.body);
    expect(sections.map((section) => section.heading)).toEqual([
      "What a credential evaluation is",
      "Which evaluation do you need?",
      "Common uses",
      "What to upload",
      "How it works",
      "Frequently asked questions",
    ]);
    expect(listOf(sectionByHeading(sections, "How it works"), true).map((item) => item.lead)).toEqual([
      "Upload",
      "Preview",
      "Pay",
      "Sign-off",
    ]);
    expect(faqOf(sectionByHeading(sections, "Frequently asked questions"))[0]?.answer).toContain(
      "check their instructions before you order",
    );
  });
});
