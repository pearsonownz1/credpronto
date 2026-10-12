import { describe, expect, it } from "vitest";
import { allPosts, articleJsonLd, getPublishedPost, postMetadata, publishedPosts, readingMinutes } from "./posts";

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
      if (post.draft) expect(post.cover?.startsWith("/images/")).toBe(true);
      else expect(post.cover).toBe(`/guides/covers/${post.slug}.png`);
    }
  });

  it("uses each cover as the absolute Open Graph and Twitter image", () => {
    for (const post of publishedPosts()) {
      const image = `https://www.credpronto.com/guides/covers/${post.slug}.png`;
      expect(readingMinutes(post.body)).toBeGreaterThan(0);
      expect(postMetadata(post).openGraph).toMatchObject({
        images: [{ url: image, width: 1200, height: 630, alt: `Cover for the guide "${post.headline}"` }],
      });
      expect(postMetadata(post).twitter).toMatchObject({
        card: "summary_large_image",
        images: [image],
      });
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
      expect(post?.author).toBe("CredPronto Editorial Team");
      expect(post?.date).toBe("2026-10-12");
      expect(post?.body).toContain("By CredPronto Editorial Team");
      expect(post?.body).toContain("Last updated Oct 12, 2026");
      const jsonLd = articleJsonLd(post!);
      expect(jsonLd).toMatchObject({
        "@type": "Article",
        headline: post?.headline,
        dateModified: "2026-10-12",
        author: { "@type": "Organization", name: "CredPronto Editorial Team" },
        mainEntityOfPage: post?.canonical,
      });
      expect(JSON.stringify(jsonLd)).not.toMatch(/AggregateRating|"@type":"Review"/);
    }

    expect(uscis?.body).toContain("These are certified translations accepted by USCIS.");
    expect(birth?.body).toContain("These are certified translations accepted by USCIS.");
  });
});
