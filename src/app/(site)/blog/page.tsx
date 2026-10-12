import type { Metadata } from "next";
import { PostList } from "@/components/content/content-page";
import { BLOG_CANONICAL } from "@/lib/content/faq";
import { publishedPosts } from "@/lib/content/posts";

export const metadata: Metadata = {
  title: "Blog · CredPronto",
  description: "Articles on certified translations and how CredPronto prepares them.",
  alternates: { canonical: BLOG_CANONICAL },
};

export default function BlogIndexPage() {
  return (
    <PostList
      kicker="Resources"
      title="Blog"
      lede="Notes on certified translations, from what the certification covers to how the free preview works."
      posts={publishedPosts("blog")}
    />
  );
}
