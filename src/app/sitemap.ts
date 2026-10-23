import type { MetadataRoute } from "next";
import { EVALUATIONS_CANONICAL_URL } from "@/lib/evaluations/catalog";
import { PRE_EVALUATION_CANONICAL } from "@/lib/pre-evaluation/handoff";
import { FAQ_CANONICAL, GUIDES_CANONICAL } from "@/lib/content/faq";
import { publishedPosts } from "@/lib/content/posts";
import { INFO_SLUGS, loadInfoPage } from "@/lib/content/info-pages";
import { API_DOCS_CANONICAL, HOME_CANONICAL, PREVAL_CANONICAL, TRANSLATE_CANONICAL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: HOME_CANONICAL },
    { url: TRANSLATE_CANONICAL },
    { url: EVALUATIONS_CANONICAL_URL },
    { url: PREVAL_CANONICAL },
    { url: PRE_EVALUATION_CANONICAL },
    { url: GUIDES_CANONICAL },
    { url: FAQ_CANONICAL },
    ...INFO_SLUGS.map((slug) => ({ url: loadInfoPage(slug).canonical })),
    { url: API_DOCS_CANONICAL },
    ...publishedPosts().map((post) => ({ url: post.canonical })),
  ];
}
