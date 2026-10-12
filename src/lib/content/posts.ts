import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import matter from "gray-matter";
import { SITE_ORIGIN } from "@/lib/seo";

export type ContentSection = "blog" | "guides";

export type Post = {
  section: ContentSection;
  title: string;
  description: string;
  slug: string;
  date: string;
  cover: string;
  canonical: string;
  draft: boolean;
  body: string;
};

const CONTENT_ROOT = path.join(process.cwd(), "content");
const PUBLIC_ROOT = path.join(process.cwd(), "public");

function requiredString(value: unknown, field: string, file: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${file}: frontmatter ${field} must be a non-empty string`);
  }
  return value.trim();
}

function dateString(value: unknown, file: string): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return requiredString(value, "date", file);
}

function loadFile(section: ContentSection, dir: string, name: string): Post {
  const slug = name.slice(0, -".mdx".length);
  const parsed = matter(fs.readFileSync(path.join(dir, name), "utf8"));
  const data = parsed.data;
  const title = requiredString(data.title, "title", name);
  const description = requiredString(data.description, "description", name);
  const frontSlug = requiredString(data.slug, "slug", name);
  const date = dateString(data.date, name);
  const cover = requiredString(data.cover, "cover", name);
  const canonical = requiredString(data.canonical, "canonical", name);

  if (data.draft !== undefined && typeof data.draft !== "boolean") {
    throw new Error(`${name}: frontmatter draft must be true or false`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || frontSlug !== slug) {
    throw new Error(`${name}: slug must match the filename`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${name}: date must be YYYY-MM-DD`);
  }
  if (!cover.startsWith("/") || cover.includes("..")) {
    throw new Error(`${name}: cover must be a site path`);
  }

  const coverFile = path.resolve(PUBLIC_ROOT, cover.replace(/^\/+/, ""));
  if (!coverFile.startsWith(PUBLIC_ROOT + path.sep) || !fs.existsSync(coverFile)) {
    throw new Error(`${name}: cover image is missing (${cover})`);
  }

  const expectedCanonical = `${SITE_ORIGIN}/${section}/${slug}`;
  if (canonical !== expectedCanonical) {
    throw new Error(`${name}: canonical must be ${expectedCanonical}`);
  }

  return {
    section,
    title,
    description,
    slug,
    date,
    cover,
    canonical,
    draft: data.draft === true,
    body: parsed.content.trim(),
  };
}

function loadSection(section: ContentSection): Post[] {
  const dir = path.join(CONTENT_ROOT, section);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".mdx"))
    .sort()
    .map((name) => loadFile(section, dir, name));
}

let cached: Post[] | null = null;

export function allPosts(): Post[] {
  if (!cached) {
    cached = [...loadSection("blog"), ...loadSection("guides")].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.canonical < b.canonical ? -1 : 1;
    });
  }
  return cached;
}

export function publishedPosts(section?: ContentSection): Post[] {
  return allPosts().filter(
    (post) => !post.draft && (section === undefined || post.section === section),
  );
}

export function getPublishedPost(section: ContentSection, slug: string): Post | null {
  return publishedPosts(section).find((post) => post.slug === slug) ?? null;
}

export function formatPostDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function postMetadata(post: Post): Metadata {
  const image = new URL(post.cover, SITE_ORIGIN).toString();
  return {
    title: `${post.title} · CredPronto`,
    description: post.description,
    alternates: { canonical: post.canonical },
    openGraph: {
      title: post.title,
      description: post.description,
      url: post.canonical,
      type: "article",
      images: [{ url: image, alt: post.title }],
    },
  };
}
