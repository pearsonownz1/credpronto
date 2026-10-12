import type { MetadataRoute } from "next";
import { HOME_CANONICAL, TRANSLATE_CANONICAL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: HOME_CANONICAL }, { url: TRANSLATE_CANONICAL }];
}
