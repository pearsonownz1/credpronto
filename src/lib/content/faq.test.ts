import { describe, expect, it } from "vitest";
import { evaluationCopyPromisesTurnaround } from "@/lib/evaluations/catalog";
import { FAQ_ITEMS, faqPageJsonLd } from "./faq";

describe("FAQ", () => {
  it("describes certified translation and evaluations without expert opinion letters or a clock-time promise", () => {
    const text = FAQ_ITEMS.map((item) => `${item.question}\n${item.answer}`).join("\n");
    expect(text).toMatch(/certified translation/i);
    expect(text).toMatch(/diploma evaluation/i);
    expect(text).toMatch(/course-by-course/i);
    expect(text).not.toMatch(/expert opinion/i);
    expect(
      evaluationCopyPromisesTurnaround(FAQ_ITEMS.flatMap((item) => [item.question, item.answer])),
    ).toBe(false);

    const jsonLd = faqPageJsonLd();
    expect(jsonLd["@type"]).toBe("FAQPage");
    expect(jsonLd.mainEntity).toHaveLength(FAQ_ITEMS.length);
    expect(jsonLd.mainEntity[0]).toMatchObject({
      "@type": "Question",
      acceptedAnswer: { "@type": "Answer" },
    });
  });
});
