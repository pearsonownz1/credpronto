import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContactPageBody } from "./contact-view";

describe("contact page", () => {
  it("shows the form, the contact card, and the guide links", () => {
    const html = renderToStaticMarkup(createElement(ContactPageBody));
    expect(html).toContain("We&#x27;d love to hear from you");
    expect(html).toContain("How can we help?");
    expect(html).toContain("Send message →");
    expect(html).toContain("Get in touch");
    expect(html).toContain("support@credpronto.com");
    expect(html).toContain("Replies within one business day");
    expect(html).toContain("2520 Venture Oaks Way, Suite 120");
    expect(html).toContain("Sacramento, CA 95833");
    expect(html).toContain("Looking for a quick answer?");
    expect(html).toContain('href="/faq"');
    expect(html).toContain("Read the FAQ");
    expect(html).toContain('href="/guides"');
    expect(html).toContain("Browse guides");
    expect(html).toContain('name="website"');
    expect(html.toLowerCase()).not.toContain("phone");
    expect(html.toLowerCase()).not.toContain("office hours");
    expect(html).not.toContain("tel:");
  });
});