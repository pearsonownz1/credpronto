import { describe, expect, it } from "vitest";
import {
  ORGANIZATION_JSON_LD,
  evaluationsFaq,
  evaluationsPage,
  homeFaq,
  homeFaqJsonLd,
  homePage,
} from "./marketing";

describe("approved marketing pages", () => {
  it("uses the homepage title, description, and canonical", () => {
    expect(homePage.title).toBe(
      "Certified Translation from $9.95/Page, Preview Free | CredPronto",
    );
    expect(homePage.description).toBe(
      "Certified translations accepted by USCIS from $9.95 a page. Upload your document, see the full translation side by side in about 10 minutes, and pay only if it's right.",
    );
    expect(homePage.canonical).toBe("https://www.credpronto.com/");
    expect(homePage.body).toContain("Certified translations accepted by USCIS, and you see them first");
  });

  it("uses the evaluations title, description, and canonical", () => {
    expect(evaluationsPage.title).toBe(
      "Credential Evaluation from $19.95, Foreign Degree to U.S. Equivalent | CredPronto",
    );
    expect(evaluationsPage.description).toBe(
      "Get a foreign degree evaluated for its U.S. equivalent. Diploma evaluations from $19.95, course-by-course with GPA from $39.95. Preview the report before you pay.",
    );
    expect(evaluationsPage.canonical).toBe("https://www.credpronto.com/evaluations");
    expect(evaluationsPage.body).toContain("](/guides/uscis-certified-translation)");
    expect(evaluationsPage.body).toContain("](/guides/what-a-certified-translation-includes)");
  });

  it("builds FAQPage JSON-LD without review markup", () => {
    expect(homeFaq().find((item) => item.question === "What counts as a page?")?.answer).toContain(
      "1,000 Chinese, Japanese, or Korean characters",
    );
    expect(homeFaq().find((item) => item.question === "What counts as a page?")?.answer).not.toContain(
      "400 units",
    );
    expect(homeFaq().map((item) => item.question)).toEqual([
      "Does USCIS accept CredPronto translations?",
      "Do I need a notarized translation?",
      "Can I translate my own documents for USCIS?",
      "What counts as a page?",
      "How fast will I get it?",
      "Are my documents private?",
      "Who's behind CredPronto?",
    ]);
    expect(evaluationsFaq()).toHaveLength(4);
    const jsonLd = homeFaqJsonLd();
    expect(jsonLd["@type"]).toBe("FAQPage");
    expect(jsonLd.mainEntity[0]?.acceptedAnswer.text).toContain("Read our USCIS translation guide");
    expect(JSON.stringify(jsonLd)).not.toMatch(/AggregateRating|"@type":"Review"/);
    expect(JSON.stringify(ORGANIZATION_JSON_LD)).not.toMatch(/AggregateRating|"@type":"Review"/);
    expect(ORGANIZATION_JSON_LD).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "CredPronto",
      url: "https://www.credpronto.com/",
      logo: "https://www.credpronto.com/logo-1080.png",
    });
  });
});
