import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt?: string; src?: string }) => createElement("img", { alt, src }),
}));

import { MarketingHeaderFrame } from "./marketing-header";

function renderNav(section?: "translations" | "evaluations" | "preval" | "pricing") {
  return renderToStaticMarkup(
    createElement(MarketingHeaderFrame, {
      section,
      account: createElement("a", { href: "/sign-in" }, "Sign in"),
    }),
  );
}

function slice(html: string, startId: string, endId?: string) {
  const start = html.indexOf(`data-testid="${startId}"`);
  const end = endId ? html.indexOf(`data-testid="${endId}"`) : html.length;
  return html.slice(start, end);
}

function tags(html: string, testId: string) {
  return [...html.matchAll(new RegExp(`<a\\b[^>]*data-testid="${testId}"[^>]*>`, "g"))].map((match) => match[0]);
}

describe("marketing header", () => {
  it("links PreVal on desktop and in the mobile menu, blue when that page is current", () => {
    const html = renderNav("preval");
    const desktop = slice(html, "nav-desktop", "nav-mobile");
    const mobile = slice(html, "nav-mobile");

    for (const region of [desktop, mobile]) {
      const [link] = tags(region, "nav-preval");
      expect(link).toBeDefined();
      expect(link).toContain('href="/preval"');
      expect(link).toContain('aria-current="page"');
      expect(link).toContain("font-bold");
      expect(link).toContain("text-[#2160ff]");
      expect(region).toContain(">PreVal<");
    }

    expect(tags(html, "nav-preval")).toHaveLength(2);
    expect(html).toContain('href="/"');
    expect(html).toContain(">Translations<");
    expect(html).toContain('href="/evaluations"');
    expect(html).toContain(">Evaluations<");
    expect(html).toContain('href="/#pricing"');
    expect(html).toContain(">Pricing<");
    expect(html).toContain('href="/translate"');
    expect(html).toContain(">Get started<");
  });

  it("keeps the existing active style on other sections", () => {
    const html = renderNav("evaluations");
    const [evaluations] = [...html.matchAll(/<a\b[^>]*href="\/evaluations"[^>]*>/g)].map((match) => match[0]);
    expect(evaluations).toContain('aria-current="page"');
    expect(evaluations).toContain("font-semibold");
    expect(evaluations).toContain("text-ink");
    expect(evaluations).not.toContain("text-[#2160ff]");

    for (const link of tags(html, "nav-preval")) {
      expect(link).toContain('href="/preval"');
      expect(link).not.toContain("aria-current");
      expect(link).toContain("text-ink-muted");
      expect(link).not.toContain("text-[#2160ff]");
    }
  });
});
