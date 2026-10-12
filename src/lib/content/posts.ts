import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import matter from "gray-matter";
import { SITE_ORIGIN } from "@/lib/seo";

export type ContentSection = "guides";

export type Post = {
  section: ContentSection;
  /** Short title used for legacy posts. Authored guides store the document title here. */
  title: string;
  /** Exact document `<title>`. */
  documentTitle: string;
  /** Visible article heading. */
  headline: string;
  description: string;
  slug: string;
  date: string;
  cover: string | null;
  canonical: string;
  draft: boolean;
  body: string;
  author: string | null;
};

const CONTENT_ROOT = path.join(process.cwd(), "content");
const PUBLIC_ROOT = path.join(process.cwd(), "public");

function requiredString(value: unknown, field: string, file: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${file}: frontmatter ${field} must be a non-empty string`);
  }
  return value.trim();
}

function dateString(value: unknown, file: string, field = "date"): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const date = requiredString(value, field, file);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${file}: ${field} must be YYYY-MM-DD`);
  }
  return date;
}

function headlineFromBody(body: string, file: string): string {
  const match = body.match(/^#\s+(.+)$/m);
  if (!match) throw new Error(`${file}: guide must include a level-1 heading`);
  return match[1].trim();
}

function loadLegacy(section: ContentSection, dir: string, name: string): Post {
  const slug = name.replace(/\.mdx$/, "");
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
  assertCoverFile(cover, name);

  const expectedCanonical = `${SITE_ORIGIN}/${section}/${slug}`;
  if (canonical !== expectedCanonical) {
    throw new Error(`${name}: canonical must be ${expectedCanonical}`);
  }

  return {
    section,
    title,
    documentTitle: `${title} · CredPronto`,
    headline: title,
    description,
    slug,
    date,
    cover,
    canonical,
    draft: data.draft === true,
    body: parsed.content.trim(),
    author: null,
  };
}

function loadAuthoredGuide(section: ContentSection, dir: string, name: string): Post {
  const slug = name.replace(/\.md$/, "");
  const parsed = matter(fs.readFileSync(path.join(dir, name), "utf8"));
  const data = parsed.data;
  const title = requiredString(data.title, "title", name);
  const description = requiredString(data.description, "description", name);
  const url = requiredString(data.url, "url", name);
  const canonical = requiredString(data.canonical, "canonical", name);
  const author = requiredString(data.author, "author", name);
  const date = dateString(data.last_updated, name, "last_updated");
  const body = parsed.content.trim();
  const cover = `/guides/covers/${slug}.png`;
  assertCoverFile(cover, name);

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`${name}: slug must match the filename`);
  }
  if (url !== `/${section}/${slug}`) {
    throw new Error(`${name}: url must be /${section}/${slug}`);
  }
  const expectedCanonical = `${SITE_ORIGIN}/${section}/${slug}`;
  if (canonical !== expectedCanonical) {
    throw new Error(`${name}: canonical must be ${expectedCanonical}`);
  }

  return {
    section,
    title,
    documentTitle: title,
    headline: headlineFromBody(body, name),
    description,
    slug,
    date,
    cover,
    canonical,
    draft: false,
    body,
    author,
  };
}

function assertCoverFile(cover: string, file: string): void {
  if (!cover.startsWith("/") || cover.includes("..")) {
    throw new Error(`${file}: cover must be a site path`);
  }
  const coverFile = path.resolve(PUBLIC_ROOT, cover.replace(/^\/+/, ""));
  if (!coverFile.startsWith(PUBLIC_ROOT + path.sep) || !fs.existsSync(coverFile)) {
    throw new Error(`${file}: cover image is missing (${cover})`);
  }
}

function loadSection(section: ContentSection): Post[] {
  const dir = path.join(CONTENT_ROOT, section);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md") || name.endsWith(".mdx"))
    .sort()
    .map((name) =>
      name.endsWith(".mdx")
        ? loadLegacy(section, dir, name)
        : loadAuthoredGuide(section, dir, name),
    );
}

let cached: Post[] | null = null;

export function allPosts(): Post[] {
  if (!cached) {
    cached = loadSection("guides").sort((a, b) => {
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

export function guideCoverAlt(headline: string): string {
  return `Cover for the guide "${headline}"`;
}

/** Approximate minutes to read, at 200 words per minute. */
export function readingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

export function postMetadata(post: Post): Metadata {
  const socialTitle = post.author ? post.documentTitle : post.title;
  const image = post.cover ? new URL(post.cover, SITE_ORIGIN).toString() : null;
  const openGraph: NonNullable<Metadata["openGraph"]> = {
    title: socialTitle,
    description: post.description,
    url: post.canonical,
    type: "article",
    ...(image
      ? {
          images: [{ url: image, width: 1200, height: 630, alt: guideCoverAlt(post.headline) }],
        }
      : {}),
  };
  const twitter: NonNullable<Metadata["twitter"]> = image
    ? {
        card: "summary_large_image",
        title: socialTitle,
        description: post.description,
        images: [image],
      }
    : {
        card: "summary",
        title: socialTitle,
        description: post.description,
      };
  return {
    title: post.documentTitle,
    description: post.description,
    alternates: { canonical: post.canonical },
    openGraph,
    twitter,
  };
}

export function articleJsonLd(post: Post) {
  if (!post.author) return null;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.headline,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    author: {
      "@type": "Person",
      name: post.author,
    },
    mainEntityOfPage: post.canonical,
    url: post.canonical,
    publisher: {
      "@type": "Organization",
      name: "CredPronto",
      url: `${SITE_ORIGIN}/`,
      logo: `${SITE_ORIGIN}/logo-1080.png`,
    },
  };
}
