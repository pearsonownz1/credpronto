import type { MetadataRoute } from "next";
import { EVALUATIONS_CANONICAL_URL } from "@/lib/evaluations/catalog";
import { BLOG_CANONICAL, FAQ_CANONICAL, GUIDES_CANONICAL } from "@/lib/content/faq";
import { publishedPosts } from "@/lib/content/posts";
import { HOME_CANONICAL, TRANSLATE_CANONICAL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: HOME_CANONICAL },
    { url: TRANSLATE_CANONICAL },
    { url: EVALUATIONS_CANONICAL_URL },
    { url: BLOG_CANONICAL },
    { url: GUIDES_CANONICAL },
    { url: FAQ_CANONICAL },
    ...publishedPosts().map((post) => ({ url: post.canonical })),
  ];
}
