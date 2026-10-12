import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
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

  it("lists the public www pages and skips evaluations, which has no route", () => {
    expect(sitemap().map((entry) => entry.url)).toEqual([
      HOME_CANONICAL,
      TRANSLATE_CANONICAL,
    ]);
    expect(sitemap().some((entry) => entry.url.includes("/evaluations"))).toBe(false);
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
