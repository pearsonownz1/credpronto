import { describe, expect, it } from "vitest";
import { allPosts, articleJsonLd, getPublishedPost, publishedPosts } from "./posts";

const DRAFT_SLUG = "does-uscis-require-a-certified-translation";

describe("guides", () => {
  it("keeps the placeholder USCIS draft unpublished", () => {
    const draft = allPosts().find((post) => post.slug === DRAFT_SLUG);
    expect(draft).toMatchObject({
      section: "guides",
      title: "Does USCIS require a certified translation?",
      draft: true,
      canonical: `https://www.credpronto.com/guides/${DRAFT_SLUG}`,
    });
    expect(publishedPosts().some((post) => post.slug === DRAFT_SLUG)).toBe(false);
    expect(getPublishedPost("guides", DRAFT_SLUG)).toBeNull();
  });

  it("publishes moved articles and guides on www /guides URLs", () => {
    expect(publishedPosts().map((post) => post.canonical)).toEqual([
      "https://www.credpronto.com/guides/birth-certificate-translation-uscis",
      "https://www.credpronto.com/guides/certified-vs-notarized-translation",
      "https://www.credpronto.com/guides/uscis-certified-translation",
      "https://www.credpronto.com/guides/what-a-certified-translation-includes",
      "https://www.credpronto.com/guides/preview-your-translation-before-you-pay",
      "https://www.credpronto.com/guides/prepare-a-document-for-translation",
    ]);
    expect(publishedPosts().some((post) => post.canonical.includes("/blog/"))).toBe(false);
    for (const post of allPosts()) {
      expect(post.body.length).toBeGreaterThan(0);
      expect(post.description.length).toBeGreaterThan(0);
      if (post.author) expect(post.cover).toBeNull();
      else expect(post.cover?.startsWith("/images/")).toBe(true);
    }
  });

  it("uses each approved guide title, byline, date, and Article JSON-LD", () => {
    const birth = getPublishedPost("guides", "birth-certificate-translation-uscis");
    const uscis = getPublishedPost("guides", "uscis-certified-translation");
    const notarized = getPublishedPost("guides", "certified-vs-notarized-translation");

    expect(birth?.documentTitle).toBe("Birth Certificate Translation for USCIS: What You Need");
    expect(birth?.headline).toBe("How to translate a birth certificate for USCIS");
    expect(uscis?.documentTitle).toBe("Does USCIS Require a Certified Translation? | CredPronto");
    expect(notarized?.documentTitle).toBe(
      "Certified vs. Notarized Translation: What's the Difference?",
    );

    for (const post of [birth, uscis, notarized]) {
      expect(post?.author).toBe("Guy Pearson");
      expect(post?.date).toBe("2026-10-12");
      expect(post?.body).toContain("By Guy Pearson");
      expect(post?.body).toContain("Last updated Oct 12, 2026");
      const jsonLd = articleJsonLd(post!);
      expect(jsonLd).toMatchObject({
        "@type": "Article",
        headline: post?.headline,
        dateModified: "2026-10-12",
        author: { "@type": "Person", name: "Guy Pearson" },
        mainEntityOfPage: post?.canonical,
      });
      expect(JSON.stringify(jsonLd)).not.toMatch(/AggregateRating|"@type":"Review"/);
    }

    expect(uscis?.body).toContain("These are certified translations accepted by USCIS.");
    expect(birth?.body).toContain("These are certified translations accepted by USCIS.");
  });
});
