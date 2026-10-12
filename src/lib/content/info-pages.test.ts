import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownBody } from "@/components/content/markdown-body";
import { SiteFooter } from "@/components/site-footer";
import { infoMetadata, loadInfoPage } from "./info-pages";

function render(source: string) {
  return renderToStaticMarkup(createElement(MarkdownBody, { source }));
}

describe("info pages", () => {
  it("keeps the privacy and terms copy", () => {
    const privacy = loadInfoPage("privacy");
    const terms = loadInfoPage("terms");
    expect(privacy.title).toBe("Privacy Policy · CredPronto");
    expect(privacy.canonical).toBe("https://www.credpronto.com/privacy");
    expect(privacy.body).toContain("_Last updated: October 12, 2026_");
    expect(privacy.body).toContain("We do not sell your personal information.");
    expect(privacy.body).toContain(
      "CredPronto, 2520 Venture Oaks Way, Suite 120, Sacramento, CA 95833 · support@credpronto.com",
    );
    expect(terms.title).toBe("Terms of Service · CredPronto");
    expect(terms.body).toContain("Certified translation is $9.95 per page (one side, up to 250 words).");
    expect(terms.body).toContain("These terms are governed by California law.");
    expect(infoMetadata("privacy").description).toBe(privacy.description);
    expect(infoMetadata("terms").alternates).toEqual({
      canonical: "https://www.credpronto.com/terms",
    });
  });

  it("renders about as a translate button and contact as a mailto button", () => {
    const about = render(loadInfoPage("about").body);
    expect(about).toContain("Certified translations you can see before you pay.");
    expect(about).toContain('href="/translate"');
    expect(about).toContain("Upload your document");
    expect(about).toContain("bg-primary");
    expect(about).not.toContain("<form");

    const contact = render(loadInfoPage("contact").body);
    expect(contact).toContain("We usually reply within one business day.");
    expect(contact).toContain('href="mailto:support@credpronto.com"');
    expect(contact).toContain("Send message");
    expect(contact).toContain("bg-primary");
    expect(contact).toContain('href="/faq"');
    expect(contact).toContain('href="/guides"');
    expect(contact).not.toContain("<form");
  });

  it("links About, Contact, Privacy, and Terms from the footer", () => {
    const html = renderToStaticMarkup(createElement(SiteFooter));
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/contact"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain(">About<");
    expect(html).toContain(">Contact<");
    expect(html).toContain(">Privacy<");
    expect(html).toContain(">Terms<");
  });
});
