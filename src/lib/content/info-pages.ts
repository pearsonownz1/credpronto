import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import matter from "gray-matter";
import { SITE_ORIGIN } from "@/lib/seo";

export const INFO_SLUGS = ["privacy", "terms", "about", "contact"] as const;

export type InfoSlug = (typeof INFO_SLUGS)[number];

export type InfoPage = {
  slug: InfoSlug;
  title: string;
  description: string;
  canonical: string;
  body: string;
};

const INFO_ROOT = path.join(process.cwd(), "content/info");

function requiredString(value: unknown, field: string, file: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${file}: frontmatter ${field} must be a non-empty string`);
  }
  return value.trim();
}

export function loadInfoPage(slug: InfoSlug): InfoPage {
  const name = `${slug}.md`;
  const parsed = matter(fs.readFileSync(path.join(INFO_ROOT, name), "utf8"));
  const title = requiredString(parsed.data.title, "title", name);
  const description = requiredString(parsed.data.description, "description", name);
  const canonical = `${SITE_ORIGIN}/${slug}`;
  return {
    slug,
    title,
    description,
    canonical,
    body: parsed.content.trim(),
  };
}

export function infoMetadata(slug: InfoSlug): Metadata {
  const page = loadInfoPage(slug);
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: page.canonical },
  };
}
