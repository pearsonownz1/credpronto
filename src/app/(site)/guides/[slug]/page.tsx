import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostArticle } from "@/components/content/content-page";
import { getPublishedPost, postMetadata, publishedPosts } from "@/lib/content/posts";

type Params = { slug: string };

export function generateStaticParams() {
  return publishedPosts("guides").map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPublishedPost("guides", slug);
  return post ? postMetadata(post) : {};
}

export default async function GuidePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const post = getPublishedPost("guides", slug);
  if (!post) notFound();
  return <PostArticle post={post} />;
}
