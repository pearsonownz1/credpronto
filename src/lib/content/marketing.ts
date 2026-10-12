import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { faqPageJsonLd, type FaqItem } from "@/lib/content/faq";
import { EVALUATIONS_CANONICAL_URL } from "@/lib/evaluations/catalog";
import { HOME_CANONICAL, SITE_ORIGIN } from "@/lib/seo";

export type MarketingPage = {
  url: string;
  title: string;
  description: string;
  canonical: string;
  body: string;
};

const PAGES_ROOT = path.join(process.cwd(), "content/pages");

function requiredString(value: unknown, field: string, file: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${file}: frontmatter ${field} must be a non-empty string`);
  }
  return value.trim();
}

function loadMarketingPage(name: string, expected: { url: string; canonical: string }): MarketingPage {
  const parsed = matter(fs.readFileSync(path.join(PAGES_ROOT, name), "utf8"));
  const data = parsed.data;
  const page: MarketingPage = {
    url: requiredString(data.url, "url", name),
    title: requiredString(data.title, "title", name),
    description: requiredString(data.description, "description", name),
    canonical: requiredString(data.canonical, "canonical", name),
    body: parsed.content.trim(),
  };
  if (page.url !== expected.url) throw new Error(`${name}: url must be ${expected.url}`);
  if (page.canonical !== expected.canonical) {
    throw new Error(`${name}: canonical must be ${expected.canonical}`);
  }
  return page;
}

export const homePage = loadMarketingPage("home.md", {
  url: "/",
  canonical: HOME_CANONICAL,
});

export const evaluationsPage = loadMarketingPage("evaluations.md", {
  url: "/evaluations",
  canonical: EVALUATIONS_CANONICAL_URL,
});

export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)\*([^*]+)\*(?=\s|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

export function faqFromMarkdown(markdown: string): FaqItem[] {
  const heading = "## Frequently asked questions";
  const start = markdown.indexOf(heading);
  if (start < 0) return [];
  const lines = markdown.slice(start + heading.length).split("\n");
  const items: FaqItem[] = [];
  let question: string | null = null;
  let answer: string[] = [];

  function flush() {
    if (!question) return;
    const text = plainText(answer.join(" ").trim());
    if (text) items.push({ question, answer: text });
  }

  for (const line of lines) {
    const match = line.match(/^\*\*(.+)\*\*$/);
    if (match) {
      flush();
      question = match[1];
      answer = [];
      continue;
    }
    if (line.startsWith("## ")) break;
    if (question && line.trim()) answer.push(line.trim());
  }
  flush();
  return items;
}

export function splitFirstSection(body: string): { intro: string; rest: string } {
  const index = body.indexOf("\n## ");
  if (index === -1) return { intro: body, rest: "" };
  return { intro: body.slice(0, index).trim(), rest: body.slice(index).trim() };
}

export function homeFaq(): FaqItem[] {
  return faqFromMarkdown(homePage.body);
}

export function evaluationsFaq(): FaqItem[] {
  return faqFromMarkdown(evaluationsPage.body);
}

export function homeFaqJsonLd() {
  return faqPageJsonLd(homeFaq());
}

export function evaluationsFaqJsonLd() {
  return faqPageJsonLd(evaluationsFaq());
}

export const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "CredPronto",
  url: `${SITE_ORIGIN}/`,
  logo: `${SITE_ORIGIN}/logo-1080.png`,
};
