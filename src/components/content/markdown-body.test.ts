import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import { MarkdownBody } from "./markdown-body";

function render(source: string) {
  return renderToStaticMarkup(createElement(MarkdownBody, { source }));
}

describe("markdown body", () => {
  it("renders tables and links, including destinations with parentheses", () => {
    const html = render(
      [
        "| Service | Price |",
        "|---|---|",
        "| Certified translation | $9.95 per page |",
        "",
        "[8 CFR 103.2(b)(3)](https://www.ecfr.gov/current/title-8/chapter-I/subchapter-B/part-103/section-103.2#p-103.2(b)(3))",
        "",
        "**[Get your free preview →](/translate)**",
      ].join("\n"),
    );
    expect(html).toContain("<table");
    expect(html).toContain("$9.95 per page");
    expect(html).toContain(
      "https://www.ecfr.gov/current/title-8/chapter-I/subchapter-B/part-103/section-103.2#p-103.2(b)(3)",
    );
    expect(html).toContain('href="/translate"');
    expect(html).toContain("Get your free preview →");
    expect(html).toContain("bg-primary");
  });

  it("keeps bracketed certification text and parenthetical source links", () => {
    const uscis = matter(
      fs.readFileSync(
        path.join(process.cwd(), "content/guides/uscis-certified-translation.md"),
        "utf8",
      ),
    ).content;
    const uscisHtml = render(uscis);
    expect(uscisHtml).toContain("[Full Name]");
    expect(uscisHtml).toContain("[Language]");
    expect(uscisHtml).toContain(
      'href="https://www.ecfr.gov/current/title-8/chapter-I/subchapter-B/part-103/section-103.2#p-103.2(b)(3)"',
    );
    expect(uscisHtml).toContain("These are certified translations accepted by USCIS.");

    const birth = matter(
      fs.readFileSync(
        path.join(process.cwd(), "content/guides/birth-certificate-translation-uscis.md"),
        "utf8",
      ),
    ).content;
    const birthHtml = render(birth);
    expect(birthHtml).toContain("[illegible seal]");
    expect(birthHtml).toContain("[signature]");
    expect(birthHtml).toContain("These are certified translations accepted by USCIS.");

    const notarized = matter(
      fs.readFileSync(
        path.join(process.cwd(), "content/guides/certified-vs-notarized-translation.md"),
        "utf8",
      ),
    ).content;
    const notarizedHtml = render(notarized);
    expect(notarizedHtml).toContain(
      "https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&amp;URL=0100-0199%2F0117%2FSections%2F0117.05.html",
    );
  });
});
