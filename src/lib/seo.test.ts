import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { EVALUATIONS_CANONICAL_URL } from "@/lib/evaluations/catalog";
import { FAQ_CANONICAL, GUIDES_CANONICAL } from "@/lib/content/faq";
import {
  API_DOCS_CANONICAL,
  HOME_CANONICAL,
  ROBOTS_NOINDEX,
  SITE_ORIGIN,
  TRANSLATE_CANONICAL,
  authRedirects,
  blogRedirects,
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
      GUIDES_CANONICAL,
      FAQ_CANONICAL,
      "https://www.credpronto.com/privacy",
      "https://www.credpronto.com/terms",
      "https://www.credpronto.com/about",
      "https://www.credpronto.com/contact",
      API_DOCS_CANONICAL,
      "https://www.credpronto.com/guides/birth-certificate-translation-uscis",
      "https://www.credpronto.com/guides/certified-vs-notarized-translation",
      "https://www.credpronto.com/guides/uscis-certified-translation",
      "https://www.credpronto.com/guides/what-a-certified-translation-includes",
      "https://www.credpronto.com/guides/preview-your-translation-before-you-pay",
      "https://www.credpronto.com/guides/prepare-a-document-for-translation",
    ]);
    expect(sitemap().some((entry) => entry.url.includes("/blog"))).toBe(false);
    expect(
      sitemap().some((entry) =>
        entry.url.endsWith("/guides/does-uscis-require-a-certified-translation"),
      ),
    ).toBe(false);
  });

  it("redirects /blog to /guides with 301", () => {
    expect(blogRedirects()).toEqual([
      { source: "/blog", destination: "/guides", statusCode: 301 },
      { source: "/blog/:slug", destination: "/guides/:slug", statusCode: 301 },
    ]);
  });

  it("redirects /login to /sign-in with 301", () => {
    expect(authRedirects()).toEqual([{ source: "/login", destination: "/sign-in", statusCode: 301 }]);
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
