import { describe, expect, it } from "vitest";
import { allPosts, getPublishedPost, publishedPosts } from "./posts";

const DRAFT_SLUG = "does-uscis-require-a-certified-translation";

describe("MDX posts", () => {
  it("keeps the USCIS article as an unpublished draft", () => {
    const draft = allPosts().find((post) => post.slug === DRAFT_SLUG);
    expect(draft).toMatchObject({
      section: "blog",
      title: "Does USCIS require a certified translation?",
      draft: true,
      canonical: `https://www.credpronto.com/blog/${DRAFT_SLUG}`,
    });
    expect(publishedPosts().some((post) => post.slug === DRAFT_SLUG)).toBe(false);
    expect(getPublishedPost("blog", DRAFT_SLUG)).toBeNull();
  });

  it("publishes blog posts and guides with www canonicals and covers", () => {
    expect(publishedPosts().map((post) => post.canonical)).toEqual([
      "https://www.credpronto.com/blog/what-a-certified-translation-includes",
      "https://www.credpronto.com/blog/preview-your-translation-before-you-pay",
      "https://www.credpronto.com/guides/prepare-a-document-for-translation",
    ]);
    for (const post of allPosts()) {
      expect(post.body.length).toBeGreaterThan(0);
      expect(post.cover.startsWith("/images/")).toBe(true);
      expect(post.description.length).toBeGreaterThan(0);
    }
  });
});
