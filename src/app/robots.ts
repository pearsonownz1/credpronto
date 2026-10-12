import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/preview/", "/order/", "/dashboard", "/admin", "/api"],
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
