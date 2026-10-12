import type { Metadata } from "next";
import { PostList } from "@/components/content/content-page";
import { GUIDES_CANONICAL } from "@/lib/content/faq";
import { publishedPosts } from "@/lib/content/posts";

export const metadata: Metadata = {
  title: "Guides · CredPronto",
  description:
    "Guides on certified translations for USCIS, notarization, birth certificates, and preparing a document.",
  alternates: { canonical: GUIDES_CANONICAL },
};

export default function GuidesIndexPage() {
  return (
    <PostList
      kicker="Resources"
      title="Guides"
      lede="Certified translation guides, including what USCIS asks for, notarization, birth certificates, and how to prepare a document."
      posts={publishedPosts("guides")}
    />
  );
}
