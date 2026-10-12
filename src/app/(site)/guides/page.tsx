import type { Metadata } from "next";
import { PostList } from "@/components/content/content-page";
import { GUIDES_CANONICAL } from "@/lib/content/faq";
import { publishedPosts } from "@/lib/content/posts";

export const metadata: Metadata = {
  title: "Guides · CredPronto",
  description: "Practical guides for uploading documents and ordering a certified translation.",
  alternates: { canonical: GUIDES_CANONICAL },
};

export default function GuidesIndexPage() {
  return (
    <PostList
      kicker="Resources"
      title="Guides"
      lede="Short guides for preparing a document and ordering a certified translation you can preview first."
      posts={publishedPosts("guides")}
    />
  );
}
