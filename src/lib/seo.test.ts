import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { EVALUATIONS_CANONICAL_URL } from "@/lib/evaluations/catalog";
import { BLOG_CANONICAL, FAQ_CANONICAL, GUIDES_CANONICAL } from "@/lib/content/faq";
import {
  HOME_CANONICAL,
  ROBOTS_NOINDEX,
  SITE_ORIGIN,
  TRANSLATE_CANONICAL,
  privateCrawlHeaders,
} from "./seo";

describe("crawl policy", () => {
  it("allows the site root and blocks private sections", () => {
    expect(robots()).toEqual({
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: ["/preview/", "/order/", "/dashboard", "/admin", "/api"],
      },
      sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    });
  });

  it("lists public www pages and published posts, and leaves drafts unpublished", () => {
    expect(sitemap().map((entry) => entry.url)).toEqual([
      HOME_CANONICAL,
      TRANSLATE_CANONICAL,
      EVALUATIONS_CANONICAL_URL,
      BLOG_CANONICAL,
      GUIDES_CANONICAL,
      FAQ_CANONICAL,
      "https://www.credpronto.com/blog/what-a-certified-translation-includes",
      "https://www.credpronto.com/blog/preview-your-translation-before-you-pay",
      "https://www.credpronto.com/guides/prepare-a-document-for-translation",
    ]);
    expect(sitemap().some((entry) => entry.url.includes("uscis"))).toBe(false);
  });

  it("sets X-Robots-Tag on every preview and order path, including errors", () => {
    expect(privateCrawlHeaders()).toEqual([
      {
        source: "/preview/:path*",
        headers: [{ key: "X-Robots-Tag", value: ROBOTS_NOINDEX }],
      },
      {
        source: "/order/:path*",
        headers: [{ key: "X-Robots-Tag", value: ROBOTS_NOINDEX }],
      },
    ]);
  });
});
